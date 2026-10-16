import ExcelJS from 'exceljs';
import type { ImportBatch, RevenueFilters } from '../../../../packages/db/src/revenue-dashboard.js';

// "Download this view" workbook (Reports > Drill-down > Where you are).
//
// Unlike the full report export, this holds only what the person is looking at:
// the filters / drill steps they applied, the breakdown they chose, and the jobs
// behind it - laid out for finance review (cover sheet, breakdown, job list with
// filters, subtotals that follow the filter, print-ready).

type Totals = { revenue: number; jobs: number; qty: number };
type Group = {
  totals: Totals;
  rows: { key: string; revenue: number; jobs: number; qty: number }[];
};

export type RevenueViewData = {
  batch: ImportBatch;
  filters: RevenueFilters;
  groupBy: string;
  viewPath: string;
  totals: Totals;
  grandTotals: Totals;
  breakdown: Group | null;
  jobTypeMix: Group;
  exception: { key: string; label: string; description: string } | null;
  lines: Record<string, unknown>[];
  truncated: boolean;
};

const NAVY = 'FF10233F';
const ACCENT = 'FF1F6FEB';
const BAND = 'FFF3F6FB';
const LINE = 'FFD0D7E2';
const MONEY = '#,##0.00;[Red]-#,##0.00';
const INT = '#,##0';
const FONT = 'Arial';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DIMENSION_NAMES: Record<string, string> = {
  year: 'Year',
  period: 'Month',
  month: 'Month of year',
  week: 'Week',
  yearWeek: 'Week',
  jobType: 'Job type',
  channel: 'Sales channel',
  salesPerson: 'Salesperson',
  customer: 'Customer',
  costStatus: 'Cost status',
  billingCode: 'Billing code',
  jobStatus: 'Job status',
  orderStatus: 'Order status',
  search: 'Search text',
  exception: 'Exception',
};

// Text typed by a person (search box, breadcrumb). xlsx stores strings as text, never
// as formulas, so nothing typed can run; this only normalises the value.
export function safeText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function dubaiStamp(date = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' (Dubai time)'
  );
}

function jobTypeNames(batch: ImportBatch): Map<string, string> {
  const rates = (batch.summary as { rates?: { jobType: string; description?: string }[] }).rates;
  return new Map((rates ?? []).map((r) => [r.jobType, r.description ?? '']));
}

export function dimensionLabel(dimension: string, key: string, names: Map<string, string>): string {
  if (dimension === 'period') {
    const [y, m] = key.split('-');
    return (MONTHS[Number(m) - 1] ?? key) + ' ' + (y ?? '');
  }
  if (dimension === 'month') return MONTHS_FULL[Number(key) - 1] ?? key;
  if (dimension === 'week') return 'Week ' + key;
  if (dimension === 'yearWeek') return key.replace('-W', ' W');
  if (dimension === 'jobType') return names.get(key) ? key + ' - ' + names.get(key) : key;
  return key;
}

// Which filters the person applied, in words.
export function describeFilters(
  filters: RevenueFilters,
  names: Map<string, string>,
  exception: RevenueViewData['exception'],
): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || key === 'exception') continue;
    const label = DIMENSION_NAMES[key] ?? key;
    const text = key === 'search' ? safeText(value) : dimensionLabel(key, String(value), names);
    out.push([label, text]);
  }
  if (exception) out.push(['Exception', exception.label]);
  return out;
}

// Why a job shows up under an exception, so finance can act on each line.
export function whyFlagged(key: string, line: Record<string, unknown>): string {
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? 'blank' : String(v));
  switch (key) {
    case 'unmatchedOrder': {
      const order = String(line.csoscOrderNo ?? '');
      return /^\d+$/.test(order)
        ? 'CSOSC order ' + order + " is not in the workbook's CSOSC export (likely an older order)"
        : 'No CSOSC order on this job (' + text(line.csoscOrderNo) + ')';
    }
    case 'costReview':
      return 'Cost status is ' + text(line.costStatus);
    case 'zeroRevenue':
      return 'Revenue is 0 (cost status ' + text(line.costStatus) + ')';
    case 'billingReview':
      return 'Billing code could not be derived from the remarks';
    case 'channelReview':
      return 'Sales channel could not be derived from the remarks (HAA / INS not stated)';
    case 'noCustomer':
      return 'No customer name on the row';
    default:
      return '';
  }
}

