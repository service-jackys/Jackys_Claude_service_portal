import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  replaceChannelStock,
  saveStockUploadReport,
  searchStockItems,
  STOCK_CHANNELS,
  STOCK_SEARCH_GROUPS,
  stockStatus,
} from '../../../../packages/db/src/stock-master.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { parseStockWorkbook, StockParseError } from './parser.js';

export class StockMasterServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'invalid-channel',
    message: string,
  ) {
    super(message);
  }
}

export type UploadedStockFile = { originalname: string; size: number; buffer: Buffer };

export const MAX_STOCK_FILE_BYTES = 20 * 1024 * 1024;

const channelSchema = z.enum(STOCK_CHANNELS);
const searchQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

const REPORT_CHANGE_LIMIT = 100;

export function createStockMasterService(pool: Pool) {
  async function upload(
    channelInput: unknown,
    file: UploadedStockFile,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const channel = channelSchema.safeParse(channelInput);
    if (!channel.success) {
      throw new StockMasterServiceError(
        'invalid-channel',
        `Choose the channel this file belongs to (${STOCK_CHANNELS.join(', ')}).`,
      );
    }
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new StockMasterServiceError('invalid-file', 'Upload the ERP stock file as .xlsx.');
    }
    let parsed;
    try {
      parsed = await parseStockWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof StockParseError) {
        throw new StockMasterServiceError('invalid-file', error.message);
      }
      throw error;
    }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    return withTransaction(pool, async (client) => {
      const result = await replaceChannelStock(client, {
        channel: channel.data,
        fileName: file.originalname,
        fileSha256: sha,
        rows: parsed.rows,
        items: parsed.items,
        uploadedBy: profileId,
      });
      // A change on an item last written by another channel is a conflict the
      // admin should look at: the newest upload wins, but the ERPs disagree.
      const conflicts = result.changes.filter((change) => change.previousChannel !== channel.data);
      const report = {
        sheet: parsed.sheetName,
        headerRow: parsed.headerRow,
        unchangedItems: result.unchangedItems,
        conflictCount: conflicts.length,
        changeCount: result.changes.length,
        changes: result.changes.slice(0, REPORT_CHANGE_LIMIT).map((change) => ({
          ...change,
          conflict: change.previousChannel !== channel.data,
        })),
        warnings: parsed.warnings.slice(0, REPORT_CHANGE_LIMIT),
        warningCount: parsed.warnings.length,
      };
      await saveStockUploadReport(client, result.uploadId, report);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'stock.uploaded',
        targetType: 'stock_upload',
        targetId: result.uploadId,
        metadata: {
          channel: channel.data,
          fileName: file.originalname,
          rows: parsed.rows.length,
          items: parsed.items.size,
          newItems: result.newItems,
          changedItems: result.changedItems,
          conflicts: conflicts.length,
        },
        requestId,
      });
      return {
        id: result.uploadId,
        channel: channel.data,
        fileName: file.originalname,
        rowCount: parsed.rows.length,
        itemCount: parsed.items.size,
        newItems: result.newItems,
        changedItems: result.changedItems,
        report,
      };
    });
  }

  return {
    upload,
    status: () => stockStatus(pool),
    async search(query: unknown) {
      const parsed = searchQuerySchema.parse(query);
      return {
        groups: [...STOCK_SEARCH_GROUPS],
        items: await searchStockItems(pool, { query: parsed.q, limit: parsed.limit }),
      };
    },
  };
}

export type StockMasterService = ReturnType<typeof createStockMasterService>;
