import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  latestStockUploadFile,
  replaceChannelStock,
  saveStockUploadFile,
  saveStockUploadReport,
  searchStockItems,
  STOCK_CHANNELS,
  stockFacets,
  stockItemMaster,
  stockPositionsForChannel,
  stockStatus,
} from '../../../../packages/db/src/stock-master.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { buildStockChannelWorkbook, buildStockItemMasterWorkbook } from './download.js';
import { parseStockWorkbook, StockParseError } from './parser.js';

export class StockMasterServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'invalid-channel' | 'no-data',
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
  brand: z.string().trim().max(120).default(''),
  group: z.string().trim().max(120).default(''),
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
      await saveStockUploadFile(client, result.uploadId, channel.data, file.buffer);
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

  const downloadTargetSchema = z.enum([...STOCK_CHANNELS, 'items']);

  /**
   * Download for verification: a channel's file exactly as uploaded when the
   * portal still holds it, otherwise an Excel rebuilt from the stored rows (same
   * columns, so it can be uploaded again). `items` is the unique item list.
   */
  async function download(
    targetInput: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const target = downloadTargetSchema.safeParse(targetInput);
    if (!target.success) {
      throw new StockMasterServiceError(
        'invalid-channel',
        `Choose what to download (${[...STOCK_CHANNELS, 'items'].join(', ')}).`,
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const client = await pool.connect();
    let result: { fileName: string; buffer: Buffer; source: 'original' | 'rebuilt' };
    try {
      if (target.data === 'items') {
        const items = await stockItemMaster(client);
        if (items.length === 0) {
          throw new StockMasterServiceError('no-data', 'No stock file has been uploaded yet.');
        }
        result = {
          fileName: `Stock_item_master_${stamp}.xlsx`,
          buffer: await buildStockItemMasterWorkbook(items),
          source: 'rebuilt',
        };
      } else {
        const latest = await latestStockUploadFile(client, target.data);
        if (!latest) {
          throw new StockMasterServiceError(
            'no-data',
            `No stock file has been uploaded for ${target.data} yet.`,
          );
        }
        if (latest.bytes) {
          result = { fileName: latest.fileName, buffer: latest.bytes, source: 'original' };
        } else {
          const rows = await stockPositionsForChannel(client, target.data);
          result = {
            fileName: `Stock_${target.data}_rebuilt_${stamp}.xlsx`,
            buffer: await buildStockChannelWorkbook(rows),
            source: 'rebuilt',
          };
        }
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'stock.downloaded',
        targetType: 'stock_download',
        metadata: { target: target.data, source: result.source, fileName: result.fileName },
        requestId,
      });
    } finally {
      client.release();
    }
    return result;
  }

  return {
    upload,
    download,
    status: () => stockStatus(pool),
    async search(query: unknown) {
      const parsed = searchQuerySchema.parse(query);
      return {
        items: await searchStockItems(pool, {
          query: parsed.q,
          limit: parsed.limit,
          brand: parsed.brand,
          group: parsed.group,
        }),
      };
    },
    facets: () => stockFacets(pool),
  };
}

export type StockMasterService = ReturnType<typeof createStockMasterService>;
