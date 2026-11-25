import ExcelJS from 'exceljs';
import type { ImportBatch } from '../../../../packages/db/src/revenue-dashboard.js';
import { buildLogicSheet, type LogicLine } from './logic-sheet.js';
import { overlayRates, type RateSet } from './rate-overrides.js';
import {
  applyFlatRates,
  DEFAULT_PRICING_RULES,
  enrichLine,
  type PricingRules,
  type SheetPricing,
} from './pricing-logic.js';

type Group = {
  totals: { revenue: number; jobs: number; qty: number };
  rows: { key: string; revenue: number; jobs: number; qty: number }[];
};
type Matrix = {
  totals: Group['totals'];
  cells: { row: string; col: string; revenue: number; jobs: number; qty: number }[];
};

export type RevenueReportData = {
  batch: ImportBatch;
  filters: Record<string, unknown>;
  total: Group;
  monthly: Matrix;
  weekly: Matrix;
  channel: Group;
  salesPerson: Group;
  customer: Group;
  billingCode: Group;
  exceptions: {
    totals: Group['totals'];
    exceptions: { label: string; description: string; jobs: number; revenue: number }[];
  };
  lines: Record<string, unknown>[];
  /** Flat job-type rates from D+I Admin Entry; they replace the workbook's. */
  flatRates?: Parameters<typeof applyFlatRates>[1];
  /** Invoice -> transport charge the 2-trip daily cap leaves uncharged, under the saved rules. */
  cappedTrips?: Map<string, number>;
  /** Invoice -> its trip number within the salesperson's day (ranked by charge) and that day's trips. */
  tripInfo?: Map<string, { rank: number; trips: number; charge: number; charged: boolean }>;
  /** The saved transport rules, so the report says which rules its figures follow. */
  transportRules?: {
    label: string;
    dailyCap: boolean;
    deliveryOnlyCap: boolean;
    mixedInvoiceTransport: boolean;
    maxTrips: number;
  };
  /** Set while the new fridge logic is on (modification #307): what the report says about it and per-line details. */
  fridgeLogic?: {
    settings: {
      smallBase: number;
      smallOver10: number;
      smallMinimum: number;
      optionB: boolean;
      plugAmount: number;
    };
    rates: { market: number; special: number };
    workbook: number;
    portal: number;
    byLine: Map<
      string,
      { litres: number; source: string; defaultLitres: boolean; rule: string; large: boolean }
    >;
    plugByLine: Map<string, { qty: number; amount: number }>;
    defaultLines: number;
  };
  /** Set while an admin has locked custom rates: the report then says its revenue is not the workbook figure. */
  customRates?: {
    lockedAt: string | Date | null;
    updatedByName: string | null;
    workbookRates: number;
    customRates: number;
    change: number;
    changePct: number;
    byRate: { label: string; from: number; to: number; jobsAffected: number; change: number }[];
    custom: RateSet;
  };
};

/** One plain sentence on the saved transport switches, for the Summary and Logic sheets. */
export function transportRulesDetail(r: NonNullable<RevenueReportData['transportRules']>) {
  const on = (v: boolean) => (v ? 'on' : 'off');
  return (
    `Daily trip cap ${on(r.dailyCap)}` +
    (r.dailyCap ? ` (at most ${r.maxTrips} trips per salesperson per day are charged)` : '') +
    `; delivery-only cap ${on(r.deliveryOnlyCap)}; mixed-invoice transport ${on(r.mixedInvoiceTransport)}.`
  );
}

const NAVY = 'FF10233F';
const MONEY = '#,##0.00';

function header(sheet: ExcelJS.Worksheet, row: number) {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  r.alignment = { vertical: 'middle', wrapText: true };
}

function title(sheet: ExcelJS.Worksheet, text: string, columns: number) {
  sheet.mergeCells(1, 1, 1, Math.max(columns, 2));
  const cell = sheet.getCell(1, 1);
  cell.value = text;
  cell.font = { bold: true, size: 13, name: 'Arial', color: { argb: NAVY } };
  sheet.addRow([]);
}

function groupSheet(wb: ExcelJS.Workbook, name: string, label: string, group: Group) {
  const sheet = wb.addWorksheet(name);
  title(sheet, name + ' (AED)', 6);
  sheet.addRow([label, 'Jobs', 'Qty', 'Revenue (AED)', 'Share %', 'Avg / job (AED)']);
  header(sheet, 3);
  for (const r of group.rows) {
    sheet.addRow([
      r.key,
      r.jobs,
      r.qty,
      r.revenue,
      group.totals.revenue ? r.revenue / group.totals.revenue : 0,
      r.jobs ? r.revenue / r.jobs : 0,
    ]);
  }
  const t = sheet.addRow([
    'Total',
    group.totals.jobs,
    group.totals.qty,
    group.totals.revenue,
    1,
    group.totals.jobs ? group.totals.revenue / group.totals.jobs : 0,
  ]);
  t.font = { bold: true };
  sheet.getColumn(1).width = 38;
  [2, 3].forEach((c) => (sheet.getColumn(c).width = 12));
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 10;
  sheet.getColumn(6).width = 16;
  sheet.getColumn(4).numFmt = MONEY;
  sheet.getColumn(5).numFmt = '0.0%';
  sheet.getColumn(6).numFmt = MONEY;
  sheet.views = [{ state: 'frozen', ySplit: 3 }];
  return sheet;
}

function matrixSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rowLabel: string,
  matrix: Matrix,
  metric: 'revenue' | 'qty',
) {
  const sheet = wb.addWorksheet(name);
  const cols = [...new Set(matrix.cells.map((c) => c.col))].sort();
  const rows = [...new Set(matrix.cells.map((c) => c.row))].sort();
  title(sheet, name + (metric === 'revenue' ? ' (AED)' : ' (units)'), cols.length + 2);
  sheet.addRow([rowLabel, ...cols, 'Total']);
  header(sheet, 3);
  const lookup = new Map(matrix.cells.map((c) => [c.row + '\u0000' + c.col, c[metric]]));
  const colTotals = cols.map(() => 0);
  for (const row of rows) {
    const values = cols.map((col) => lookup.get(row + '\u0000' + col) ?? 0);
    values.forEach((v, i) => (colTotals[i]! += v));
    sheet.addRow([row, ...values, values.reduce((a, b) => a + b, 0)]);
  }
  const t = sheet.addRow(['Total', ...colTotals, colTotals.reduce((a, b) => a + b, 0)]);
  t.font = { bold: true };
  sheet.getColumn(1).width = 16;
  for (let c = 2; c <= cols.length + 2; c += 1) {
    sheet.getColumn(c).width = 16;
    if (metric === 'revenue') sheet.getColumn(c).numFmt = MONEY;
  }
  sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 1 }];
}

