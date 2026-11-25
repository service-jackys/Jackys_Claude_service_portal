import { insertSheetRows, listSheetRows } from '../../../../packages/db/src/workbook-sheets.js';
import { capacityForCodes } from '../../../../packages/db/src/stock-master.js';
import { FRIDGE_CATEGORY, plugQuantities } from './fridge-scenario.js';
import { fridgeRevenue, runScenario } from './scenario-run.js';
import { buildScenarioWorkbook } from './scenario-export.js';
import { z } from 'zod';
import {
  batchSummary,
  getRateOverrides,
  listRateLines,
  markRateOverridesApplied,
  saveRateOverrides,
  getFridgeLogic,
  saveFridgeLogic,
} from '../../../../packages/db/src/revenue-rate-overrides.js';
import {
  computeRevenue,
  diffRates,
  mastersFromRates,
  overlayRates,
  ratesFromMasters,
  ratesOf,
  reasonOf,
  singleChange,
  totalsOf,
  type RateSet,
} from './rate-overrides.js';
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
  revenueInvoiceSalesPersons,
  revenueInvoiceList,
  invoiceFamilyOf,
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
  type WorkedExample,
} from './logic-summary.js';
import { createPricingConfigService } from '../pricing-config/service.js';
import { buildRevenueViewWorkbook } from './view-export.js';
import { syncBudgetVersionFromUpload } from '../../../../packages/db/src/budget-variance.js';
import { parseBudgetWorkbook, parseRevenueWorkbook, WorkbookParseError } from './parser.js';

