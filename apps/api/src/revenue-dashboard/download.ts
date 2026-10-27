import ExcelJS from 'exceljs';
import type {
  BudgetLineInput,
  RevenueLineInput,
} from '../../../../packages/db/src/revenue-dashboard.js';

/** Header text of the "Revenue Source" sheet, the same labels the upload reads. */
const REVENUE_SOURCE_COLUMNS: { header: string; key: keyof RevenueLineInput; width: number }[] = [
  { header: 'Source Row', key: 'sourceRow', width: 10 },
  { header: 'Job Type', key: 'jobType', width: 10 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Inv/Del No', key: 'invDelNo', width: 16 },
  { header: 'CSOSC Order No', key: 'csoscOrderNo', width: 16 },
  { header: 'Order Date', key: 'orderDate', width: 12 },
  { header: 'Year', key: 'year', width: 6 },
  { header: 'Week No', key: 'weekNo', width: 8 },
  { header: 'Month No', key: 'monthNo', width: 9 },
  { header: 'Customer', key: 'customer', width: 34 },
  { header: 'CSOSC LPO No', key: 'lpoNo', width: 16 },
  { header: 'CSOSC Status', key: 'csoscStatus', width: 14 },
  { header: 'Job Sheet Status', key: 'jobSheetStatus', width: 16 },
  { header: 'Sales Person', key: 'salesPerson', width: 20 },
  { header: 'Qty', key: 'qty', width: 8 },
  { header: 'Proposed Price / Job', key: 'unitPrice', width: 18 },
  { header: 'Revenue', key: 'revenue', width: 14 },
  { header: 'Original Job Value', key: 'originalJobValue', width: 16 },
  { header: 'Billing Code', key: 'billingCode', width: 14 },
  { header: 'Sales Channel', key: 'salesChannel', width: 14 },
  { header: 'Cost Status', key: 'costStatus', width: 14 },
  { header: 'Remarks', key: 'remarks', width: 30 },
];

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** The job rows of a revenue upload, rebuilt as a "Revenue Source" sheet. */
export async function buildRevenueSourceWorkbook(lines: RevenueLineInput[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Revenue Source');
  sheet.columns = REVENUE_SOURCE_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  for (const line of lines) sheet.addRow(line);
  styleHeader(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const SECTION_LABELS: Record<string, string> = {
  volume: 'Volume',
  revenue: 'Revenue',
  cost: 'Cost',
  opex: 'Opex',
  nop: 'Net operating profit',
  below: 'Below the line',
  np: 'Net profit',
};

/** The monthly budget lines of a budget upload: one row per P&L line, 12 month columns. */
export async function buildBudgetWorkbook(lines: BudgetLineInput[]): Promise<Buffer> {
  const periods = [...new Set(lines.map((line) => line.period))].sort();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Budget (from portal data)');
  sheet.columns = [
    { header: 'Section', key: 'section', width: 22 },
    { header: 'Line item', key: 'lineItem', width: 36 },
    ...periods.map((period) => ({ header: period.slice(0, 7), key: period, width: 14 })),
    { header: 'Total', key: 'total', width: 16 },
  ];
  const byItem = new Map<
    string,
    { section: string; lineItem: string; amounts: Map<string, number> }
  >();
  for (const line of lines) {
    const key = `${line.sortOrder}|${line.lineItem}`;
    let entry = byItem.get(key);
    if (!entry) {
      entry = { section: line.section, lineItem: line.lineItem, amounts: new Map() };
      byItem.set(key, entry);
    }
    entry.amounts.set(line.period, line.amount);
  }
  for (const entry of byItem.values()) {
    const row: Record<string, unknown> = {
      section: SECTION_LABELS[entry.section] ?? entry.section,
      lineItem: entry.lineItem,
    };
    let total = 0;
    for (const period of periods) {
      const amount = entry.amounts.get(period) ?? 0;
      row[period] = amount;
      total += amount;
    }
    row.total = total;
    sheet.addRow(row);
  }
  styleHeader(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