export async function buildRevenueReportWorkbook(data: RevenueReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jacky's Service Portal";
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  title(summary, 'Service Revenue Report - Summary', 2);
  const filterText =
    Object.entries(data.filters)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k} = ${String(v)}`)
      .join('; ') || 'None (all data)';
  const meta: [string, string | number][] = [
    ['Generated', new Date().toISOString()],
    ['Source workbook', data.batch.fileName],
    ['Source uploaded', data.batch.uploadedAt.toISOString()],
    ['Filters', filterText],
    ['Jobs', data.total.totals.jobs],
    ['Quantity', data.total.totals.qty],
    ['Revenue (AED)', data.total.totals.revenue],
    [
      'Average revenue per job (AED)',
      data.total.totals.jobs ? data.total.totals.revenue / data.total.totals.jobs : 0,
    ],
    [
      'Basis',
      data.customRates || data.fridgeLogic
        ? 'Revenue is the workbook figure (Revenue Source sheet) re-priced in the portal' +
          (data.customRates ? ' with the custom rates locked in the portal' : '') +
          (data.fridgeLogic ? ' and the new fridge logic' : '') +
          '; the workbook figure is shown beside it on the job sheets.'
        : 'Revenue is the figure calculated in the master Service Dashboard workbook (Revenue Source sheet).',
    ],
    [
      'Limitation',
      'Management analysis of the uploaded workbook; not an ERP/ledger extract. Reconcile to ERP postings.',
    ],
  ];
  for (const [k, v] of meta) summary.addRow([k, v]);
  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 90;
  summary.getColumn(1).font = { bold: true };
  summary.getCell('B9').numFmt = MONEY;
  summary.getCell('B10').numFmt = MONEY;
  summary.getColumn(2).alignment = { horizontal: 'left', wrapText: true };

  if (data.customRates) {
    const c = data.customRates;
    const when =
      c.lockedAt instanceof Date
        ? c.lockedAt.toISOString().slice(0, 16).replace('T', ' ')
        : String(c.lockedAt ?? '')
            .slice(0, 16)
            .replace('T', ' ');
    const first = summary.rowCount + 1;
    const rows: [string, string | number][] = [
      [
        'RATES',
        `CUSTOM RATES IN FORCE - locked${c.updatedByName ? ' by ' + c.updatedByName : ''}${when ? ', ' + when : ''}. The revenue in this report is NOT the workbook figure.`,
      ],
      ['Workbook revenue, whole upload (AED)', c.workbookRates],
      ['Revenue at custom rates, whole upload (AED)', c.customRates],
      ['Difference, whole upload (AED)', `${c.change} (${c.changePct}%)`],
      ['Rates changed', `${c.byRate.length} - see the "Rate changes" sheet.`],
    ];
    for (const [k, v] of rows) summary.addRow([k, v]);
    for (let r = first; r <= summary.rowCount; r++)
      for (const col of [1, 2])
        summary.getCell(r, col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3D6' },
        };
    summary.getCell(first + 1, 2).numFmt = MONEY;
    summary.getCell(first + 2, 2).numFmt = MONEY;
    const rc = wb.addWorksheet('Rate changes');
    title(rc, 'Rate changes - custom rates against the workbook (whole upload)', 5);
    rc.addRow(['Rate', 'Workbook (Excel)', 'Custom', 'Lines affected', 'Revenue effect (AED)']);
    header(rc, 3);
    for (const r of c.byRate) rc.addRow([r.label, r.from, r.to, r.jobsAffected, r.change]);
    rc.addRow(['Total revenue difference', '', '', '', c.change]);
    rc.getRow(rc.rowCount).font = { bold: true };
    rc.addRow([]);
    rc.addRow([
      'Each rate is measured on its own. When several rates change together the total can differ slightly from the sum, because they overlap on the same lines.',
    ]);
    [1, 2, 3, 4, 5].forEach((i, k) => (rc.getColumn(i).width = [44, 18, 14, 16, 22][k]!));
    [2, 3, 5].forEach((i) => (rc.getColumn(i).numFmt = MONEY));
  }

  groupSheet(wb, 'By Job Type', 'Job type', data.total);
  matrixSheet(wb, 'Monthly Revenue', 'Month', data.monthly, 'revenue');
  matrixSheet(wb, 'Monthly Qty (Accounts Review)', 'Month', data.monthly, 'qty');
  matrixSheet(wb, 'Weekly Revenue', 'Week', data.weekly, 'revenue');
  groupSheet(wb, 'By Channel', 'Sales channel', data.channel);
  groupSheet(wb, 'By Salesperson', 'Salesperson', data.salesPerson);
  groupSheet(wb, 'By Customer', 'Customer', data.customer);
  groupSheet(wb, 'By Billing Code', 'Billing code', data.billingCode);

  const ex = wb.addWorksheet('Exceptions');
  title(ex, 'Finance / data-quality exceptions', 4);
  ex.addRow(['Check', 'Jobs', 'Revenue at stake (AED)', 'What it means']);
  header(ex, 3);
  for (const e of data.exceptions.exceptions)
    ex.addRow([e.label, e.jobs, e.revenue, e.description]);
  ex.getColumn(1).width = 34;
  ex.getColumn(2).width = 10;
  ex.getColumn(3).width = 22;
  ex.getColumn(3).numFmt = MONEY;
  ex.getColumn(4).width = 90;

  const storedRules = (data.batch.summary as { pricingRules?: PricingRules }).pricingRules;
  const ownRules = storedRules?.deliveryInstall ? storedRules : DEFAULT_PRICING_RULES;
  // With custom rates locked, the revenue in this report follows them, so the rules used to rebuild each
  // line (the "Workbook minus rules" columns) must follow them too; otherwise the rate change would show
  // up as a workbook error.
  const rules: PricingRules = data.customRates
    ? overlayRates(ownRules, data.customRates.custom)
    : applyFlatRates(ownRules, data.flatRates);
  const enriched = data.lines.map((line) => {
    const pricing = (line.pricing as SheetPricing | null | undefined) ?? null;
    const e = enrichLine(rules, {
      jobType: String(line.jobType),
      qty: Number(line.qty ?? 0),
      unitPrice: Number(line.unitPrice ?? 0),
      revenue: Number(line.revenue ?? 0),
      remarks: (line.remarks as string | null) ?? null,
      billingCode: (line.billingCode as string | null) ?? null,
      originalJobValue: Number(line.originalJobValue ?? 0),
      pricing,
    });
    // The rate card has no daily cap: a trip the cap left uncharged is not a pricing error.
    const cap =
      line.jobType === 'CSIJO' || line.jobType === 'CSIJW'
        ? undefined
        : data.cappedTrips?.get(String(line.invDelNo ?? ''));
    if (
      cap !== undefined &&
      e.reconcileDiff !== null &&
      Math.abs(e.reconcileDiff + cap) <= 0.01 &&
      (e.diffCause === 'CSIDI transport' || e.diffCause === 'CSIDO flat charge')
    )
      e.diffCause = 'Daily trip cap';
    // New fridge logic (modification #307): fridge and plug lines differ from the rebuilt old-logic figure on purpose.
    const lid = String(line.id ?? '');
    if (
      data.fridgeLogic &&
      e.reconcileDiff !== null &&
      Math.abs(e.reconcileDiff) > 0.01 &&
      (data.fridgeLogic.byLine.has(lid) || data.fridgeLogic.plugByLine.has(lid))
    )
      e.diffCause = data.fridgeLogic.byLine.has(lid) ? 'New fridge logic' : '13A/15A plug';
    return { line, pricing, e };
  });

  type Row = (typeof enriched)[number];

  // Transport the daily cap leaves uncharged, shown once per invoice (on its first job line)
  // so a subtotal does not count the same trip twice. Display only: no figure changes.
  const unchargedByRow = new Map<Row, number>();
  const tripByRow = new Map<Row, { rank: number; note: string }>();
  {
    const seen = new Set<string>();
    const maxTrips = data.transportRules?.maxTrips ?? 2;
    const aed = (n: number) => `AED ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    for (const x of enriched) {
      const inv = String(x.line.invDelNo ?? '');
      // Trips belong to delivery documents; a repair invoice can carry the same number (ERP series differ).
      if (!inv || x.line.jobType === 'CSIJO' || x.line.jobType === 'CSIJW' || seen.has(inv))
        continue;
      const amount = data.cappedTrips?.get(inv);
      const trip = data.tripInfo?.get(inv);
      if (amount === undefined && !trip) continue;
      seen.add(inv);
      if (amount !== undefined) unchargedByRow.set(x, amount);
      if (trip)
        tripByRow.set(x, {
          rank: trip.rank,
          note: trip.charged
            ? `Trip ${trip.rank} of ${trip.trips} that day: transport ${aed(trip.charge)} charged.`
            : `Trip ${trip.rank} of ${trip.trips} that day: transport ${aed(trip.charge)} not charged (only the ${maxTrips} highest charges a day are charged).`,
        });
    }
  }
  if (data.fridgeLogic) {
    const f = data.fridgeLogic;
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const first = summary.rowCount + 1;
    const rows: [string, string | number][] = [
      [
        'FRIDGE LOGIC',
        `NEW FRIDGE LOGIC IN FORCE. Fridge 400 L and under: 1 unit market rate (AED ${fmt(f.rates.market)}), 2 to 10 units base (AED ${fmt(f.settings.smallBase)}), ${f.settings.optionB ? 'only the units above 10' : 'every unit when over 10'} at the second tier (AED ${fmt(f.settings.smallOver10)}), minimum AED ${fmt(f.settings.smallMinimum)}. Fridge over 400 L: 1 unit market rate, 2 or more the special rate (AED ${fmt(f.rates.special)}). No volume discount tiers for fridges. 13A/15A plug lines (REPAIR-MATERIAL): AED ${fmt(f.settings.plugAmount)} x quantity on top of the cooker rate, no discount. Washing machines, cookers and other categories are unchanged. Rates are read from the Rate card in the portal.`,
      ],
      ['Workbook figure, whole upload (AED)', f.workbook],
      ['Portal figure, whole upload (AED)', f.portal],
      ['Total difference from the workbook (AED)', Math.round((f.portal - f.workbook) * 100) / 100],
      ['Fridge lines on the default 400 L (no litres in the Stock Master)', f.defaultLines],
    ];
    for (const [k, v] of rows) summary.addRow([k, v]);
    for (let r = first; r < first + rows.length; r++)
      summary.getCell('A' + r).font = { bold: true };
    for (const r of [first + 1, first + 2, first + 3]) summary.getCell('B' + r).numFmt = MONEY;
  }

  if (data.transportRules) {
    const total = [...unchargedByRow.values()].reduce((a, b) => a + b, 0);
    summary.addRow(['Transport rules', data.transportRules.label]);
    summary.addRow(['Transport rule switches', transportRulesDetail(data.transportRules)]);
    summary.addRow([
      'Transport left uncharged by the cap (AED)',
      `${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${unchargedByRow.size} invoice${unchargedByRow.size === 1 ? '' : 's'} in this report. Revenue above already excludes it.`,
    ]);
  }
  type Col = {
    h: string;
    w: number;
    fmt?: string;
    group: string;
    /** Always kept, even when no exported job has a value in it. */
    core?: boolean;
    /** Add a SUBTOTAL for this column in the totals row. */
    sum?: boolean;
    get: (x: Row) => unknown;
  };
  const P = (pick: (p: SheetPricing) => unknown) => (x: Row) =>
    x.pricing ? pick(x.pricing) : null;
  const L = (key: string) => (x: Row) => x.line[key];
  const E = (key: keyof Row['e']) => (x: Row) => x.e[key];
  const yesNo = (v: boolean | null | undefined) => (v == null ? null : v ? 'Yes' : 'No');
  const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

  // ---- repairs: what the remarks say the appliance is --------------------
  const APPLIANCES: [RegExp, string][] = [
    [/REFRIGERATOR|FRIDGE|FREEZER|CHILLER/, 'Refrigerator / freezer'],
    [/WASHING MACHINE|WASHER|DRYER/, 'Washing machine / dryer'],
    [/COOKER|COOKING RANGE|OVEN|HOB|COOKTOP|BURNER/, 'Cooker / oven / hob'],
    [/DISH ?WASHER/, 'Dishwasher'],
    [/MICRO ?WAVE/, 'Microwave'],
    [/AIR CONDITION|\bA\/C\b|\bAC UNIT\b|\bSPLIT\b/, 'Air conditioner'],
    [/\bTV\b|TELEVISION/, 'Television'],
    [/WATER DISPENSER|DISPENSER/, 'Water dispenser'],
  ];
  const applianceFromRemarks = (x: Row) => {
    const r = String(x.line.remarks ?? '').toUpperCase();
    for (const [re, label] of APPLIANCES) if (re.test(r)) return label;
    return '';
  };
  const modelFromRemarks = (x: Row) => {
    const m = /\b[A-Z]{1,5}\d{2,}[A-Z0-9-]*\b/.exec(String(x.line.remarks ?? '').toUpperCase());
    return m ? m[0] : '';
  };
  const ruleApplied = (x: Row) => {
    const qty = Number(x.line.qty ?? 0);
    const price = Number(x.line.unitPrice ?? 0);
    const revenue = Number(x.line.revenue ?? 0);
    if (Math.abs(qty * price - revenue) < 0.01) return `Qty ${qty} x AED ${price}`;
    return `Flat AED ${revenue} (BER / RWR or special rule)`;
  };

  // A repair job carries it on its line (read from the CSIJW / CSIJO sheet);
  // a Delivery & Installation line carries it in its pricing detail.
  const refDocNo = (x: Row) => (x.line.refDocNo as string | null) ?? x.pricing?.refDocNo ?? null;

  const common = (g: string): Col[] => [
    { h: 'Date', w: 12, group: g, core: true, get: L('orderDate') },
    { h: 'Month', w: 7, group: g, core: true, get: L('month') },
    { h: 'Week', w: 7, group: g, core: true, get: L('weekNo') },
    { h: 'Job type', w: 10, group: g, core: true, get: L('jobType') },
    { h: 'Inv/Del no', w: 14, group: g, core: true, get: L('invDelNo') },
    { h: 'CSOSC order', w: 14, group: g, core: true, get: L('csoscOrderNo') },
    { h: 'Ref doc no', w: 18, group: g, get: refDocNo },
    { h: 'Customer', w: 38, group: g, core: true, get: L('customer') },
    { h: 'Sales channel', w: 10, group: g, core: true, get: L('salesChannel') },
    { h: 'Salesperson', w: 16, group: g, core: true, get: L('salesPerson') },
  ];
  const status = (g: string): Col[] => [
    { h: 'Order status', w: 16, group: g, core: true, get: L('orderStatus') },
    { h: 'Job status', w: 14, group: g, core: true, get: L('jobSheetStatus') },
    { h: 'Billing code', w: 26, group: g, core: true, get: L('billingCode') },
    { h: 'Cost status', w: 16, group: g, core: true, get: L('costStatus') },
  ];

  const repairCols: Col[] = [
    ...common('Job'),
    ...status('Job'),
    { h: 'Appliance (from remarks)', w: 24, group: 'Job', core: true, get: applianceFromRemarks },
    { h: 'Model (from remarks)', w: 16, group: 'Job', core: true, get: modelFromRemarks },
    { h: 'Qty', w: 7, group: 'Revenue', core: true, sum: true, get: L('qty') },
    { h: 'Unit price', w: 11, fmt: MONEY, group: 'Revenue', core: true, get: L('unitPrice') },
    {
      h: 'Original job value',
      w: 13,
      fmt: MONEY,
      group: 'Revenue',
      core: true,
      get: L('originalJobValue'),
    },
    { h: 'Rule applied', w: 34, group: 'Revenue', core: true, get: ruleApplied },
    {
      h: 'CSIJO basis',
      w: 15,
      group: 'Revenue',
      core: true,
      get: (x: Row) => (x.line.csijoBasis as string | null) ?? '',
    },
    {
      h: 'Revenue (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Revenue',
      core: true,
      sum: true,
      get: L('revenue'),
    },
    ...(data.customRates || data.fridgeLogic
      ? [
          {
            h: 'Workbook revenue (AED)',
            w: 16,
            fmt: MONEY,
            group: 'Revenue',
            core: true,
            sum: true,
            get: L('workbookRevenue'),
          },
        ]
      : []),
    { h: 'Remarks', w: 60, group: 'Remarks', core: true, get: L('remarks') },
  ];

  const installCols: Col[] = [
    ...common('Job'),
    { h: 'City / region', w: 14, group: 'Job', get: P((p) => p.city) },
    ...status('Job'),
    { h: 'Qty', w: 7, group: 'Job', core: true, sum: true, get: L('qty') },
    { h: 'Parent category', w: 22, group: 'ERP', get: P((p) => p.erpCategory) },
    { h: 'Brand', w: 16, group: 'ERP', get: P((p) => p.erpBrand) },
    { h: 'Model(s)', w: 26, group: 'ERP', get: P((p) => p.erpModels) },
    {
      h: 'Revenue before (AED)',
      w: 13,
      fmt: MONEY,
      group: 'Before',
      sum: true,
      get: P((p) => p.before.revenue),
    },
    ...(data.fridgeLogic
      ? [
          {
            h: 'Fridge litres',
            w: 10,
            group: 'After',
            get: (x: Row) => data.fridgeLogic?.byLine.get(String(x.line.id ?? ''))?.litres ?? '',
          },
          {
            h: 'Litres source',
            w: 14,
            group: 'After',
            get: (x: Row) => data.fridgeLogic?.byLine.get(String(x.line.id ?? ''))?.source ?? '',
          },
          {
            h: 'Default litres',
            w: 10,
            group: 'After',
            get: (x: Row) =>
              data.fridgeLogic?.byLine.get(String(x.line.id ?? ''))?.defaultLitres ? 'Yes' : '',
          },
          {
            h: 'Fridge rule applied',
            w: 44,
            group: 'After',
            get: (x: Row) => data.fridgeLogic?.byLine.get(String(x.line.id ?? ''))?.rule ?? '',
          },
          {
            h: '13A/15A plug (AED)',
            w: 14,
            fmt: MONEY,
            group: 'After',
            sum: true,
            get: (x: Row) =>
              data.fridgeLogic?.plugByLine.get(String(x.line.id ?? ''))?.amount ?? '',
          },
        ]
      : []),
    { h: 'Appliance category', w: 24, group: 'After', get: P((p) => p.applianceCategory) },
    { h: 'Pricing type', w: 11, group: 'After', get: P((p) => p.pricingType) },
    { h: 'Billing qty', w: 9, group: 'After', get: P((p) => p.billingQty) },
    { h: 'Base rate', w: 10, fmt: MONEY, group: 'After', get: P((p) => p.baseUnitRate) },
    { h: 'Discount', w: 9, fmt: '0%', group: 'After', get: P((p) => p.discountRate) },
    { h: 'Net rate', w: 10, fmt: MONEY, group: 'After', get: P((p) => p.netUnitRate) },
    {
      h: 'Labour (AED)',
      w: 12,
      fmt: MONEY,
      group: 'After',
      sum: true,
      get: E('labourAfterDiscount'),
    },
    {
      h: 'Transport (AED)',
      w: 12,
      fmt: MONEY,
      group: 'After',
      sum: true,
      get: E('transport'),
    },
    {
      h: 'Revenue (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Final',
      core: true,
      sum: true,
      get: L('revenue'),
    },
    ...(data.customRates || data.fridgeLogic
      ? [
          {
            h: 'Workbook revenue (AED)',
            w: 16,
            fmt: MONEY,
            group: 'Final',
            core: true,
            sum: true,
            get: L('workbookRevenue'),
          },
        ]
      : []),
    {
      h: 'Change vs before (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Final',
      sum: true,
      get: E('changeVsBeforeFix'),
    },
    { h: 'Revenue per unit (AED)', w: 13, fmt: MONEY, group: 'Final', get: E('revenuePerUnit') },
    {
      h: 'Workbook minus rules (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Check',
      sum: true,
      get: E('reconcileDiff'),
    },
    { h: 'Why they differ', w: 22, group: 'Check', get: E('diffCause') },
    {
      h: 'Trip no. of day',
      w: 9,
      group: 'Check',
      get: (x: Row) => tripByRow.get(x)?.rank,
    },
    {
      h: 'Transport note',
      w: 52,
      group: 'Check',
      get: (x: Row) => tripByRow.get(x)?.note,
    },
    {
      h: 'Transport not charged (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Check',
      sum: true,
      get: (x: Row) => unchargedByRow.get(x),
    },
    { h: 'Review note', w: 44, group: 'Explain', get: P((p) => p.reviewNote) },
    { h: 'Remarks', w: 60, group: 'Explain', core: true, get: L('remarks') },
  ];

  // Technical columns accounts rarely need: kept on the Source detail sheet, one lookup away by
  // invoice number, so the Delivery & Install sheet stays readable.
  const movedCols: Col[] = [
    { h: 'Parent subcategory', w: 22, group: 'ERP', get: P((p) => p.erpSubcategory) },
    { h: 'Parent item(s)', w: 26, group: 'ERP', get: P((p) => p.erpParentItems) },
    { h: 'Billing item code(s)', w: 26, group: 'ERP', get: P((p) => p.erpBillingCodes) },
    { h: 'Raw ERP lines', w: 9, group: 'ERP', get: P((p) => p.erpLineCount) },
    { h: 'Appliance category', w: 24, group: 'Before', get: P((p) => p.before.applianceCategory) },
    { h: 'Pricing type', w: 11, group: 'Before', get: P((p) => p.before.pricingType) },
    { h: 'Discount', w: 9, fmt: '0%', group: 'Before', get: P((p) => p.before.discountRate) },
    { h: 'Base rate', w: 10, fmt: MONEY, group: 'Before', get: P((p) => p.before.baseUnitRate) },
    { h: 'Net rate', w: 10, fmt: MONEY, group: 'Before', get: P((p) => p.before.netUnitRate) },
    { h: 'Transport', w: 10, fmt: MONEY, group: 'Before', get: P((p) => p.before.transport) },
    { h: 'Billing qty', w: 9, group: 'Before', get: P((p) => p.before.billingQty) },
    {
      h: 'Rebuilt from rules (AED)',
      w: 14,
      fmt: MONEY,
      group: 'Check',
      sum: true,
      get: E('rebuilt'),
    },
    { h: 'Revenue basis', w: 44, group: 'Explain', get: E('basis') },
    { h: 'Invoice CSIDI qty', w: 10, group: 'Explain', get: P((p) => p.invoiceCsidiQty) },
    {
      h: 'Invoice has CSIDO',
      w: 10,
      group: 'Explain',
      get: P((p) => yesNo(p.invoiceHasCsido)),
    },
    {
      h: 'Invoice has CSIDI',
      w: 10,
      group: 'Explain',
      get: P((p) => yesNo(p.invoiceHasCsidi)),
    },
    {
      h: 'First line of its type on invoice',
      w: 13,
      group: 'Explain',
      get: P((p) => yesNo(p.firstOfType)),
    },
    {
      h: 'Data source',
      w: 16,
      group: 'Explain',
      get: P((p) =>
        /live/i.test(`${p.sourceName ?? ''} ${p.pricingStatus ?? ''}`)
          ? 'Live feed'
          : 'Locked history',
      ),
    },
    { h: 'Pricing status', w: 30, group: 'Explain', get: P((p) => p.pricingStatus) },
    { h: 'Remarks flags', w: 44, group: 'Explain', get: E('remarkFlags') },
  ];

  // Raw columns of the workbook's CSIDI sheet that accounts rarely need, kept
  // one lookup away (by invoice number) instead of on the review sheets.
  const detailCols: Col[] = [
    { h: 'Inv/Del no', w: 14, group: 'Source', core: true, get: L('invDelNo') },
    { h: 'Job type', w: 10, group: 'Source', core: true, get: L('jobType') },
    { h: 'Tranc', w: 10, group: 'Source', get: P((p) => p.tranc) },
    { h: 'Cust code', w: 11, group: 'Source', get: P((p) => p.custCode) },
    { h: 'TRN no', w: 18, group: 'Source', get: P((p) => p.trnNo) },
    { h: 'Cur', w: 6, group: 'Source', get: P((p) => p.currency) },
    { h: 'Location', w: 10, group: 'Source', get: P((p) => p.location) },
    { h: 'Del loc', w: 9, group: 'Source', get: P((p) => p.delLoc) },
    { h: 'Qty (paired units)', w: 11, group: 'Source', get: P((p) => p.rawQty) },
    { h: 'Value (ERP invoice)', w: 14, fmt: MONEY, group: 'Source', get: P((p) => p.value) },
    { h: 'No. of items', w: 10, group: 'Source', get: P((p) => p.items) },
    { h: 'Invoice status', w: 22, group: 'Source', get: P((p) => p.invoiceStatus) },
    { h: 'Salesman', w: 18, group: 'Source', get: P((p) => p.salesman) },
    { h: 'Ref doc no', w: 18, group: 'Source', get: P((p) => p.refDocNo) },
    { h: 'Ref doc date', w: 12, group: 'Source', get: P((p) => p.refDocDt) },
    { h: 'Del. date', w: 12, group: 'Source', get: P((p) => p.delDate) },
    { h: 'LPO no / status', w: 16, group: 'Source', get: P((p) => p.lpoNo) },
    { h: 'Derived type', w: 11, group: 'Source', get: P((p) => p.derivedType) },
    { h: 'Calc qty (derived trips)', w: 13, group: 'Source', get: P((p) => p.calcQty) },
    { h: 'Original type', w: 11, group: 'Source', get: P((p) => p.originalType) },
    { h: 'Category source', w: 24, group: 'Source', get: P((p) => p.categorySource) },
    { h: 'Customer grouping', w: 24, group: 'Source', get: P((p) => p.customerGrouping) },
    { h: 'Number of sites', w: 10, group: 'Source', get: P((p) => p.sites) },
    { h: 'Planned trips', w: 10, group: 'Source', get: P((p) => p.plannedTrips) },
    { h: 'Crew size', w: 8, group: 'Source', get: P((p) => p.crewSize) },
    { h: 'Discount tier', w: 13, group: 'Source', get: P((p) => p.discountTier) },
    {
      h: 'Proposed revenue (CSIDI sheet)',
      w: 14,
      fmt: MONEY,
      group: 'Source',
      get: P((p) => p.proposedRevenue),
    },
    { h: 'ERP channel', w: 10, group: 'Source', get: P((p) => p.erpChannel) },
    { h: 'ERP job type(s)', w: 16, group: 'Source', get: P((p) => p.erpJobTypes) },
    { h: 'ERP job status(es)', w: 18, group: 'Source', get: P((p) => p.erpJobStatuses) },
    {
      h: 'ERP job invoice / reference(s)',
      w: 22,
      group: 'Source',
      get: P((p) => p.erpJobReferences),
    },
    ...movedCols,
  ];

  const GROUP_FILL: Record<string, string> = {
    Job: NAVY,
    Source: NAVY,
    ERP: 'FF0F6B6B',
    Before: 'FF6B7280',
    After: 'FF1D5FA8',
    Final: 'FF15803D',
    Check: 'FF7A1F3D',
    Explain: 'FF8A4B00',
    Revenue: 'FF15803D',
    Remarks: 'FF6B7280',
  };
  const GROUP_LABEL: Record<string, string> = {
    Job: 'JOB',
    ERP: 'ERP ITEM DETAILS',
    Before: 'BEFORE (earlier workbook figures)',
    After: 'AFTER (current rules)',
    Final: 'FINAL REVENUE',
    Check: 'CHECK AGAINST THE RULES',
    Explain: 'WHY / EXPLANATION',
    Revenue: 'REVENUE',
    Remarks: 'REMARKS',
    Source: 'WORKBOOK COLUMNS',
  };

  // Writes one review sheet: coloured group band, header row, one row per job,
  // and a SUBTOTAL row that follows the filter. A column that is empty for
  // every exported job is dropped unless it is a core column.
  const writeJobSheet = (name: string, rows: Row[], all: Col[], tabColor: string) => {
    const cols = all.filter((c) => c.core || rows.some((x) => !isEmpty(c.get(x))));
    const sheet = wb.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } });
    // Band row: one merged cell per run of columns in the same group.
    let start = 0;
    for (let i = 1; i <= cols.length; i += 1) {
      if (i < cols.length && cols[i]!.group === cols[start]!.group) continue;
      const g = cols[start]!.group;
      if (i - start > 1) sheet.mergeCells(1, start + 1, 1, i);
      const cell = sheet.getCell(1, start + 1);
      cell.value = GROUP_LABEL[g] ?? g;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = start + 1; c <= i; c += 1)
        sheet.getCell(1, c).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: GROUP_FILL[g] ?? NAVY },
        };
      start = i;
    }
    sheet.getRow(1).height = 20;
    sheet.addRow(cols.map((c) => c.h));
    cols.forEach((c, i) => {
      sheet.getColumn(i + 1).width = c.w;
      if (c.fmt) sheet.getColumn(i + 1).numFmt = c.fmt;
      const cell = sheet.getCell(2, i + 1);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: GROUP_FILL[c.group] ?? NAVY },
      };
    });
    sheet.getRow(2).height = 42;
    const numericHeaders = (c: Col) => c.sum || c.fmt === MONEY || c.fmt === '0%';
    for (const x of rows) {
      sheet.addRow(
        cols.map((c) => {
          const v = c.get(x);
          if (numericHeaders(c))
            return v === null || v === undefined || v === '' ? null : Number(v);
          if (v === null || v === undefined) return '';
          // Remarks keep their text on one line so rows stay readable.
          return typeof v === 'string' && c.h === 'Remarks' ? v.replace(/\s+/g, ' ').trim() : v;
        }),
      );
    }
    if (rows.length) {
      const first = 3;
      const last = 2 + rows.length;
      const total = sheet.addRow(
        cols.map((c, i) => {
          if (i === 0) return 'Total (follows the filter)';
          if (!c.sum) return '';
          const letter = sheet.getColumn(i + 1).letter;
          const result = rows.reduce((sum, x) => sum + Number(c.get(x) ?? 0), 0);
          return { formula: `SUBTOTAL(109,${letter}${first}:${letter}${last})`, result };
        }),
      );
      total.font = { bold: true, name: 'Arial', size: 10 };
      total.eachCell((cell) => {
        cell.border = { top: { style: 'medium' } };
      });
    }
    sheet.views = [{ state: 'frozen', ySplit: 2, xSplit: 5 }];
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return sheet;
  };

  const installTypes = new Set(['CSIDI', 'CSIDO', 'CSIII']);
  const installRows = enriched.filter((x) => installTypes.has(String(x.line.jobType)));
  const repairRows = enriched.filter((x) => !installTypes.has(String(x.line.jobType)));
  if (repairRows.length || !installRows.length)
    writeJobSheet('Jobs', repairRows, repairCols, 'FFF5B84B');
  if (installRows.length) {
    writeJobSheet('Delivery & Install', installRows, installCols, 'FF33D6C0');
    writeJobSheet('Source detail', installRows, detailCols, 'FF9CA3AF');
  }

  const filterLabel = filterText;
  const logicLines: LogicLine[] = enriched.map((x) => ({
    jobType: String(x.line.jobType),
    qty: Number(x.line.qty ?? 0),
    revenue: Number(x.line.revenue ?? 0),
    pricing: x.pricing,
    e: x.e,
  }));
  buildLogicSheet(
    wb,
    rules,
    logicLines,
    data.batch.fileName,
    filterLabel,
    data.transportRules && {
      banner: data.transportRules.label,
      detail:
        transportRulesDetail(data.transportRules) +
        (data.customRates
          ? ` CUSTOM RATES IN FORCE: workbook revenue AED ${data.customRates.workbookRates} -> AED ${data.customRates.customRates} (whole upload). The rates on this sheet are the custom rates.`
          : '') +
        (data.fridgeLogic
          ? ` NEW FRIDGE LOGIC IN FORCE: fridges and 13A/15A plug lines are priced as described on the Summary sheet, so fridge lines on this sheet differ from the old-logic rebuild by design (see the "Why they differ" column).`
          : ''),
    },
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