export class RevenueDashboardServiceError extends Error {
  constructor(
    public readonly code:
      | 'invalid-file'
      | 'no-data'
      | 'invalid-activity'
      | 'not-found'
      | 'invalid-rates'
      | 'no-upload'
      | 'not-confirmed'
      | 'no-custom-rates',
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

  /** What the Export report needs to describe the new fridge logic (modification #307). Undefined while it is off. */
  async function exportFridgeLogic(client: PoolClient, batchId: string) {
    const settings = await getFridgeLogic(client);
    if (!settings.enabled) return undefined;
    const { inputs, base } = await loadRevenueInputs(client, batchId);
    const custom = parseRateSet((await getRateOverrides(client)).payload);
    const { lookup, plugQty } = await fridgeContext(client, batchId, inputs);
    const r = fridgeRevenue(inputs, base, custom ?? ratesOf(base), settings, lookup, plugQty);
    const byLine = new Map<
      string,
      { litres: number; source: string; defaultLitres: boolean; rule: string; large: boolean }
    >();
    let defaultLines = 0;
    for (const [id, f] of r.fridge) {
      byLine.set(id, {
        litres: f.litres,
        source: f.litresSource,
        defaultLitres: f.defaultLitres,
        rule: f.rule,
        large: f.large,
      });
      if (f.defaultLitres) defaultLines += 1;
    }
    const plugByLine = new Map<string, { qty: number; amount: number }>();
    for (const [id, amount] of r.plugOf)
      plugByLine.set(id, { qty: r.plugUnits.get(id) ?? 0, amount });
    const tot = await client.query<{ workbook: string; portal: string }>(
      `SELECT COALESCE(SUM(workbook_revenue), 0) AS workbook, COALESCE(SUM(revenue), 0) AS portal
         FROM revenue_lines WHERE batch_id = $1`,
      [batchId],
    );
    return {
      settings: {
        smallBase: settings.smallBase,
        smallOver10: settings.smallOver10,
        smallMinimum: settings.smallMinimum,
        optionB: settings.optionB,
        plugAmount: settings.plugAmount,
      },
      rates: (() => {
        const c = (custom ?? ratesOf(base)).deliveryInstall.categories.find((x) =>
          /refrigerator/i.test(x.category),
        );
        return { market: c?.standardRate ?? 0, special: c?.batchRate ?? 0 };
      })(),
      workbook: Math.round(Number(tot.rows[0]?.workbook ?? 0) * 100) / 100,
      portal: Math.round(Number(tot.rows[0]?.portal ?? 0) * 100) / 100,
      byLine,
      plugByLine,
      defaultLines,
    };
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
        ...(await tripDetails(client, batch.id)),
        transportRules: await exportTransportRules(client),
        customRates: (await customRatesSummary(client, true)) ?? undefined,
        fridgeLogic: await exportFridgeLogic(client, String(batch.id)),
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
      const lines = (await revenueExportLines(client, batchId, {}, 50000)) as (LogicSummaryLine & {
        id?: unknown;
      })[];
      const dandi = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
      const summary = buildLogicSummary(batch!, lines.map(toLogicLine), dandi);
      // The workbook check re-prices lines with the rate card, which has no daily trip cap
      // (#254). Compare it with the line figures before the cap, and report the cap apart.
      const sheet = await listSheetRows(client, batchId, 'CSIDI');
      if (!sheet.length) return { ...summary, transportCap: null };
      const tLines = await listTransportLines(client, batchId);
      const noCap = computeTransport(sheet, {
        dailyCap: false,
        deliveryOnlyCap: false,
        mixedInvoiceTransport: true,
        maxTrips: 2,
      });
      const before = new Map(
        lineAdjustments(noCap, tLines).updates.map((u) => [String(u.id), u.revenue]),
      );
      const wb = new Map(tLines.map((l) => [String(l.id), l.workbookRevenue]));
      const preCap = lines.map((l) => {
        const id = String(l.id);
        return toLogicLine({
          ...l,
          revenue: before.has(id) ? before.get(id)! : wb.has(id) ? wb.get(id)! : l.revenue,
        });
      });
      const check = buildLogicSummary(batch!, preCap, dandi);
      const rules = await getTransportRules(client);
      const calc = computeTransport(sheet, rules);
      const dropped = calc.invoices.filter((i) => !i.charged && i.charge > 0);
      return {
        ...summary,
        reconciliation: check.reconciliation,
        transportCap: {
          rules,
          preset: presetOf(rules),
          tripsNotCharged: dropped.length,
          notCharged: Math.round(dropped.reduce((t, i) => t + i.charge, 0) * 100) / 100,
        },
      };
    });
  }

  const toLogicLine = (l: LogicSummaryLine): LogicSummaryLine => ({
    ...l,
    qty: Number(l.qty ?? 0),
    unitPrice: Number(l.unitPrice ?? 0),
    revenue: Number(l.revenue ?? 0),
    originalJobValue: Number(l.originalJobValue ?? 0),
  });

  // Transport view of one sales person (#255): for the invoices matching the worked-example
  // filters, which trips were charged and which the daily cap left uncharged, by day.
  async function salespersonTransport(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query) as RevenueFilters;
    if (!filters.salesPerson)
      throw new RevenueDashboardServiceError('no-data', 'Choose a sales person.');
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, data: null };
      const listed = await revenueInvoiceList(client, batch.id, filters, 5000);
      const rules = await getTransportRules(client);
      const sheet = await listSheetRows(client, batch.id, 'CSIDI');
      const calc = sheet.length ? computeTransport(sheet, rules) : { invoices: [] };
      const byInv = new Map(calc.invoices.map((i) => [i.invoice, i]));
      const customer = new Map(listed.map((l) => [l.invoice, l.customer]));
      const status = (inv: string) => {
        const t = byInv.get(inv);
        if (!t || t.kind === 'none' || t.charge === 0) return 'none';
        if (!t.charged) return 'not_charged';
        return t.kind === 'delivery' ? 'delivery' : 'charged';
      };
      const invoices = listed.map((l) => {
        const t = byInv.get(l.invoice);
        return {
          invoice: l.invoice,
          date: l.date,
          customer: l.customer,
          status: status(l.invoice),
          rank: t?.rank ?? null,
          charge: t?.charge ?? 0,
        };
      });
      const count = (s: string) => invoices.filter((i) => i.status === s).length;
      const notCharged = invoices.filter((i) => i.status === 'not_charged');
      // Days over the cap: every capped trip of that salesperson-day, so the ranking reads in full.
      const overDates = [...new Set(notCharged.map((i) => i.date))].sort();
      const people = new Set(notCharged.map((i) => byInv.get(i.invoice)?.salesperson));
      const overDays = overDates.map((date) => {
        const trips = calc.invoices
          .filter((t) => t.date === date && people.has(t.salesperson) && t.rank !== null)
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .map((t) => ({
            invoice: t.invoice,
            rank: t.rank,
            charge: t.charge,
            charged: t.charged,
            customer: customer.get(t.invoice) ?? null,
          }));
        return {
          date,
          trips: trips.length,
          charged: trips.filter((t) => t.charged),
          notCharged: trips.filter((t) => !t.charged),
          amount:
            Math.round(trips.filter((t) => !t.charged).reduce((a, t) => a + t.charge, 0) * 100) /
            100,
        };
      });
      const installTrips = invoices.filter(
        (i) =>
          i.status === 'charged' ||
          (i.status === 'not_charged' && byInv.get(i.invoice)?.kind === 'installation'),
      ).length;
      return {
        batch,
        data: {
          salesPerson: filters.salesPerson,
          rules,
          preset: presetOf(rules),
          rulesLabel: bannerOf(presetOf(rules), null).label,
          sheetMissing: !sheet.length,
          counts: {
            all: invoices.length,
            notCharged: notCharged.length,
            charged: count('charged'),
            delivery: count('delivery'),
            none: count('none'),
          },
          installTrips,
          notChargedAmount: Math.round(notCharged.reduce((a, i) => a + i.charge, 0) * 100) / 100,
          days: new Set(invoices.map((i) => i.date).filter(Boolean)).size,
          overDays,
          invoices,
        },
      };
    } finally {
      client.release();
    }
  }

  // Not-charged list for management (#255): one row per invoice the cap left uncharged.
  async function salespersonTransportExport(query: Record<string, unknown>) {
    const res = await salespersonTransport(query);
    if (!res.data)
      throw new RevenueDashboardServiceError('no-data', 'No master workbook uploaded.');
    const d = res.data;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Not charged');
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Invoice', key: 'invoice', width: 14 },
      { header: 'Customer', key: 'customer', width: 46 },
      { header: 'Trip of the day', key: 'trip', width: 15 },
      { header: 'Transport not charged (AED)', key: 'charge', width: 26 },
    ];
    for (const day of d.overDays)
      for (const t of day.notCharged)
        ws.addRow({
          date: day.date,
          invoice: t.invoice,
          customer: t.customer ?? '',
          trip: t.rank + ' of ' + day.trips,
          charge: t.charge,
        });
    const total = ws.addRow({ customer: 'Total', charge: d.notChargedAmount });
    total.font = { bold: true };
    ws.getRow(1).font = { bold: true };
    ws.getColumn('charge').numFmt = '#,##0.00';
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const info = wb.addWorksheet('About');
    info.addRows([
      ['Sales person', d.salesPerson],
      ['Filters', JSON.stringify(revenueFilterQuerySchema.parse(query))],
      ['Transport rules', d.rulesLabel],
      ['Source', res.batch?.fileName ?? ''],
    ]);
    info.getColumn(1).width = 18;
    info.getColumn(2).width = 80;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // Worked-example picker: invoices matching year / month / week / job type /
  // search, newest first (at most 300).
  async function logicInvoices(query: Record<string, unknown>) {
    const filters = revenueFilterQuerySchema.parse(query) as RevenueFilters;
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, invoices: [], salesPersons: [] };
      return {
        batch,
        invoices: await revenueInvoiceList(client, batch.id, filters, 300),
        salesPersons: await revenueInvoiceSalesPersons(client, batch.id, filters),
      };
    } finally {
      client.release();
    }
  }

  // Worked example for the invoices given (comma / space separated, up to 20): every line of each
  // invoice, with how it was priced. The ERP numbers each document series on its own, so an invoice
  // is its number plus its job family (repair CSIJO/CSIJW, delivery CSIDI/CSIDO/CSIII). An entry is
  // either a plain number (one card per family that carries it) or "number::repair" / "number::delivery".
  async function logicExample(query: Record<string, unknown>) {
    const entries = [
      ...new Set(
        String(query.invoices ?? '')
          .split(/[\s,;]+/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20);
    if (!entries.length)
      throw new RevenueDashboardServiceError('no-data', 'Enter at least one invoice number.');
    const parsed = entries.map((entry) => {
      const [number, family] = entry.split('::');
      return {
        entry,
        number: number ?? entry,
        family: (family === 'repair' || family === 'delivery' ? family : null) as
          'repair' | 'delivery' | null,
      };
    });
    const invoices = [...new Set(parsed.map((p) => p.number))];
    const client = await pool.connect();
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, examples: [], notFound: invoices };
      const raw = (await revenueInvoiceLines(client, batch.id, invoices)) as (LogicSummaryLine & {
        workbookRevenue?: unknown;
      })[];
      const dandi = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
      const rules = applyFlatRates(rulesOfBatch(batch), dandi.flatRates);
      const transport = await exampleTransport(client, batch.id, invoices);
      // The groups to show, in the order asked: one per (number, family).
      const wanted: { number: string; family: 'repair' | 'delivery' }[] = [];
      for (const p of parsed) {
        const families: ('repair' | 'delivery')[] = p.family
          ? [p.family]
          : (['delivery', 'repair'] as const).filter((f) =>
              raw.some((r) => String(r.invDelNo) === p.number && invoiceFamilyOf(r.jobType) === f),
            );
        for (const family of families)
          if (!wanted.some((w) => w.number === p.number && w.family === family))
            wanted.push({ number: p.number, family });
      }
      const examples = wanted
        .map((w) => ({
          ...w,
          lines: raw.filter(
            (r) => String(r.invDelNo) === w.number && invoiceFamilyOf(r.jobType) === w.family,
          ),
        }))
        .filter((x) => x.lines.length)
        .map((x) => {
          // The example explains the workbook figures (#252); the dashboard figure under the
          // transport rules is given in the transport note when it differs.
          const current = x.lines.reduce((sum, r) => sum + Number(r.revenue ?? 0), 0);
          const set = x.lines
            .map((r) => ({
              ...r,
              revenue: r.workbookRevenue === undefined ? r.revenue : Number(r.workbookRevenue),
            }))
            .map((r) => toLogicLine(r as LogicSummaryLine));
          const ex = buildWorkedExample(rules, x.number, set);
          const jobTypes = [...new Set(set.map((l) => l.jobType))];
          // Transport rules cover delivery documents only; a repair invoice has no transport note.
          const note =
            x.family === 'delivery'
              ? transportNote(transport, x.number, jobTypes, Math.round(current * 100) / 100)
              : null;
          return {
            ...capWording(ex, note),
            transport: note,
            family: x.family,
            key: `${x.number}::${x.family}`,
          };
        });
      const found = new Set(examples.map((e) => e.invoice));
      return { batch, examples, notFound: invoices.filter((i) => !found.has(i)) };
    } finally {
      client.release();
    }
  }

  // The saved transport switches and their plain-English label, for the report's banner.
  async function exportTransportRules(client: import('pg').PoolClient) {
    const rules = await getTransportRules(client);
    return {
      label: bannerOf(presetOf(rules), null).label,
      dailyCap: rules.dailyCap,
      deliveryOnlyCap: rules.deliveryOnlyCap,
      mixedInvoiceTransport: rules.mixedInvoiceTransport,
      maxTrips: rules.maxTrips,
    };
  }

  // Invoices whose trip charge the daily cap leaves uncharged, under the saved rules: the report
  // export says so instead of listing them as a difference from the rate card (the rate card has no cap).
  // Also the trip number of each invoice within its salesperson's day, for the export's
  // "Trip no. of day" and "Transport note" columns.
  async function tripDetails(client: import('pg').PoolClient, batchId: string) {
    const cappedTrips = new Map<string, number>();
    const tripInfo = new Map<
      string,
      { rank: number; trips: number; charge: number; charged: boolean }
    >();
    const rows = await listSheetRows(client, batchId, 'CSIDI');
    if (!rows.length) return { cappedTrips, tripInfo };
    const rules = await getTransportRules(client);
    const invoices = computeTransport(rows, rules).invoices;
    const perDay = new Map<string, number>();
    for (const i of invoices)
      if (i.rank !== null) {
        const k = i.date + '|' + i.salesperson;
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
    for (const i of invoices) {
      if (i.rank === null) continue;
      tripInfo.set(String(i.invoice), {
        rank: i.rank,
        trips: perDay.get(i.date + '|' + i.salesperson) ?? 1,
        charge: i.charge,
        charged: i.charged,
      });
      if (!i.charged && i.charge > 0) cappedTrips.set(String(i.invoice), i.charge);
    }
    return { cappedTrips, tripInfo };
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

  // Worked example wording under the daily trip cap (#256). The rate card has no cap, so a trip the
  // cap left uncharged looked like "transport missing from the workbook". Say what happened instead.
  function capWording(ex: WorkedExample, note: ReturnType<typeof transportNote>): WorkedExample {
    if (!note || !('status' in note) || note.status !== 'over_cap') return ex;
    const n = note as Extract<typeof note, { rank: unknown }>;
    const aed = 'AED ' + String(Math.round(Number(n.charge) * 100) / 100);
    const capText = n.maxTrips + '-trip daily cap';
    // The line agrees with the rules once the cap is taken into account: no warning on it;
    // the Transport note and the bullet below explain the missing charge.
    const lines = ex.lines.map((l) => {
      if (l.checkDiff === undefined || Math.abs(l.checkDiff - Number(n.charge)) > 0.01) return l;
      const { check: _check, checkDiff: _d, checkCause: _c, ...rest } = l;
      void _check;
      void _d;
      void _c;
      return rest;
    });
    const notes = ex.notes.map((t) => {
      if (!t.startsWith('Transport:')) return t;
      return n.carrier === 'CSIDI'
        ? 'Transport: ' +
            aed +
            ' would be added once for this invoice (more than 1 unit), but the ' +
            capText +
            ' leaves it uncharged (see below).'
        : 'Transport: the regional rate (' +
            aed +
            ') on the delivery-only line pays for the shared visit, but the ' +
            capText +
            ' leaves it uncharged (see below).';
    });
    return { ...ex, lines, notes };
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
  async function loadRevenueInputs(client: PoolClient, batchId: string) {
    const stored = await getTransportRules(client);
    const lines = await listRateLines(client, batchId);
    const transportLines = await listTransportLines(client, batchId);
    const sheetRows = await listSheetRows(client, batchId, 'CSIDI');
    const base = rulesOfBatch({ summary: await batchSummary(client, batchId) } as never);
    return {
      inputs: {
        lines,
        transportLines,
        sheetRows,
        transportRules: {
          dailyCap: stored.dailyCap,
          deliveryOnlyCap: stored.deliveryOnlyCap,
          mixedInvoiceTransport: stored.mixedInvoiceTransport,
          maxTrips: stored.maxTrips,
        },
      },
      base,
    };
  }

  /** Litres and 13A/15A plug quantities the new fridge logic needs. */
  async function fridgeContext(
    client: PoolClient,
    batchId: string,
    inputs: Awaited<ReturnType<typeof loadRevenueInputs>>['inputs'],
  ) {
    const models: string[] = [];
    for (const l of inputs.lines) {
      const p = l.pricing as {
        applianceCategory?: string | null;
        erpModels?: string | null;
      } | null;
      if (p?.applianceCategory === FRIDGE_CATEGORY && p.erpModels)
        models.push(...p.erpModels.split(/[,;/]/));
    }
    const lookup = await capacityForCodes(client, models);
    const plugQty = plugQuantities(await listSheetRows(client, batchId, 'Net Sale Current'));
    return { lookup, plugQty };
  }

  async function applyRulesToBatch(client: PoolClient, batchId: string) {
    const { inputs, base } = await loadRevenueInputs(client, batchId);
    const custom = parseRateSet((await getRateOverrides(client)).payload);
    const fridgeSettings = await getFridgeLogic(client);
    let revenue: Map<string, number>;
    let unmatched = 0;
    if (fridgeSettings.enabled) {
      // New fridge logic (modification #306): fridges and 13A/15A plugs re-priced on top of the workbook.
      const { lookup, plugQty } = await fridgeContext(client, batchId, inputs);
      revenue = fridgeRevenue(
        inputs,
        base,
        custom ?? ratesOf(base),
        fridgeSettings,
        lookup,
        plugQty,
      ).revenue;
    } else {
      const next = custom ? overlayRates(base, custom) : base;
      ({ revenue, unmatched } = computeRevenue(inputs, base, next));
    }
    const updates = inputs.lines
      .map((l) => ({
        id: l.id,
        revenue: revenue.get(l.id) ?? l.workbookRevenue,
        wb: l.workbookRevenue,
      }))
      .filter((u) => Math.abs(u.revenue - u.wb) >= 0.005)
      .map(({ id, revenue: r }) => ({ id, revenue: r }));
    await applyTransportRevenue(client, batchId, updates);
    await markRateOverridesApplied(client, batchId);
    return { unmatched, invoices: 0 };
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

  // ---- Custom rates (Rate card tab), modification #290 -------------------------------------------
  const rate = z.number().finite().min(0).max(100000);
  const categoryRates = z.object({
    category: z.string().min(1).max(80),
    batchRate: rate,
    standardRate: rate,
    minimumRate: rate,
  });
  const masterRates = z.object({
    categories: z.array(categoryRates).min(1).max(20),
    discounts: z.array(z.number().finite().min(0).max(0.95)).max(40),
  });
  const rateSetSchema = z.object({
    jobRates: z.object({ CSIJW: rate, CSIJO: rate, CSIDO: rate, RWR: rate }),
    transport: z.object({ Dubai: rate, Sharjah: rate }),
    deliveryInstall: masterRates,
    install: masterRates,
  });

  function parseRateSet(payload: unknown): RateSet | null {
    if (!payload) return null;
    const parsed = rateSetSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  const JOB_LABELS: Record<string, string> = {
    CSIJW: 'CSIJW - Warranty repairs',
    CSIJO: 'CSIJO - Non-warranty repairs',
    CSIDI: 'CSIDI - Delivery + installation',
    CSIII: 'CSIII - Installation only',
    CSIDO: 'CSIDO - Delivery only',
  };

  function impactOf(
    inputs: Awaited<ReturnType<typeof loadRevenueInputs>>['inputs'],
    base: ReturnType<typeof rulesOfBatch>,
    custom: RateSet,
    full = true,
  ) {
    const next = overlayRates(base, custom);
    const before = computeRevenue(inputs, base, base).revenue;
    const after = computeRevenue(inputs, base, next).revenue;
    const a = totalsOf(inputs.lines, before);
    const b = totalsOf(inputs.lines, after);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const affected = new Map<string, number>();
    for (const l of inputs.lines)
      if (Math.abs((after.get(l.id) ?? 0) - (before.get(l.id) ?? 0)) >= 0.005)
        affected.set(l.jobType, (affected.get(l.jobType) ?? 0) + 1);
    const types = [...new Set([...a.byType.keys(), ...b.byType.keys()])].sort();
    const byJobType = types.map((t) => ({
      jobType: t,
      label: JOB_LABELS[t] ?? t,
      jobsAffected: affected.get(t) ?? 0,
      workbookRates: r2(a.byType.get(t) ?? 0),
      customRates: r2(b.byType.get(t) ?? 0),
      change: r2((b.byType.get(t) ?? 0) - (a.byType.get(t) ?? 0)),
    }));
    const months = [...new Set([...a.byMonth.keys(), ...b.byMonth.keys()])].sort((x, y) => x - y);
    const byMonth = months.map((m) => ({
      month: m,
      workbookRates: r2(a.byMonth.get(m) ?? 0),
      customRates: r2(b.byMonth.get(m) ?? 0),
      change: r2((b.byMonth.get(m) ?? 0) - (a.byMonth.get(m) ?? 0)),
    }));
    // By salesperson, one row per rate that was changed, and the biggest single moves with a reason.
    if (!full) {
      return {
        workbookRates: r2(a.byType.size ? [...a.byType.values()].reduce((t, v) => t + v, 0) : 0),
        customRates: r2(b.byType.size ? [...b.byType.values()].reduce((t, v) => t + v, 0) : 0),
      };
    }
    const person = new Map<string, { jobs: number; before: number; after: number }>();
    const moved: { line: (typeof inputs.lines)[number]; delta: number }[] = [];
    for (const l of inputs.lines) {
      const who = l.salesPerson?.trim() || '(none)';
      const e = person.get(who) ?? { jobs: 0, before: 0, after: 0 };
      const was = before.get(l.id) ?? 0;
      const now = after.get(l.id) ?? 0;
      e.before += was;
      e.after += now;
      if (Math.abs(now - was) >= 0.005) {
        e.jobs += 1;
        moved.push({ line: l, delta: now - was });
      }
      person.set(who, e);
    }
    const byPerson = [...person.entries()]
      .filter(([, e]) => e.jobs > 0)
      .map(([salesPerson, e]) => ({
        salesPerson,
        jobsAffected: e.jobs,
        workbookRates: r2(e.before),
        customRates: r2(e.after),
        change: r2(e.after - e.before),
      }))
      .sort((x, y) => x.change - y.change);
    const baseSet = ratesOf(base);
    const byRate = diffRates(baseSet, custom).map((d) => {
      const one = computeRevenue(
        inputs,
        base,
        overlayRates(base, singleChange(baseSet, custom, d.key)),
      ).revenue;
      let jobs = 0;
      let effect = 0;
      for (const l of inputs.lines) {
        const diff = (one.get(l.id) ?? 0) - (before.get(l.id) ?? 0);
        if (Math.abs(diff) >= 0.005) {
          jobs += 1;
          effect += diff;
        }
      }
      return { label: d.label, from: d.from, to: d.to, jobsAffected: jobs, change: r2(effect) };
    });
    const examples = moved
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 8)
      .map(({ line, delta }) => ({
        invoice: line.invDelNo,
        date: line.orderDate ?? null,
        salesPerson: line.salesPerson ?? null,
        customer: line.customer ?? null,
        jobType: line.jobType,
        workbookRevenue: r2(before.get(line.id) ?? 0),
        customRevenue: r2(after.get(line.id) ?? 0),
        change: r2(delta),
        reason: reasonOf(line, base, next),
      }));
    const sum = (k: 'workbookRates' | 'customRates') => r2(byJobType.reduce((t, x) => t + x[k], 0));
    const workbookRates = sum('workbookRates');
    const customRates = sum('customRates');
    return {
      workbookRates,
      customRates,
      change: r2(customRates - workbookRates),
      changePct: workbookRates ? r2(((customRates - workbookRates) / workbookRates) * 100) : 0,
      jobsAffected: [...affected.values()].reduce((t, v) => t + v, 0),
      byJobType,
      byMonth,
      byPerson,
      byRate,
      examples,
    };
  }

  /** Small summary for the banner, the Logic applied tab and the export. Null when no custom rates are locked. */
  async function customRatesSummary(client: PoolClient, full = false) {
    const stored = await getRateOverrides(client);
    const custom = parseRateSet(stored.payload);
    if (!custom) return null;
    const batch = await findActiveBatch(client, 'revenue');
    if (!batch) return null;
    const { inputs, base } = await loadRevenueInputs(client, batch.id);
    const totals = impactOf(inputs, base, custom, true) as {
      workbookRates: number;
      customRates: number;
      byRate?: { label: string; from: number; to: number; jobsAffected: number; change: number }[];
    };
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const change = r2(totals.customRates - totals.workbookRates);
    return {
      lockedAt: stored.lockedAt,
      updatedByName: stored.updatedByName,
      workbookRates: totals.workbookRates,
      customRates: totals.customRates,
      change,
      changePct: totals.workbookRates ? r2((change / totals.workbookRates) * 100) : 0,
      changes: diffRates(ratesOf(base), custom),
      byRate: totals.byRate ?? [],
      custom,
      workbook: ratesOf(base),
    };
  }

  async function rateStatus() {
    const client = await pool.connect();
    try {
      const sum = await customRatesSummary(client);
      if (!sum) return { active: false };
      const { custom: _c, workbook: _w, ...light } = sum;
      return { active: true, ...light };
    } finally {
      client.release();
    }
  }

  async function rateCard() {
    const client = await pool.connect();
    try {
      const stored = await getRateOverrides(client);
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch) return { batch: null, workbook: null, custom: null, active: false };
      const { inputs, base } = await loadRevenueInputs(client, batch.id);
      const custom = parseRateSet(stored.payload);
      const workbook = ratesOf(base);
      const dandi = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
      const masters = ratesFromMasters(dandi, base);
      const fridgeLogic = await getFridgeLogic(client);
      const tot = await client.query<{ workbook: string; portal: string }>(
        `SELECT COALESCE(SUM(workbook_revenue), 0) AS workbook, COALESCE(SUM(revenue), 0) AS portal
           FROM revenue_lines WHERE batch_id = $1`,
        [batch.id],
      );
      const r2t = (v: string) => Math.round(Number(v) * 100) / 100;
      return {
        fridgeLogic,
        figures: {
          workbook: r2t(tot.rows[0]?.workbook ?? '0'),
          portal: r2t(tot.rows[0]?.portal ?? '0'),
        },
        batch: { id: batch.id, fileName: batch.fileName, uploadedAt: batch.uploadedAt },
        workbook,
        custom,
        active: !!custom,
        lockedAt: stored.lockedAt,
        updatedByName: stored.updatedByName,
        appliedToActive: stored.appliedBatchId === String(batch.id),
        discountLabels: {
          deliveryInstall: base.deliveryInstall.discounts.map((d) => d.tier),
          install: base.install.discounts.map((d) => d.tier),
        },
        impact: custom ? impactOf(inputs, base, custom) : null,
        masters,
        // "Apply to Pricing Masters" is offered when the masters differ from the locked custom rates.
        mastersDiffer: custom ? diffRates(masters, custom).length > 0 : false,
        workbookDiffersFromMasters: diffRates(masters, workbook).length > 0,
      };
    } finally {
      client.release();
    }
  }

  function checkRateSet(base: ReturnType<typeof rulesOfBatch>, set: RateSet) {
    const w = ratesOf(base);
    for (const key of ['deliveryInstall', 'install'] as const) {
      const names = w[key].categories.map((c) => c.category).join('|');
      if (names !== set[key].categories.map((c) => c.category).join('|'))
        throw new RevenueDashboardServiceError(
          'invalid-rates',
          'The rate card has changed since this screen was opened. Reload it and try again.',
        );
      if (w[key].discounts.length !== set[key].discounts.length)
        throw new RevenueDashboardServiceError(
          'invalid-rates',
          'The volume discount tiers have changed. Reload the screen and try again.',
        );
    }
  }

  async function lockRateCard(body: unknown, profileId: string) {
    const input = rateSetSchema.parse((body as { rates?: unknown } | null)?.rates);
    await withTransaction(pool, async (client) => {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch)
        throw new RevenueDashboardServiceError('no-upload', 'Upload the master workbook first.');
      const { base } = await loadRevenueInputs(client, batch.id);
      checkRateSet(base, input);
      const changes = diffRates(ratesOf(base), input);
      // Nothing differs from the workbook: that is the same as "back to workbook rates".
      await saveRateOverrides(client, changes.length ? input : null, profileId);
      await applyRulesToBatch(client, batch.id);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: changes.length
          ? 'revenue_dashboard.rate_card_locked'
          : 'revenue_dashboard.rate_card_reset',
        targetType: 'revenue_rate_overrides',
        targetId: '1',
        metadata: { batchId: batch.id, changes },
      });
    });
    return rateCard();
  }

  async function resetRateCard(profileId: string) {
    await withTransaction(pool, async (client) => {
      await saveRateOverrides(client, null, profileId);
      const batch = await findActiveBatch(client, 'revenue');
      if (batch) await applyRulesToBatch(client, batch.id);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.rate_card_reset',
        targetType: 'revenue_rate_overrides',
        targetId: '1',
        metadata: { batchId: batch?.id ?? null },
      });
    });
    return rateCard();
  }

  // ---- Scenario test of the new fridge logic (modification #304). Read only: nothing is saved. ----
  const scenarioSchema = z.object({
    rates: rateSetSchema,
    fridge: z.object({
      smallBase: rate,
      smallOver10: rate,
      smallMinimum: rate,
      optionB: z.boolean(),
      plugAmount: rate,
    }),
  });

  async function scenarioContext(client: PoolClient) {
    const batch = await findActiveBatch(client, 'revenue');
    if (!batch)
      throw new RevenueDashboardServiceError('no-upload', 'Upload the master workbook first.');
    const { inputs, base } = await loadRevenueInputs(client, batch.id);
    const custom = parseRateSet((await getRateOverrides(client)).payload);
    return { batch, inputs, base, custom };
  }

  const fridgeLogicSchema = z.object({
    enabled: z.boolean(),
    smallBase: rate,
    smallOver10: rate,
    smallMinimum: rate,
    optionB: z.boolean(),
    plugAmount: rate,
  });

  async function savedFridge(client: PoolClient) {
    const f = await getFridgeLogic(client);
    return {
      smallBase: f.smallBase,
      smallOver10: f.smallOver10,
      smallMinimum: f.smallMinimum,
      optionB: f.optionB,
      plugAmount: f.plugAmount,
    };
  }

  // Saves the new-fridge-logic settings and switch, then re-prices the active workbook.
  async function saveFridgeLogicSettings(body: unknown, profileId: string) {
    const input = fridgeLogicSchema.parse(body);
    await withTransaction(pool, async (client) => {
      const before = await getFridgeLogic(client);
      await saveFridgeLogic(client, input, profileId);
      const batch = await findActiveBatch(client, 'revenue');
      if (batch) await applyRulesToBatch(client, batch.id);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.fridge_logic_saved',
        targetType: 'revenue_fridge_logic',
        targetId: '1',
        metadata: { batchId: batch?.id ?? null, before, after: input },
      });
    });
    return rateCard();
  }

  async function scenarioDefaults() {
    const client = await pool.connect();
    try {
      const { batch, base, custom } = await scenarioContext(client);
      return {
        batch: { id: batch.id, fileName: batch.fileName, uploadedAt: batch.uploadedAt },
        live: custom ?? ratesOf(base),
        customLocked: !!custom,
        fridge: await savedFridge(client),
        fridgeCategory: FRIDGE_CATEGORY,
        discountLabels: {
          deliveryInstall: base.deliveryInstall.discounts.map((d) => d.tier),
          install: base.install.discounts.map((d) => d.tier),
        },
      };
    } finally {
      client.release();
    }
  }

  async function scenarioCompute(body: unknown) {
    const parsed = scenarioSchema.safeParse((body as { scenario?: unknown } | null)?.scenario);
    if (!parsed.success)
      throw new RevenueDashboardServiceError(
        'invalid-rates',
        'Send every scenario rate as a number of 0 or more.',
      );
    const client = await pool.connect();
    try {
      const { batch, inputs, base, custom } = await scenarioContext(client);
      checkRateSet(base, parsed.data.rates);
      const { lookup, plugQty } = await fridgeContext(client, String(batch.id), inputs);
      const result = runScenario(inputs, base, custom, parsed.data, lookup, plugQty);
      return { batch, settings: parsed.data, result };
    } finally {
      client.release();
    }
  }

  async function scenarioRun(body: unknown) {
    const { batch, result } = await scenarioCompute(body);
    const { invoices, ...rest } = result;
    return {
      batch: { id: batch.id, fileName: batch.fileName, uploadedAt: batch.uploadedAt },
      ...rest,
      invoiceCount: invoices.length,
      invoices: invoices.slice(0, 300),
    };
  }

  async function scenarioExport(body: unknown, profileId: string, requestId?: string) {
    const { batch, settings, result } = await scenarioCompute(body);
    const client = await pool.connect();
    try {
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'revenue_dashboard.scenario_exported',
        targetType: 'revenue_rate_overrides',
        targetId: '1',
        requestId,
        metadata: { batchId: batch.id },
      });
    } finally {
      client.release();
    }
    return buildScenarioWorkbook(batch.fileName, settings, result);
  }

  // Writes the locked custom rates into Pricing Masters (D+I Admin Entry). Both confirmation steps
  // happen on screen; the server also wants the word APPLY so a stray call cannot change the masters.
  async function applyRateCardToMasters(body: unknown, profileId: string, requestId: string) {
    if ((body as { confirm?: unknown } | null)?.confirm !== 'APPLY')
      throw new RevenueDashboardServiceError('not-confirmed', 'Type APPLY to confirm.');
    const client = await pool.connect();
    let current: DandiPricingInput;
    let custom: RateSet | null;
    let base;
    try {
      custom = parseRateSet((await getRateOverrides(client)).payload);
      const batch = await findActiveBatch(client, 'revenue');
      if (!custom || !batch)
        throw new RevenueDashboardServiceError(
          'no-custom-rates',
          'There are no locked custom rates to apply.',
        );
      base = (await loadRevenueInputs(client, batch.id)).base;
      current = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
    } finally {
      client.release();
    }
    const changes = diffRates(ratesFromMasters(current, base), custom);
    const { payload, skipped } = mastersFromRates(current, custom, base);
    await pricing.save('dandi_pricing', payload, profileId, requestId, {
      source: 'revenue_rate_card',
      changes,
      skipped,
    });
    return { applied: changes.length, skipped };
  }

  // Puts the workbook's own rates back into Pricing Masters (the "Excel value" in its history).
  async function restoreMastersToWorkbookRates(
    body: unknown,
    profileId: string,
    requestId: string,
  ) {
    if ((body as { confirm?: unknown } | null)?.confirm !== 'RESTORE')
      throw new RevenueDashboardServiceError('not-confirmed', 'Type RESTORE to confirm.');
    const client = await pool.connect();
    let current: DandiPricingInput;
    let base;
    let fileName = '';
    try {
      const batch = await findActiveBatch(client, 'revenue');
      if (!batch)
        throw new RevenueDashboardServiceError('no-upload', 'Upload the master workbook first.');
      fileName = batch.fileName;
      base = (await loadRevenueInputs(client, batch.id)).base;
      current = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
    } finally {
      client.release();
    }
    const workbook = ratesOf(base);
    const changes = diffRates(ratesFromMasters(current, base), workbook);
    const { payload, skipped } = mastersFromRates(current, workbook, base);
    await pricing.save('dandi_pricing', payload, profileId, requestId, {
      source: 'workbook_rates',
      workbookFile: fileName,
      changes,
      skipped,
    });
    return { restored: changes.length, skipped, fileName };
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
    salespersonTransport,
    salespersonTransportExport,
    recordActivity,
    transportRules,
    saveTransportRulesAndApply,
    rateCard,
    rateStatus,
    customRatesSummary,
    lockRateCard,
    resetRateCard,
    applyRateCardToMasters,
    restoreMastersToWorkbookRates,
    saveFridgeLogicSettings,
    scenarioDefaults,
    scenarioRun,
    scenarioExport,
  };
}

export type RevenueDashboardService = ReturnType<typeof createRevenueDashboardService>;
