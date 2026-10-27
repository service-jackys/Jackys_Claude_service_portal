import ExcelJS from 'exceljs';
import type { B2bCustomer } from '../../../../packages/db/src/b2b-master.js';

export class B2bParseError extends Error {}

export type ParsedB2bFile = {
  sheetName: string;
  headerRow: number;
  /** Data rows read (a customer can appear on several rows). */
  rowCount: number;
  /** One entry per customer code, keyed by the upper-cased code. */
  customers: Map<string, B2bCustomer>;
  warnings: string[];
};

const HEADER_SCAN_ROWS = 40;
const WARNING_LIMIT = 200;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value)
      return cellValue((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ('richText' in value) {
      return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
    }
    if ('text' in value) return String((value as { text: unknown }).text);
    return null;
  }
  return value;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  return out === '' ? null : out;
}

/** The file's header names (normalised) per field. The first of each is what the
 *  portal's own download writes. Any other column in the file is ignored. */
const COLUMN_NAMES = {
  custCode: ['custcode', 'customercode', 'code'],
  customerName: ['customer', 'customername', 'branchname', 'branchschool', 'name'],
  salesman: ['salesman', 'salesperson'],
} as const;
type Field = keyof typeof COLUMN_NAMES;

/**
 * Reads a customer list workbook: Cust Code, Customer, Salesman (the file the
 * portal downloads). Only Cust Code and Customer are required; other columns are
 * ignored, so an ERP customer or invoice report works as it is. Where a customer
 * has several rows, the first is used.
 */
export async function parseB2bWorkbook(buffer: Buffer): Promise<ParsedB2bFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new B2bParseError('The file could not be read as an .xlsx workbook.');
  }

  const customers = new Map<string, B2bCustomer>();
  const warnings: string[] = [];
  let warningCount = 0;
  const warn = (message: string) => {
    warningCount += 1;
    if (warnings.length < WARNING_LIMIT) warnings.push(message);
  };
  let sheetName = '';
  let headerRow = 0;
  let rowCount = 0;

  for (const worksheet of workbook.worksheets) {
    let columns: Map<Field, number> | null = null;
    const limit = Math.min(worksheet.rowCount, HEADER_SCAN_ROWS);
    for (let r = 1; r <= limit && !columns; r += 1) {
      const headers = new Map<string, number>();
      worksheet.getRow(r).eachCell({ includeEmpty: false }, (cell, column) => {
        const label = text(cellValue(cell.value));
        if (label && !headers.has(normalize(label))) headers.set(normalize(label), column);
      });
      const found = new Map<Field, number>();
      for (const [field, names] of Object.entries(COLUMN_NAMES) as [Field, readonly string[]][]) {
        const name = names.find((candidate) => headers.has(candidate));
        if (name) found.set(field, headers.get(name)!);
      }
      if (found.has('custCode') && found.has('customerName')) {
        columns = found;
        headerRow = r;
      }
    }
    if (!columns) continue;
    sheetName = worksheet.name;
    const cols = columns;

    const seenAt = new Map<string, number>(); // first row number per code, for warnings
    for (let r = headerRow + 1; r <= worksheet.rowCount; r += 1) {
      const row = worksheet.getRow(r);
      const read = (field: Field): unknown =>
        cols.has(field) ? cellValue(row.getCell(cols.get(field)!).value) : null;
      const custCode = text(read('custCode'));
      if (!custCode) continue;
      if (/^(summary|total)\s*:?/i.test(custCode)) break;
      const customerName = text(read('customerName'));
      if (!customerName) {
        warn(`Row ${r}: ${custCode} has no customer name and was skipped.`);
        continue;
      }
      rowCount += 1;
      const customer: B2bCustomer = {
        custCode,
        customerName,
        salesman: text(read('salesman')),
      };
      const key = custCode.toUpperCase();
      const existing = customers.get(key);
      if (!existing) {
        customers.set(key, customer);
        seenAt.set(key, r);
        continue;
      }
      // Several rows for one customer: the first row is used.
      if (customer.customerName !== existing.customerName) {
        warn(
          `Row ${r}: ${custCode} is named "${customer.customerName}" here and "${existing.customerName}" on row ${seenAt.get(key)}; the first row is used.`,
        );
      } else if ((customer.salesman ?? null) !== (existing.salesman ?? null)) {
        warn(
          `Row ${r}: ${custCode} has salesman "${customer.salesman ?? ''}" here and "${existing.salesman ?? ''}" on row ${seenAt.get(key)}; the first row is used.`,
        );
      }
    }
    break;
  }

  if (headerRow === 0) {
    throw new B2bParseError(
      'No header row with Cust Code and Customer was found in the first 40 rows. Use the file you download from this page, or any list with Cust Code and Customer columns.',
    );
  }
  if (customers.size === 0) {
    throw new B2bParseError('The file has a header but no customer rows.');
  }
  if (warningCount > warnings.length) {
    warnings.push(`${warningCount - warnings.length} more warning(s) not shown.`);
  }
  return { sheetName, headerRow, rowCount, customers, warnings };
}
