import ExcelJS from 'exceljs';
import type { ImportBatch } from '../../../../packages/db/src/revenue-dashboard.js';

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

  const jobs = wb.addWorksheet('Jobs');
  const cols: [string, string, number][] = [
    ['Date', 'orderDate', 12],
    ['Year', 'year', 7],
    ['Month', 'month', 7],
    ['Week', 'weekNo', 7],
    ['Job type', 'jobType', 10],
    ['Inv/Del no', 'invDelNo', 14],
    ['CSOSC order', 'csoscOrderNo', 14],
    ['Customer', 'customer', 40],
    ['Sales channel', 'salesChannel', 12],
    ['Salesperson', 'salesPerson', 18],
    ['Order status', 'orderStatus', 18],
    ['Job status', 'jobSheetStatus', 14],
    ['Billing code', 'billingCode', 28],
    ['Cost status', 'costStatus', 18],
    ['Qty', 'qty', 8],
    ['Unit price', 'unitPrice', 12],
    ['Original job value', 'originalJobValue', 14],
    ['Revenue (AED)', 'revenue', 14],
    ['Remarks', 'remarks', 60],
  ];
  jobs.addRow(cols.map((c) => c[0]));
  header(jobs, 1);
  cols.forEach((c, i) => (jobs.getColumn(i + 1).width = c[2]));
  for (const line of data.lines) {
    jobs.addRow(
      cols.map(([, key]) => {
        const v = line[key];
        if (['qty', 'unitPrice', 'originalJobValue', 'revenue'].includes(key))
          return Number(v ?? 0);
        // Guard against spreadsheet formula injection from free text.
        return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : (v ?? '');
      }),
    );
  }
  [16, 17, 18].forEach((c) => (jobs.getColumn(c).numFmt = MONEY));
  jobs.views = [{ state: 'frozen', ySplit: 1 }];
  jobs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