// Remarks often hold several lines; one line per job keeps the list compact (the full
// text is still in the cell).
function oneLine(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' / ').trim() : value;
}

function styleHeader(row: ExcelJS.Row, height = 30) {
  row.height = height;
  row.eachCell((cell) => {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  });
}

function band(sheet: ExcelJS.Worksheet, banner: string, subtitle: string, columns: number) {
  sheet.mergeCells(1, 1, 1, columns);
  const t = sheet.getCell(1, 1);
  t.value = banner;
  t.font = { name: FONT, size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, columns);
  const s = sheet.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF44546A' } };
  s.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  sheet.getRow(2).height = 32;
}

function printSetup(sheet: ExcelJS.Worksheet, titleRows: string, landscape = true) {
  sheet.pageSetup = {
    paperSize: 9,
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: titleRows,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  sheet.headerFooter.oddFooter =
    "&L&8Jacky's Distribution - Service Portal&C&8Page &P of &N&R&8Printed &D";
}

function box(cell: ExcelJS.Cell) {
  const edge = { style: 'thin' as const, color: { argb: LINE } };
  cell.border = { top: edge, left: edge, bottom: edge, right: edge };
}

function addSummary(wb: ExcelJS.Workbook, data: RevenueViewData, names: Map<string, string>) {
  const sheet = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 34 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
  band(
    sheet,
    'Service Revenue - Selected View',
    data.viewPath ? safeText(data.viewPath) : 'All data',
    5,
  );

  let r = 4;
  const label = (row: number, text: string) => {
    const c = sheet.getCell(row, 1);
    c.value = text;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF44546A' } };
    c.alignment = { vertical: 'top', wrapText: true };
  };
  const value = (row: number, v: ExcelJS.CellValue, fmt?: string) => {
    sheet.mergeCells(row, 2, row, 5);
    const c = sheet.getCell(row, 2);
    c.value = v;
    c.font = { name: FONT, size: 10 };
    c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    if (fmt) c.numFmt = fmt;
  };

  // Key figures
  const kpis: [string, number, string][] = [
    ['Revenue (AED)', data.totals.revenue, MONEY],
    ['Jobs', data.totals.jobs, INT],
    ['Quantity', data.totals.qty, INT],
    ['Average per job (AED)', data.totals.jobs ? data.totals.revenue / data.totals.jobs : 0, MONEY],
  ];
  kpis.forEach(([name, v, fmt], i) => {
    const col = i + 1;
    const head = sheet.getCell(r, col);
    head.value = name;
    head.font = { name: FONT, size: 9, bold: true, color: { argb: 'FF44546A' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    head.alignment = { horizontal: 'center', vertical: 'middle' };
    box(head);
    const body = sheet.getCell(r + 1, col);
    body.value = v;
    body.numFmt = fmt;
    body.font = { name: FONT, size: 16, bold: true, color: { argb: NAVY } };
    body.alignment = { horizontal: 'center', vertical: 'middle' };
    box(body);
  });
  sheet.getRow(r + 1).height = 34;
  r += 3;

  label(r, 'Share of all uploaded revenue');
  value(r, data.grandTotals.revenue ? data.totals.revenue / data.grandTotals.revenue : 0, '0.0%');
  r += 1;

  // Where this view came from
  r += 1;
  const sectionTitle = (row: number, text: string) => {
    sheet.mergeCells(row, 1, row, 5);
    const c = sheet.getCell(row, 1);
    c.value = text;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    c.alignment = { indent: 1, vertical: 'middle' };
    sheet.getRow(row).height = 20;
  };
  sectionTitle(r, 'What this view contains');
  r += 1;
  const filters = describeFilters(data.filters, names, data.exception);
  label(r, 'Filters applied');
  value(r, filters.length ? filters.map(([k, v]) => `${k}: ${v}`).join('\n') : 'None (all data)');
  sheet.getRow(r).height = Math.max(16, 15 * Math.max(filters.length, 1));
  r += 1;
  if (data.exception) {
    label(r, 'What the exception means');
    value(r, data.exception.description);
    sheet.getRow(r).height = Math.max(30, 15 * Math.ceil(data.exception.description.length / 95));
    r += 1;
  }
  label(r, 'Breakdown shown');
  value(
    r,
    data.groupBy === 'jobs'
      ? 'Individual jobs'
      : (DIMENSION_NAMES[data.groupBy] ?? data.groupBy) + ' (see the Breakdown sheet)',
  );
  r += 1;
  label(r, 'Source workbook');
  value(r, data.batch.fileName + ' (uploaded ' + dubaiStamp(data.batch.uploadedAt) + ')');
  r += 1;
  label(r, 'Prepared');
  value(r, dubaiStamp());
  r += 1;
  label(r, 'Basis');
  value(
    r,
    'Revenue is the figure calculated in the master Service Dashboard workbook (Revenue Source sheet). ' +
      'This is a management analysis of the uploaded workbook, not an ERP or ledger extract - reconcile to ERP postings before posting.',
  );
  sheet.getRow(r).height = 44;
  r += 1;
  if (data.truncated) {
    label(r, 'Note');
    value(r, 'The job list was limited to the first 50,000 jobs; narrow the filters for the rest.');
    r += 1;
  }

  // Mix by job type
  r += 1;
  sectionTitle(r, 'Mix by job type');
  r += 1;
  const head = sheet.getRow(r);
  ['Job type', 'Jobs', 'Quantity', 'Revenue (AED)', 'Share of view'].forEach((h, i) => {
    head.getCell(i + 1).value = h;
  });
  styleHeader(head, 22);
  const first = r + 1;
  for (const m of data.jobTypeMix.rows) {
    r += 1;
    const row = sheet.getRow(r);
    row.values = [
      dimensionLabel('jobType', m.key, names),
      m.jobs,
      m.qty,
      m.revenue,
      data.jobTypeMix.totals.revenue ? m.revenue / data.jobTypeMix.totals.revenue : 0,
    ];
  }
  const last = r;
  r += 1;
  const total = sheet.getRow(r);
  total.values = [
    'Total',
    { formula: `SUM(B${first}:B${last})`, result: data.jobTypeMix.totals.jobs },
    { formula: `SUM(C${first}:C${last})`, result: data.jobTypeMix.totals.qty },
    { formula: `SUM(D${first}:D${last})`, result: data.jobTypeMix.totals.revenue },
    data.jobTypeMix.rows.length ? 1 : 0,
  ];
  for (let i = first; i <= r; i += 1) {
    const row = sheet.getRow(i);
    row.font = { name: FONT, size: 10, bold: i === r };
    row.getCell(2).numFmt = INT;
    row.getCell(3).numFmt = INT;
    row.getCell(4).numFmt = MONEY;
    row.getCell(5).numFmt = '0.0%';
    for (let c = 1; c <= 5; c += 1) {
      box(row.getCell(c));
      if (i !== r && (i - first) % 2 === 1)
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    }
  }
  total.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EAF4' } };
    c.border = { top: { style: 'medium', color: { argb: NAVY } } };
  });
  printSetup(sheet, '1:2', false);
}

function addBreakdown(wb: ExcelJS.Workbook, data: RevenueViewData, names: Map<string, string>) {
  if (!data.breakdown) return;
  const dim = data.groupBy;
  const name = DIMENSION_NAMES[dim] ?? dim;
  const sheet = wb.addWorksheet('Breakdown', { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 44 },
    { width: 11 },
    { width: 11 },
    { width: 18 },
    { width: 12 },
    { width: 16 },
  ];
  band(sheet, 'Breakdown by ' + name.toLowerCase(), safeText(data.viewPath || 'All data'), 6);
  const head = sheet.getRow(4);
  [name, 'Jobs', 'Quantity', 'Revenue (AED)', 'Share', 'Average per job (AED)'].forEach((h, i) => {
    head.getCell(i + 1).value = h;
  });
  styleHeader(head);
  const timeDim = dim === 'period' || dim === 'yearWeek' || dim === 'year' || dim === 'month';
  const rows = [...data.breakdown.rows];
  if (timeDim) rows.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  let r = 4;
  const first = 5;
  const sum = data.breakdown.totals;
  for (const row of rows) {
    r += 1;
    const x = sheet.getRow(r);
    x.values = [
      dimensionLabel(dim, row.key, names),
      row.jobs,
      row.qty,
      row.revenue,
      sum.revenue ? row.revenue / sum.revenue : 0,
      row.jobs ? row.revenue / row.jobs : 0,
    ];
  }
  const last = r;
  r += 1;
  const total = sheet.getRow(r);
  total.values = [
    'Total',
    { formula: `SUM(B${first}:B${last})`, result: sum.jobs },
    { formula: `SUM(C${first}:C${last})`, result: sum.qty },
    { formula: `SUM(D${first}:D${last})`, result: sum.revenue },
    rows.length ? 1 : 0,
    sum.jobs ? sum.revenue / sum.jobs : 0,
  ];
  for (let i = first; i <= r; i += 1) {
    const x = sheet.getRow(i);
    x.font = { name: FONT, size: 10, bold: i === r };
    x.getCell(2).numFmt = INT;
    x.getCell(3).numFmt = INT;
    x.getCell(4).numFmt = MONEY;
    x.getCell(5).numFmt = '0.0%';
    x.getCell(6).numFmt = MONEY;
    for (let c = 1; c <= 6; c += 1) {
      box(x.getCell(c));
      if (i !== r && (i - first) % 2 === 1)
        x.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    }
  }
  total.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EAF4' } };
    c.border = { top: { style: 'medium', color: { argb: NAVY } } };
  });
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: 6 } };
  printSetup(sheet, '1:4');
}

