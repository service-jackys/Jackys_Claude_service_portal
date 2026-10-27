import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  latestStockUploadFile,
  saveStockUploadFile,
  saveStockUploadReport,
  searchStockItems,
  stockFacets,
  stockMasterRows,
  stockStatus,
  upsertStockMaster,
} from '../../../../packages/db/src/stock-master.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { buildStockMasterWorkbook } from './download.js';
import { parseStockWorkbook, StockParseError } from './parser.js';

export class StockMasterServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'no-data',
    message: string,
  ) {
    super(message);
  }
}

export type UploadedStockFile = { originalname: string; size: number; buffer: Buffer };

export const MAX_STOCK_FILE_BYTES = 40 * 1024 * 1024;

const searchQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  brand: z.string().trim().max(120).default(''),
  group: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

const REPORT_CHANGE_LIMIT = 100;

export function createStockMasterService(pool: Pool) {
  async function upload(
    file: UploadedStockFile,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new StockMasterServiceError('invalid-file', 'Upload the ERP Item Listing as .xlsx.');
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
      const result = await upsertStockMaster(client, {
        fileName: file.originalname,
        fileSha256: sha,
        rowCount: parsed.rowCount,
        items: parsed.items,
        uploadedBy: profileId,
      });
      const report = {
        sheet: parsed.sheetName,
        headerRow: parsed.headerRow,
        unchangedItems: result.unchangedItems,
        changeCount: result.changes.length,
        changes: result.changes.slice(0, REPORT_CHANGE_LIMIT),
        warnings: parsed.warnings,
        warningCount: parsed.warnings.length,
      };
      await saveStockUploadReport(client, result.uploadId, report);
      await saveStockUploadFile(client, result.uploadId, file.buffer);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'stock.uploaded',
        targetType: 'stock_upload',
        targetId: result.uploadId,
        metadata: {
          fileName: file.originalname,
          rows: parsed.rowCount,
          items: parsed.items.size,
          newItems: result.newItems,
          changedItems: result.changedItems,
        },
        requestId,
      });
      return {
        id: result.uploadId,
        fileName: file.originalname,
        rowCount: parsed.rowCount,
        itemCount: parsed.items.size,
        newItems: result.newItems,
        changedItems: result.changedItems,
        report,
      };
    });
  }

  /**
   * Download for verification: the newest uploaded Item Listing exactly as
   * uploaded when the portal still holds it, otherwise an Excel rebuilt from the
   * stock master (same columns, so it can be uploaded again).
   */
  async function download(profileId: string, requestId: string = randomUUID()) {
    const stamp = new Date().toISOString().slice(0, 10);
    const client = await pool.connect();
    try {
      const latest = await latestStockUploadFile(client);
      let result: { fileName: string; buffer: Buffer; source: 'original' | 'rebuilt' };
      if (latest?.bytes) {
        result = { fileName: latest.fileName, buffer: latest.bytes, source: 'original' };
      } else {
        const rows = await stockMasterRows(client);
        if (rows.length === 0) {
          throw new StockMasterServiceError('no-data', 'The stock master is empty.');
        }
        result = {
          fileName: `Stock_master_${stamp}.xlsx`,
          buffer: await buildStockMasterWorkbook(rows),
          source: 'rebuilt',
        };
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'stock.downloaded',
        targetType: 'stock_download',
        metadata: { source: result.source, fileName: result.fileName },
        requestId,
      });
      return result;
    } finally {
      client.release();
    }
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
