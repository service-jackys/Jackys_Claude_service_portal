import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  revenueFilterQuerySchema,
  revenueGroupQuerySchema,
  revenueImportKindSchema,
  revenueLinesQuerySchema,
  revenueMatrixQuerySchema,
} from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  budgetVsActual,
  createImportBatch,
  findActiveBatch,
  insertBudgetLines,
  insertRevenueLines,
  listBatches,
  revenueExceptions,
  revenueExportLines,
  revenueGroup,
  revenueLines,
  revenueMatrix,
  revenueSummary,
  type RevenueFilters,
} from '../../../../packages/db/src/revenue-dashboard.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { buildRevenueReportWorkbook } from './export.js';
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
              summary: {
                rates: parsed.rates,
                selectedYear: parsed.selectedYear,
                pricingRules: parsed.pricingRules,
                pricingMatched: parsed.pricingMatched,
              },
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
      return { batch, summary: await revenueSummary(client, batch.id, filters as RevenueFilters) };
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
      const result = await revenueLines(
        client,
        batch.id,
        filters as RevenueFilters,
        page,
        pageSize,
      );
      return { batch, ...result, page, pageSize };
    } finally {
      client.release();
    }
  }

  async function group(query: Record<string, unknown>) {
    const { dimension, ...filters } = revenueGroupQuerySchema.parse(query);
    return withActive((client, batchId) =>
      revenueGroup(client, batchId, filters as RevenueFilters, dimension),
    );
  }

  async function matrix(query: Record<string, unknown>) {
    const { rowDimension, columnDimension, ...filters } = revenueMatrixQuerySchema.parse(query);
    return withActive((client, batchId) =>
      revenueMatrix(client, batchId, filters as RevenueFilters, rowDimension, columnDimension),
    );
  }

  async function exceptions(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query) as RevenueFilters;
    return withActive((client, batchId) => revenueExceptions(client, batchId, filters));
  }

  async function exportWorkbook(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query) as RevenueFilters;
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch)
        throw new RevenueDashboardServiceError(
          'no-data',
          'No revenue workbook has been uploaded yet.',
        );
      const data = {
        batch,
        filters,
        total: await revenueGroup(client, batch.id, filters, 'jobType'),
        monthly: await revenueMatrix(client, batch.id, filters, 'period', 'jobType'),
        weekly: await revenueMatrix(client, batch.id, filters, 'yearWeek', 'jobType'),
        channel: await revenueGroup(client, batch.id, filters, 'channel'),
        salesPerson: await revenueGroup(client, batch.id, filters, 'salesPerson'),
        customer: await revenueGroup(client, batch.id, filters, 'customer', 1000),
        billingCode: await revenueGroup(client, batch.id, filters, 'billingCode'),
        exceptions: await revenueExceptions(client, batch.id, filters),
        lines: await revenueExportLines(client, batch.id, filters),
      };
      return buildRevenueReportWorkbook(data);
    } finally {
      client.release();
    }
  }

  async function withActive<T>(
    fn: (client: import('pg').PoolClient, batchId: string) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, data: null };
      return { batch, data: await fn(client, batch.id) };
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

  return {
    importWorkbook,
    batches,
    summary,
    lines,
    budget,
    group,
    matrix,
    exceptions,
    exportWorkbook,
  };
}

export type RevenueDashboardService = ReturnType<typeof createRevenueDashboardService>;