type JobCol = {
  h: string;
  w: number;
  fmt?: string;
  money?: boolean;
  get: (line: Record<string, unknown>) => unknown;
};

function addJobs(wb: ExcelJS.Workbook, data: RevenueViewData) {
  const sheet = wb.addWorksheet('Jobs', { views: [{ showGridLines: false }] });
  const pricingOf = (line: Record<string, unknown>) =>
    (line.pricing as Record<string, unknown> | null | undefined) ?? {};
  const date = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return v ?? null;
    return new Date(v.slice(0, 10) + 'T00:00:00Z');
  };
  const cols: JobCol[] = [
    { h: 'Date', w: 12, fmt: 'dd-mmm-yyyy', get: (l) => date(l.orderDate) },
    { h: 'Job type', w: 10, get: (l) => l.jobType },
    { h: 'Inv / Del no', w: 14, get: (l) => l.invDelNo },
    { h: 'CSOSC order', w: 14, get: (l) => l.csoscOrderNo },
    { h: 'Customer', w: 38, get: (l) => l.customer },
    { h: 'Sales channel', w: 11, get: (l) => l.salesChannel },
    { h: 'Salesperson', w: 18, get: (l) => l.salesPerson },
    { h: 'Order status', w: 16, get: (l) => l.orderStatus },
    { h: 'Job status', w: 14, get: (l) => l.jobSheetStatus },
    { h: 'Billing code', w: 26, get: (l) => l.billingCode },
    { h: 'Cost status', w: 16, get: (l) => l.costStatus },
    { h: 'ERP city / region', w: 14, get: (l) => pricingOf(l).city },
    { h: 'ERP category', w: 20, get: (l) => pricingOf(l).erpCategory },
    { h: 'ERP brand', w: 14, get: (l) => pricingOf(l).erpBrand },
    { h: 'ERP model(s)', w: 24, get: (l) => pricingOf(l).erpModels },
    { h: 'Qty', w: 8, fmt: INT, get: (l) => Number(l.qty ?? 0) },
    { h: 'Unit price (AED)', w: 13, fmt: MONEY, money: true, get: (l) => Number(l.unitPrice ?? 0) },
    { h: 'Revenue (AED)', w: 15, fmt: MONEY, money: true, get: (l) => Number(l.revenue ?? 0) },
    { h: 'Remarks', w: 60, get: (l) => oneLine(l.remarks) },
  ];
  if (data.exception) {
    const key = data.exception.key;
    cols.splice(2, 0, { h: 'Why it is flagged', w: 44, get: (l) => whyFlagged(key, l) });
  }
  // Leave out columns that are empty for every job in this view (for example the
  // ERP columns on an older workbook).
  const used = cols.filter(
    (c) =>
      c.h === 'Revenue (AED)' ||
      data.lines.some((l) => {
        const v = c.get(l);
        return v !== null && v !== undefined && v !== '';
      }),
  );
  const n = used.length;
  band(
    sheet,
    'Jobs in this view',
    safeText(data.viewPath || 'All data') +
      '   |   ' +
      data.totals.jobs.toLocaleString('en-US') +
      ' jobs, AED ' +
      data.totals.revenue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    n,
  );
  const head = sheet.getRow(4);
  used.forEach((c, i) => {
    head.getCell(i + 1).value = c.h;
    sheet.getColumn(i + 1).width = c.w;
  });
  styleHeader(head);
  data.lines.forEach((line, idx) => {
    const row = sheet.getRow(5 + idx);
    // Long remarks wrap, but a row never grows past 4 lines so the list stays compact
    // and printable; the full text is still in the cell.
    const remarkLength = String(oneLine(line.remarks) ?? '').length;
    row.height = Math.max(15, 12 * Math.min(4, Math.ceil(remarkLength / 70)));
    used.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.get(line);
      cell.value = (v ?? null) as ExcelJS.CellValue;
      cell.font = { name: FONT, size: 9 };
      cell.alignment = {
        vertical: 'top',
        horizontal: c.fmt && c.h !== 'Date' ? 'right' : 'left',
        wrapText: c.h === 'Remarks' || c.h === 'Why it is flagged',
      };
      if (c.fmt) cell.numFmt = c.fmt;
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
  });
  const lastData = 4 + data.lines.length;
  if (!data.lines.length) {
    sheet.mergeCells(5, 1, 5, n);
    const empty = sheet.getCell(5, 1);
    empty.value = 'No jobs match this view.';
    empty.font = { name: FONT, size: 10, italic: true };
    empty.alignment = { horizontal: 'left', indent: 1 };
    sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    printSetup(sheet, '1:4');
    return;
  }
  const totalRow = sheet.getRow(lastData + 1);
  const sumCol = (title: string, result: number) => {
    const idx = used.findIndex((c) => c.h === title);
    if (idx < 0) return;
    const letter = sheet.getColumn(idx + 1).letter;
    totalRow.getCell(idx + 1).value = {
      formula: `SUBTOTAL(109,${letter}5:${letter}${lastData})`,
      result,
    };
  };
  totalRow.getCell(1).value = 'Total (follows the filter)';
  sumCol(
    'Qty',
    data.lines.reduce((s, l) => s + Number(l.qty ?? 0), 0),
  );
  sumCol(
    'Revenue (AED)',
    data.lines.reduce((s, l) => s + Number(l.revenue ?? 0), 0),
  );
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > n) return;
    cell.font = { name: FONT, size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EAF4' } };
    cell.border = { top: { style: 'medium', color: { argb: NAVY } } };
    const spec = used[col - 1];
    if (spec?.fmt) cell.numFmt = spec.fmt;
    cell.alignment = { horizontal: spec?.fmt ? 'right' : 'left' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 4, xSplit: 0, showGridLines: false }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastData, column: n } };
  printSetup(sheet, '1:4');
}

export async function buildRevenueViewWorkbook(data: RevenueViewData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jacky's Service Portal";
  wb.created = new Date();
  wb.title = 'Service Revenue - Selected View';
  const names = jobTypeNames(data.batch);
  addSummary(wb, data, names);
  addBreakdown(wb, data, names);
  addJobs(wb, data);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
