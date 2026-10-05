import ExcelJS from 'exceljs';
import type { ImportBatch } from '../../../../packages/db/src/revenue-dashboard.js';
import { buildLogicSheet, type LogicLine } from './logic-sheet.js';
import {
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
};

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
      'Revenue is the figure calculated in the master Service Dashboard workbook (Revenue Source sheet).',
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
  const rules: PricingRules = storedRules?.deliveryInstall ? storedRules : DEFAULT_PRICING_RULES;
  const enriched = data.lines.map((line) => {
    const pricing = (line.pricing as SheetPricing | null | undefined) ?? null;
    const e = enrichLine(rules, {
      jobType: String(line.jobType),
      qty: Number(line.qty ?? 0),
      unitPrice: Number(line.unitPrice ?? 0),
      revenue: Number(line.revenue ?? 0),
      remarks: (line.remarks as string | null) ?? null,
      billingCode: (line.billingCode as string | null) ?? null,
      pricing,
    });
    return { line, pricing, e };
  });

  type Col = {
    h: string;
    w: number;
    fmt?: string;
    group: 'base' | 'sheet' | 'calc' | 'risk';
    get: (x: (typeof enriched)[number]) => unknown;
  };
  const P = (pick: (p: SheetPricing) => unknown) => (x: (typeof enriched)[number]) =>
    x.pricing ? pick(x.pricing) : null;
  const L = (key: string) => (x: (typeof enriched)[number]) => x.line[key];
  const E = (key: keyof (typeof enriched)[number]['e']) => (x: (typeof enriched)[number]) =>
    x.e[key];
  const cols: Col[] = [
    { h: 'Date', w: 12, group: 'base', get: L('orderDate') },
    { h: 'Year', w: 7, group: 'base', get: L('year') },
    { h: 'Month', w: 7, group: 'base', get: L('month') },
    { h: 'Week', w: 7, group: 'base', get: L('weekNo') },
    { h: 'Job type', w: 10, group: 'base', get: L('jobType') },
    { h: 'Inv/Del no', w: 14, group: 'base', get: L('invDelNo') },
    { h: 'CSOSC order', w: 14, group: 'base', get: L('csoscOrderNo') },
    { h: 'Customer', w: 40, group: 'base', get: L('customer') },
    { h: 'Sales channel', w: 12, group: 'base', get: L('salesChannel') },
    { h: 'Salesperson', w: 18, group: 'base', get: L('salesPerson') },
    { h: 'Order status', w: 18, group: 'base', get: L('orderStatus') },
    { h: 'Job status', w: 14, group: 'base', get: L('jobSheetStatus') },
    { h: 'Billing code', w: 28, group: 'base', get: L('billingCode') },
    { h: 'Cost status', w: 18, group: 'base', get: L('costStatus') },
    { h: 'Qty', w: 8, group: 'base', get: L('qty') },
    { h: 'Unit price', w: 12, fmt: MONEY, group: 'base', get: L('unitPrice') },
    { h: 'Original job value', w: 14, fmt: MONEY, group: 'base', get: L('originalJobValue') },
    { h: 'Revenue (AED)', w: 14, fmt: MONEY, group: 'base', get: L('revenue') },
    { h: 'Remarks', w: 60, group: 'base', get: L('remarks') },
    // ---- every column of the workbook's CSIDI sheet --------------------
    { h: 'CSIDI: Tranc', w: 10, group: 'sheet', get: P((p) => p.tranc) },
    { h: 'CSIDI: Cust code', w: 11, group: 'sheet', get: P((p) => p.custCode) },
    { h: 'CSIDI: TRN no', w: 18, group: 'sheet', get: P((p) => p.trnNo) },
    { h: 'CSIDI: Cur', w: 6, group: 'sheet', get: P((p) => p.currency) },
    { h: 'CSIDI: Location', w: 10, group: 'sheet', get: P((p) => p.location) },
    { h: 'CSIDI: Del loc', w: 9, group: 'sheet', get: P((p) => p.delLoc) },
    { h: 'CSIDI: Qty (raw units)', w: 11, group: 'sheet', get: P((p) => p.rawQty) },
    { h: 'CSIDI: Value (ERP invoice)', w: 14, fmt: MONEY, group: 'sheet', get: P((p) => p.value) },
    { h: 'CSIDI: No. of items', w: 10, group: 'sheet', get: P((p) => p.items) },
    { h: 'CSIDI: Invoice status', w: 22, group: 'sheet', get: P((p) => p.invoiceStatus) },
    { h: 'CSIDI: Salesman', w: 18, group: 'sheet', get: P((p) => p.salesman) },
    { h: 'CSIDI: Ref doc no', w: 18, group: 'sheet', get: P((p) => p.refDocNo) },
    { h: 'CSIDI: Ref doc date', w: 12, group: 'sheet', get: P((p) => p.refDocDt) },
    { h: 'CSIDI: Del. date', w: 12, group: 'sheet', get: P((p) => p.delDate) },
    { h: 'CSIDI: LPO no / status', w: 16, group: 'sheet', get: P((p) => p.lpoNo) },
    { h: 'CSIDI: Derived type', w: 11, group: 'sheet', get: P((p) => p.derivedType) },
    { h: 'CSIDI: Calc qty (derived trips)', w: 13, group: 'sheet', get: P((p) => p.calcQty) },
    { h: 'CSIDI: Original type', w: 11, group: 'sheet', get: P((p) => p.originalType) },
    { h: 'CSIDI: Appliance category', w: 26, group: 'sheet', get: P((p) => p.applianceCategory) },
    { h: 'CSIDI: Category source', w: 24, group: 'sheet', get: P((p) => p.categorySource) },
    { h: 'CSIDI: Pricing type', w: 11, group: 'sheet', get: P((p) => p.pricingType) },
    { h: 'CSIDI: Customer grouping', w: 24, group: 'sheet', get: P((p) => p.customerGrouping) },
    { h: 'CSIDI: Number of sites', w: 10, group: 'sheet', get: P((p) => p.sites) },
    { h: 'CSIDI: Planned trips', w: 10, group: 'sheet', get: P((p) => p.plannedTrips) },
    { h: 'CSIDI: Crew size', w: 8, group: 'sheet', get: P((p) => p.crewSize) },
    { h: 'CSIDI: Discount tier', w: 13, group: 'sheet', get: P((p) => p.discountTier) },
    { h: 'CSIDI: Discount rate', w: 10, fmt: '0%', group: 'sheet', get: P((p) => p.discountRate) },
    {
      h: 'CSIDI: Base unit rate',
      w: 11,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.baseUnitRate),
    },
    { h: 'CSIDI: Net unit rate', w: 11, fmt: MONEY, group: 'sheet', get: P((p) => p.netUnitRate) },
    {
      h: 'CSIDI: Transport charge',
      w: 11,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.transportCharge),
    },
    { h: 'CSIDI: Proposed billing qty', w: 12, group: 'sheet', get: P((p) => p.billingQty) },
    {
      h: 'CSIDI: Proposed revenue',
      w: 13,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.proposedRevenue),
    },
    { h: 'CSIDI: Pricing status', w: 32, group: 'sheet', get: P((p) => p.pricingStatus) },
    { h: 'CSIDI: Review note', w: 50, group: 'sheet', get: P((p) => p.reviewNote) },
    {
      h: 'Before fix: Appliance category',
      w: 24,
      group: 'sheet',
      get: P((p) => p.before.applianceCategory),
    },
    { h: 'Before fix: Pricing type', w: 11, group: 'sheet', get: P((p) => p.before.pricingType) },
    {
      h: 'Before fix: Discount rate',
      w: 10,
      fmt: '0%',
      group: 'sheet',
      get: P((p) => p.before.discountRate),
    },
    {
      h: 'Before fix: Base unit rate',
      w: 11,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.before.baseUnitRate),
    },
    {
      h: 'Before fix: Net unit rate',
      w: 11,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.before.netUnitRate),
    },
    {
      h: 'Before fix: Transport',
      w: 10,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.before.transport),
    },
    { h: 'Before fix: Billing qty', w: 10, group: 'sheet', get: P((p) => p.before.billingQty) },
    {
      h: 'Before fix: Revenue',
      w: 12,
      fmt: MONEY,
      group: 'sheet',
      get: P((p) => p.before.revenue),
    },
    // ---- how the revenue is built, part by part ------------------------
    { h: 'Revenue basis', w: 44, group: 'calc', get: E('basis') },
    { h: 'Labour before discount (AED)', w: 15, fmt: MONEY, group: 'calc', get: E('grossLabour') },
    { h: 'Volume discount (AED)', w: 13, fmt: MONEY, group: 'calc', get: E('discountAmount') },
    { h: 'AED 35 floor applied', w: 10, group: 'calc', get: E('floorApplied') },
    {
      h: 'Labour after discount (AED)',
      w: 15,
      fmt: MONEY,
      group: 'calc',
      get: E('labourAfterDiscount'),
    },
    { h: 'Transport (AED)', w: 12, fmt: MONEY, group: 'calc', get: E('transport') },
    { h: 'Rebuilt revenue (AED)', w: 14, fmt: MONEY, group: 'calc', get: E('rebuilt') },
    {
      h: 'Workbook minus rebuilt (AED)',
      w: 14,
      fmt: MONEY,
      group: 'calc',
      get: E('reconcileDiff'),
    },
    { h: 'Revenue per unit (AED)', w: 13, fmt: MONEY, group: 'calc', get: E('revenuePerUnit') },
    {
      h: 'Change vs before 3 Oct fix (AED)',
      w: 15,
      fmt: MONEY,
      group: 'calc',
      get: E('changeVsBeforeFix'),
    },
    // ---- what the missing ERP data could change ------------------------
    {
      h: 'If all units refrigerator/washer (AED)',
      w: 17,
      fmt: MONEY,
      group: 'risk',
      get: E('ifRefrigerator'),
    },
    { h: 'If all units cooker (AED)', w: 14, fmt: MONEY, group: 'risk', get: E('ifCooker') },
    { h: 'If trips were Sharjah (AED)', w: 14, fmt: MONEY, group: 'risk', get: E('ifSharjah') },
    {
      h: 'If not same customer/site (AED)',
      w: 16,
      fmt: MONEY,
      group: 'risk',
      get: E('ifNotSameSite'),
    },
    { h: 'If 3-person crew (AED)', w: 14, fmt: MONEY, group: 'risk', get: E('ifThreePersonCrew') },
    {
      h: 'If CSIDO billed per unit (AED)',
      w: 15,
      fmt: MONEY,
      group: 'risk',
      get: E('rawUnitsAt80'),
    },
    { h: 'Assumptions behind this figure', w: 70, group: 'risk', get: E('assumptions') },
    { h: 'Remarks flags', w: 55, group: 'risk', get: E('remarkFlags') },
    { h: 'Models seen in remarks', w: 24, group: 'risk', get: (x) => x.e.reading.models },
    {
      h: 'Activity wording in remarks',
      w: 22,
      group: 'risk',
      get: (x) => x.e.reading.activityEvidence,
    },
  ];
  const GROUP_FILL: Record<Col['group'], string> = {
    base: NAVY,
    sheet: 'FF0F6B6B',
    calc: 'FF8A4B00',
    risk: 'FF7A1F3D',
  };

  const jobs = wb.addWorksheet('Jobs');
  jobs.addRow(cols.map((c) => c.h));
  header(jobs, 1);
  cols.forEach((c, i) => {
    jobs.getColumn(i + 1).width = c.w;
    if (c.fmt) jobs.getColumn(i + 1).numFmt = c.fmt;
    jobs.getCell(1, i + 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: GROUP_FILL[c.group] },
    };
  });
  jobs.getRow(1).height = 42;
  const numeric = new Set(['Qty', 'Unit price', 'Original job value', 'Revenue (AED)']);
  for (const x of enriched) {
    jobs.addRow(
      cols.map((c) => {
        const v = c.get(x);
        if (numeric.has(c.h)) return Number(v ?? 0);
        if (v === null || v === undefined) return '';
        // Guard against spreadsheet formula injection from free text.
        return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
      }),
    );
  }
  jobs.views = [{ state: 'frozen', ySplit: 1, xSplit: 8 }];
  jobs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const filterLabel = filterText;
  const logicLines: LogicLine[] = enriched.map((x) => ({
    jobType: String(x.line.jobType),
    qty: Number(x.line.qty ?? 0),
    revenue: Number(x.line.revenue ?? 0),
    pricing: x.pricing,
    e: x.e,
  }));
  buildLogicSheet(wb, rules, logicLines, data.batch.fileName, filterLabel);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
