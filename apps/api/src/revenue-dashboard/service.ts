import { insertSheetRows, listSheetRows } from '../../../../packages/db/src/workbook-sheets.js';
import { z } from 'zod';
import {
  computeTransport,
  lineAdjustments,
  presetOf,
  summarise,
  type RulesPreset,
} from './transport-rules.js';
import {
  applyTransportRevenue,
  getTransportRules,
  listTransportLines,
  saveTransportRules,
  transportTotals,
} from '../../../../packages/db/src/revenue-transport-rules.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  type DandiPricingInput,
  revenueFilterQuerySchema,
  revenueGroupQuerySchema,
  revenueImportKindSchema,
  revenueLinesQuerySchema,
  revenueMatrixQuerySchema,
  revenueViewExportQuerySchema,
} from '../../../../packages/contracts/src/index.js';
import {
  quotationsLpoPending,
  quotationsLpoPendingByMonth,
  quotationsInvoiceCheck,
  quotationsLpoPendingDetail,
} from '../../../../packages/db/src/quotations.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  budgetLinesForBatch,
  budgetVsActual,
  createImportBatch,
  findActiveBatch,
  findBatchFile,
  insertBudgetLines,
  insertRevenueLines,
  listBatches,
  revenueExceptions,
  revenueExportLines,
  revenueGroup,
  revenueInvoiceLines,
  revenueInvoiceList,
  revenueLines,
  revenueLinesForBatch,
  revenueMatrix,
  revenueSummary,
  REVENUE_EXCEPTIONS,
  saveBatchFile,
  type RevenueDimension,
  type RevenueFilters,
} from '../../../../packages/db/src/revenue-dashboard.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { buildBudgetWorkbook, buildRevenueSourceWorkbook } from './download.js';
import { buildRevenueReportWorkbook } from './export.js';
import { applyFlatRates } from './pricing-logic.js';
import {
  buildLogicSummary,
  buildWorkedExample,
  rulesOfBatch,
  type LogicSummaryLine,
} from './logic-summary.js';
import { createPricingConfigService } from '../pricing-config/service.js';
import { buildRevenueViewWorkbook } from './view-export.js';
import { syncBudgetVersionFromUpload } from '../../../../packages/db/src/budget-variance.js';
import { parseBudgetWorkbook, parseRevenueWorkbook, WorkbookParseError } from './parser.js';

export class RevenueDashboardServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'no-data' | 'invalid-activity' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export type UploadedWorkbook = { originalname: string; size: number; buffer: Buffer };

export const MAX_WORKBOOK_BYTES = 40 * 1024 * 1024;

