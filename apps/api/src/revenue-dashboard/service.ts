import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  revenueFilterQuerySchema,
  revenueImportKindSchema,
  revenueLinesQuerySchema,
} from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  budgetVsActual,
  createImportBatch,
  findActiveBatch,
  insertBudgetLines,
  insertRevenueLines,
  listBatches,
  revenueLines,
  revenueSummary,
} from '../../../../packages/db/src/revenue-dashboard.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { parseBudgetWorkbook, parseRevenueWorkbook, WorkbookParseError } from './parser.js';

export class RevenueDashboardServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'no-data',
    message: string,
  ) {
    super(message);
  }
}

export type UploadedWorkbook = { originalname: string; size: number; buffer: Buffer };

export const MAX_WORKBOOK_BYTES = 40 * 1024 * 1024;

export function createRevenueDashboardService(pool: Pool) {
  async function importWorkbook(
    kindInput: unknown,
    file: UploadedWorkbook,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const kind = revenueImportKindSchema.parse(kindInput);
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname)) {
      throw new RevenueDashboardServiceError('invalid-file', 'Upload an .xlsx or .xlsm workbook.');
    }
    let parsed;
    try {
      parsed =
        kind === 'revenue'
          ? await parseRevenueWorkbook(file.buffer)
          : await parseBudgetWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof WorkbookParseError) {
        throw new RevenueDashboardServiceError('invalid-file', error.message);
      }
      throw error;
    }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    return withTransaction(pool, async (client) => {
      const batch =
        'rates' in parsed
          ? await createImportBatch(client, {
              kind,
              fileName: file.originalname,
              fileSha256: sha,
              rowCount: parsed.lines.length,
              totalAmount: parsed.totalRevenue,
              summary: { rates: parsed.rates, selectedYear: parsed.selectedYear },
              uploadedBy: profileId,
            })
          : await createImportBatch(client, {
              kind,
              fileName: file.originalname,
              fileSha256: sha,
              rowCount: parsed.lines.length,
              totalAmount: parsed.totalRevenue,
              summary: { periods: parsed.periods },
              uploadedBy: profileId,
            });
      if ('rates' in parsed) await insertRevenueLines(client, batch.id, parsed.lines);
      else await insertBudgetLines(client, batch.id, parsed.lines);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.imported',
        targetType: 'revenue_import_batch',
        targetId: batch.id,
        metadata: { kind, fileName: file.originalname, rowCount: batch.rowCount },
        requestId,
      });
      return batch;
    });
  }

  async function batches() {
    const client = await pool.connect();
    try {
      const all = await listBatches(client);
      return {
        batches: all,
        active: {
          revenue: all.find((b) => b.kind === 'revenue' && b.isActive) ?? null,
          budget: all.find((b) => b.kind === 'budget' && b.isActive) ?? null,
        },
      };
    } finally {
      client.release();
    }
  }

  async function summary(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, summary: null };
      return { batch, summary: await revenueSummary(client, batch.id, filters) };
    } finally {
      client.release();
    }
  }

  async function lines(query: Record<string, unknown>) {
    const data = revenueLinesQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch)
        return {
          batch: null,
          items: [],
          total: 0,
          revenue: 0,
          page: data.page,
          pageSize: data.pageSize,
        };
      const { page, pageSize, ...filters } = data;
      const result = await revenueLines(client, batch.id, filters, page, pageSize);
      return { batch, ...result, page, pageSize };
    } finally {
      client.release();
    }
  }

  async function budget() {
    const client = await pool.connect();
    try {
      const budgetBatch = await findActiveBatch(client, 'budget');
      const revenueBatch = await findActiveBatch(client, 'revenue');
      if (!budgetBatch) return { budgetBatch: null, revenueBatch, budget: [], actual: [] };
      const data = await budgetVsActual(client, budgetBatch.id, revenueBatch?.id ?? null);
      return { budgetBatch, revenueBatch, ...data };
    } finally {
      client.release();
    }
  }

  return { importWorkbook, batches, summary, lines, budget };
}

export type RevenueDashboardService = ReturnType<typeof createRevenueDashboardService>;