export function createRevenueDashboardService(pool: Pool) {
  const pricing = createPricingConfigService(pool);
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
                pricingUnmatched: parsed.pricingUnmatched,
                sheets: parsed.sheets.map((sheet) => ({
                  name: sheet.name,
                  rows: sheet.rows.length,
                  dateColumn: sheet.dateColumn,
                  columns: sheet.columns,
                })),
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
      await saveBatchFile(client, batch.id, kind, file.buffer);
      if ('rates' in parsed) {
        await insertRevenueLines(client, batch.id, parsed.lines);
        await insertSheetRows(client, batch.id, parsed.sheets);
        // Apply the portal's transport rules to the new upload (modification #249).
        await applyRulesToBatch(client, batch.id);
      } else await insertBudgetLines(client, batch.id, parsed.lines);
      // A budget upload also refreshes the budget version Budget Variance reads, so both
      // tabs show the same figures (modification #134).
      let budgetVersion: Awaited<ReturnType<typeof syncBudgetVersionFromUpload>> = null;
      if (!('rates' in parsed)) {
        budgetVersion = await syncBudgetVersionFromUpload(client, {
          fileName: file.originalname,
          periods: parsed.periods,
          monthlyRevenue: parsed.periods.map((period) =>
            parsed.lines
              .filter((line) => line.section === 'revenue' && line.period === period)
              .reduce((sum, line) => sum + line.amount, 0),
          ),
          streams: parsed.streams,
          profileId,
        });
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.imported',
        targetType: 'revenue_import_batch',
        targetId: batch.id,
        metadata: {
          kind,
          fileName: file.originalname,
          rowCount: batch.rowCount,
          budgetVersionId: budgetVersion?.versionId ?? null,
        },
        requestId,
      });
      return budgetVersion ? { ...batch, budgetVersion } : batch;
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

  // Quotations awaiting LPO / invoice in the selected year and month (by quotation date).
  async function lpoPending(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return await quotationsLpoPending(client, { year: filters.year, month: filters.month });
    } finally {
      client.release();
    }
  }

  // LPO pending with the by-created-month breakdown and the quotations to follow up, for the ROI.
  async function lpoPendingDetail(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return await quotationsLpoPendingDetail(
        client,
        { year: filters.year, month: filters.month },
        8,
      );
    } finally {
      client.release();
    }
  }

  // LPO pending for each month, for the Budget vs Actual chart.
  async function lpoPendingByMonth() {
    const client = await pool.connect();
    try {
      return { months: await quotationsLpoPendingByMonth(client) };
    } finally {
      client.release();
    }
  }

  // Quotations marked Invoiced against the invoice numbers in the active master workbook.
  async function invoiceCheck() {
    const client = await pool.connect();
    try {
      const setting = await client.query<{ value: unknown }>(
        `SELECT value FROM revenue_settings WHERE key = 'invoice_check_grace_days'`,
      );
      const days = Number(setting.rows[0]?.value);
      const graceDays = Number.isFinite(days) && days >= 0 ? days : 7;
      return await quotationsInvoiceCheck(client, { graceDays });
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

  async function exportWorkbook(
    query: Record<string, unknown>,
    profileId?: string,
    requestId: string = randomUUID(),
  ) {
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
        flatRates: ((await pricing.get('dandi_pricing')).payload as DandiPricingInput).flatRates,
      };
      const workbook = await buildRevenueReportWorkbook(data);
      if (profileId) {
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'revenue_dashboard.exported',
          targetType: 'revenue_import_batch',
          targetId: batch.id,
          metadata: { filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) },
          requestId,
        });
      }
      return workbook;
    } finally {
      client.release();
    }
  }

  // Reports > Drill-down > "Download this view": only the filtered / drilled view
  // (cover, breakdown, jobs) in a finance-ready workbook.
  async function exportView(
    query: Record<string, unknown>,
    profileId?: string,
    requestId: string = randomUUID(),
  ) {
    const parsed = revenueViewExportQuerySchema.parse(query);
    const { groupBy, viewPath, ...filterFields } = parsed;
    const filters = filterFields as RevenueFilters;
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch)
        throw new RevenueDashboardServiceError(
          'no-data',
          'No revenue workbook has been uploaded yet.',
        );
      const jobTypeMix = await revenueGroup(client, batch.id, filters, 'jobType');
      const grand = await revenueGroup(client, batch.id, {}, 'jobType');
      const dimension = groupBy && groupBy !== 'jobs' ? (groupBy as RevenueDimension) : null;
      const breakdown = dimension
        ? await revenueGroup(client, batch.id, filters, dimension, 2000)
        : null;
      const MAX_JOBS = 50000;
      const lines = await revenueExportLines(client, batch.id, filters, MAX_JOBS);
      const exception = filters.exception
        ? {
            key: filters.exception,
            label: REVENUE_EXCEPTIONS[filters.exception].label,
            description: REVENUE_EXCEPTIONS[filters.exception].description,
          }
        : null;
      const workbook = await buildRevenueViewWorkbook({
        batch,
        filters,
        groupBy: groupBy ?? 'jobs',
        viewPath: viewPath ?? '',
        totals: jobTypeMix.totals,
        grandTotals: grand.totals,
        breakdown,
        jobTypeMix,
        exception,
        lines,
        truncated: jobTypeMix.totals.jobs > lines.length,
      });
      if (profileId) {
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'revenue_dashboard.view_exported',
          targetType: 'revenue_import_batch',
          targetId: batch.id,
          metadata: {
            filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
            groupBy: groupBy ?? 'jobs',
            jobs: jobTypeMix.totals.jobs,
          },
          requestId,
        });
      }
      return workbook;
    } finally {
      client.release();
    }
  }

  // Who looked at, copied or drafted an email from the revenue dashboard. The
  // browser reports these (a view is not a server request), so only a small
  // fixed set of actions and a short view label are accepted.
  const ACTIVITY_ACTIONS = ['viewed', 'email_drafted', 'summary_copied'] as const;

  async function recordActivity(
    query: Record<string, unknown>,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const action = String(query.action ?? '');
    if (!(ACTIVITY_ACTIONS as readonly string[]).includes(action)) {
      throw new RevenueDashboardServiceError(
        'invalid-activity',
        'action must be one of: ' + ACTIVITY_ACTIONS.join(', ') + '.',
      );
    }
    const view = String(query.view ?? '').trim();
    if (view && !/^[A-Za-z0-9:_ -]{1,40}$/.test(view)) {
      throw new RevenueDashboardServiceError('invalid-activity', 'view is not a valid label.');
    }
    const period = String(query.period ?? '')
      .trim()
      .slice(0, 120);
    const client = await pool.connect();
    try {
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.' + action,
        targetType: 'revenue_dashboard',
        metadata: { ...(view ? { view } : {}), ...(period ? { period } : {}) },
        requestId,
      });
    } finally {
      client.release();
    }
  }

  // "Logic applied" tab: the rules in force, live figures and a worked example
  // for the whole active upload (not filtered).
  async function logic() {
    return withActive(async (client, batchId) => {
      const batch = await findActiveBatch(client, 'revenue');
      const lines = (await revenueExportLines(client, batchId, {}, 50000)) as LogicSummaryLine[];
      return buildLogicSummary(
        batch!,
        lines.map(toLogicLine),
        (await pricing.get('dandi_pricing')).payload as DandiPricingInput,
      );
    });
  }

  const toLogicLine = (l: LogicSummaryLine): LogicSummaryLine => ({
    ...l,
    qty: Number(l.qty ?? 0),
    unitPrice: Number(l.unitPrice ?? 0),
    revenue: Number(l.revenue ?? 0),
    originalJobValue: Number(l.originalJobValue ?? 0),
  });

  // Worked-example picker: invoices matching year / month / week / job type /
  // search, newest first (at most 300).
  async function logicInvoices(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query) as RevenueFilters;
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, invoices: [] };
      return { batch, invoices: await revenueInvoiceList(client, batch.id, filters, 300) };
    } finally {
      client.release();
    }
  }

  // Worked example for the invoice numbers given (comma / space separated, up
  // to 20): every line of each invoice, with how it was priced.
  async function logicExample(query: Record<string, unknown>) {
    const invoices = [
      ...new Set(
        String(query.invoices ?? '')
          .split(/[\s,;]+/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20);
    if (!invoices.length)
      throw new RevenueDashboardServiceError('no-data', 'Enter at least one invoice number.');
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, examples: [], notFound: invoices };
      const raw = (await revenueInvoiceLines(client, batch.id, invoices)) as (LogicSummaryLine & {
        workbookRevenue?: unknown;
      })[];
      // The example explains the workbook figures (#252); the dashboard figure under the
      // transport rules is given in the transport note when it differs.
      const current = new Map<string, number>();
      for (const r of raw)
        current.set(
          String(r.invDelNo),
          (current.get(String(r.invDelNo)) ?? 0) + Number(r.revenue ?? 0),
        );
      const rows = raw.map((r) => ({
        ...r,
        revenue: r.workbookRevenue === undefined ? r.revenue : Number(r.workbookRevenue),
      })) as LogicSummaryLine[];
      const dandi = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
      const rules = applyFlatRates(rulesOfBatch(batch), dandi.flatRates);
      const transport = await exampleTransport(client, batch.id, invoices);
      const examples = invoices
        .map((invoice) => ({
          invoice,
          set: rows.filter((r) => r.invDelNo === invoice).map(toLogicLine),
        }))
        .filter((x) => x.set.length)
        .map((x) => {
          const ex = buildWorkedExample(rules, x.invoice, x.set);
          const jobTypes = [...new Set(x.set.map((l) => l.jobType))];
          return {
            ...ex,
            transport: transportNote(
              transport,
              x.invoice,
              jobTypes,
              Math.round((current.get(x.invoice) ?? 0) * 100) / 100,
            ),
          };
        });
      const found = new Set(examples.map((e) => e.invoice));
      return { batch, examples, notFound: invoices.filter((i) => !found.has(i)) };
    } finally {
      client.release();
    }
  }

  // Transport status of the invoices of a worked example (#252), under the saved rules.
  async function exampleTransport(
    client: import('pg').PoolClient,
    batchId: string,
    invoices: string[],
  ) {
    const rules = await getTransportRules(client);
    const rows = await listSheetRows(client, batchId, 'CSIDI');
    if (!rows.length)
      return { rules, preset: presetOf(rules), byInvoice: new Map(), dayTrips: new Map() };
    const calc = computeTransport(rows, rules);
    const wanted = new Set(invoices);
    const byInvoice = new Map(
      calc.invoices.filter((i) => wanted.has(i.invoice)).map((i) => [i.invoice, i]),
    );
    const dayTrips = new Map<string, number>();
    for (const i of calc.invoices)
      if (i.rank !== null) {
        const k = i.date + '|' + i.salesperson;
        dayTrips.set(k, (dayTrips.get(k) ?? 0) + 1);
      }
    return { rules, preset: presetOf(rules), byInvoice, dayTrips };
  }

  function transportNote(
    t: Awaited<ReturnType<typeof exampleTransport>>,
    invoice: string,
    jobTypes: string[],
    currentTotal: number,
  ) {
    const i = t.byInvoice.get(invoice);
    const { label } = bannerOf(t.preset, null);
    const base = { rules: t.rules, preset: t.preset, rulesLabel: label, currentTotal };
    if (!i) {
      if (jobTypes.includes('CSIII') && !jobTypes.some((j) => j === 'CSIDI' || j === 'CSIDO'))
        return { ...base, status: 'installation_only' };
      return null;
    }
    let status: string;
    if (i.kind === 'delivery') status = i.charged ? 'delivery_fee' : 'delivery_over_cap';
    else if (i.kind === 'installation') {
      if (i.charge === 0 && i.mixedSingle) status = 'mixed_off';
      else if (!t.rules.dailyCap) status = 'charged_no_cap';
      else status = i.charged ? 'charged' : 'over_cap';
    } else if (!jobTypes.some((j) => j === 'CSIDI' || j === 'CSIDO')) status = 'installation_only';
    else status = i.csidiQty === 1 ? 'single_unit' : 'no_transport';
    return {
      ...base,
      status,
      date: i.date,
      salesperson: i.salesperson,
      csidiQty: i.csidiQty,
      mixedSingle: i.mixedSingle,
      carrier: i.carrier,
      charge: i.charge,
      rank: i.rank,
      trips: i.rank === null ? 0 : (t.dayTrips.get(i.date + '|' + i.salesperson) ?? 0),
      maxTrips: t.rules.maxTrips,
      workbookCharge: i.actual,
      currentCharge: i.scenario,
      delta: i.delta,
    };
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

  /**
   * Download an uploaded workbook for verification: exactly as uploaded when the
   * portal still holds it (the newest upload of each kind), otherwise an Excel
   * rebuilt from the rows that were read from it.
   */
  async function downloadBatch(
    idInput: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const id = String(idInput ?? '').trim();
    if (!/^\d{1,15}$/.test(id)) {
      throw new RevenueDashboardServiceError('not-found', 'Choose an upload to download.');
    }
    const client = await pool.connect();
    try {
      const batch = await findBatchFile(client, id);
      if (!batch) throw new RevenueDashboardServiceError('not-found', 'That upload was not found.');
      let result: { fileName: string; buffer: Buffer; source: 'original' | 'rebuilt' };
      if (batch.bytes) {
        result = { fileName: batch.fileName, buffer: batch.bytes, source: 'original' };
      } else {
        const stem = batch.fileName.replace(/\.(xlsx|xlsm)$/i, '');
        result =
          batch.kind === 'revenue'
            ? {
                fileName: `${stem}_rebuilt.xlsx`,
                buffer: await buildRevenueSourceWorkbook(await revenueLinesForBatch(client, id)),
                source: 'rebuilt',
              }
            : {
                fileName: `${stem}_rebuilt.xlsx`,
                buffer: await buildBudgetWorkbook(await budgetLinesForBatch(client, id)),
                source: 'rebuilt',
              };
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.downloaded',
        targetType: 'revenue_import_batch',
        targetId: id,
        metadata: { kind: batch.kind, source: result.source, fileName: result.fileName },
        requestId,
      });
      return result;
    } finally {
      client.release();
    }
  }

  // Transport rules (2-trip daily cap), modification #249. The master workbook carries the rule; an
  // admin can switch three toggles that recalculate revenue_lines.revenue for the whole dashboard.
  async function applyRulesToBatch(client: PoolClient, batchId: string) {
    const stored = await getTransportRules(client);
    const rows = await listSheetRows(client, batchId, 'CSIDI');
    const lines = await listTransportLines(client, batchId);
    if (!rows.length) {
      await applyTransportRevenue(client, batchId, []);
      return { unmatched: 0, invoices: 0 };
    }
    const calc = computeTransport(rows, stored);
    const { updates, unmatched } = lineAdjustments(calc, lines);
    await applyTransportRevenue(client, batchId, updates);
    return { unmatched, invoices: calc.invoices.length };
  }

  const rulesInputSchema = z.object({
    dailyCap: z.boolean(),
    deliveryOnlyCap: z.boolean(),
    mixedInvoiceTransport: z.boolean(),
    maxTrips: z.number().int().min(1).max(10).default(2),
  });

  function bannerOf(preset: RulesPreset, workbookRule: 'new' | 'old' | null) {
    const label =
      preset === 'new_master'
        ? 'Transport rules: new master logic (2-trip daily cap, delivery-only outside the cap)'
        : preset === 'old_master'
          ? 'Transport rules: old master logic (no daily cap)'
          : 'Custom transport rules: figures differ from the master workbook';
    const matches =
      workbookRule === null ||
      (preset === 'new_master'
        ? workbookRule === 'new'
        : preset === 'old_master'
          ? workbookRule === 'old'
          : false);
    return { label, matchesWorkbook: matches };
  }

  async function transportRules(query: Record<string, unknown>) {
    const month = Number(query.month) || null;
    const client = await pool.connect();
    try {
      const stored = await getTransportRules(client);
      const rules = {
        dailyCap: stored.dailyCap,
        deliveryOnlyCap: stored.deliveryOnlyCap,
        mixedInvoiceTransport: stored.mixedInvoiceTransport,
        maxTrips: stored.maxTrips,
      };
      const preset = presetOf(rules);
      const batch = await findActiveBatch(client, 'revenue');
      const base = {
        rules,
        preset,
        updatedAt: stored.updatedAt,
        updatedByName: stored.updatedByName,
      };
      if (!batch)
        return { ...base, batch: null, ...bannerOf(preset, null), appliedToActive: false };
      const rows = await listSheetRows(client, batch.id, 'CSIDI');
      const calc = rows.length ? computeTransport(rows, rules) : null;
      const workbookRule = calc?.workbookRule ?? null;
      const totals = await transportTotals(client, batch.id);
      const inPeriodMonth = (m: number) => month === null || m === month;
      const inPeriod = (date: string) =>
        month === null || Number(date.slice(0, 4)) * 100 + Number(date.slice(5, 7)) === month;
      const pick = (t: string, k: 'workbook' | 'current') =>
        totals
          .filter((x) => x.jobType === t && inPeriodMonth(x.month))
          .reduce((s, x) => s + x[k], 0);
      const repairs = { CSIJW: pick('CSIJW', 'current'), CSIJO: pick('CSIJO', 'current') };
      const summary = calc ? summarise(calc, repairs, inPeriod, rules.maxTrips) : null;
      const sumAll = (k: 'workbook' | 'current') =>
        Math.round(
          totals.filter((x) => inPeriodMonth(x.month)).reduce((s, x) => s + x[k], 0) * 100,
        ) / 100;
      // Revenue Source in the uploaded file should equal the CSIDI sheet (Excel recalculation done before upload).
      let notRecalculated = false;
      if (calc) {
        const sheetDandI = rows.reduce((s, r) => {
          const t = String(r.data['Pricing Type'] ?? '');
          const v = r.data['Proposed Revenue'];
          return ['CSIDI', 'CSIDO', 'CSIII'].includes(t) &&
            typeof v === 'number' &&
            r.data['Inv/Del No']
            ? s + v
            : s;
        }, 0);
        const linesDandI = totals
          .filter((x) => ['CSIDI', 'CSIDO', 'CSIII'].includes(x.jobType))
          .reduce((s, x) => s + x.workbook, 0);
        notRecalculated = Math.abs(sheetDandI - linesDandI) > 1;
      }
      const days = calc
        ? Object.values(
            calc.invoices
              .filter((i) => i.rank !== null && inPeriod(i.date))
              .reduce<
                Record<string, { date: string; salesperson: string; trips: typeof calc.invoices }>
              >((acc, i) => {
                const k = `${i.date}|${i.salesperson}`;
                (acc[k] ??= { date: i.date, salesperson: i.salesperson, trips: [] }).trips.push(i);
                return acc;
              }, {}),
          )
            .map((d) => ({
              ...d,
              trips: d.trips.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
              overCap: d.trips.length > rules.maxTrips,
            }))
            .sort(
              (a, b) => b.date.localeCompare(a.date) || a.salesperson.localeCompare(b.salesperson),
            )
            .slice(0, 300)
        : [];
      return {
        ...base,
        batch: { id: batch.id, fileName: batch.fileName, uploadedAt: batch.uploadedAt },
        workbookRule,
        ...bannerOf(preset, workbookRule),
        appliedToActive: stored.appliedBatchId === String(batch.id),
        notRecalculated,
        period: month,
        totals: {
          workbook: sumAll('workbook'),
          current: sumAll('current'),
          change: Math.round((sumAll('current') - sumAll('workbook')) * 100) / 100,
        },
        summary,
        days,
        notice: rows.length
          ? null
          : 'This upload has no stored CSIDI sheet. Upload the master workbook again so the transport rules can be applied.',
      };
    } finally {
      client.release();
    }
  }

  async function saveTransportRulesAndApply(body: unknown, profileId: string) {
    const input = rulesInputSchema.parse(body);
    await withTransaction(pool, async (client) => {
      await saveTransportRules(client, input, profileId);
      const batch = await findActiveBatch(client, 'revenue');
      const applied = batch ? await applyRulesToBatch(client, batch.id) : null;
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.transport_rules_changed',
        targetType: 'revenue_transport_rules',
        targetId: '1',
        metadata: {
          ...input,
          preset: presetOf(input),
          batchId: batch?.id ?? null,
          unmatched: applied?.unmatched ?? null,
        },
      });
    });
    return transportRules({});
  }

  return {
    importWorkbook,
    downloadBatch,
    batches,
    summary,
    lpoPending,
    lpoPendingDetail,
    lpoPendingByMonth,
    invoiceCheck,
    lines,
    budget,
    group,
    matrix,
    exceptions,
    exportWorkbook,
    exportView,
    logic,
    logicInvoices,
    logicExample,
    recordActivity,
    transportRules,
    saveTransportRulesAndApply,
  };
}

export type RevenueDashboardService = ReturnType<typeof createRevenueDashboardService>;
