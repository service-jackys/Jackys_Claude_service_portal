import ExcelJS from 'exceljs';
import type { StockRow } from '../../../../packages/db/src/stock-master.js';

export class StockParseError extends Error {}

export type ParsedStockFile = {
  sheetName: string;
  headerRow: number;
  rows: StockRow[];
  /** One entry per unique ItemCode (first row wins). */
  items: Map<string, StockRow>;
  warnings: string[];
};

const HEADER_SCAN_ROWS = 40;
const REQUIRED = ['itemcode', 'itemdesc', 'maingroup', 'group', 'subgroup', 'brand'] as const;

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

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const DESCRIPTIVE: (keyof StockRow)[] = [
  'itemDesc',
  'grade',
  'mainGroup',
  'groupName',
  'subGroup',
  'brand',
  'itemType',
];

export async function parseStockWorkbook(buffer: Buffer): Promise<ParsedStockFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new StockParseError('The file could not be read as an .xlsx workbook.');
  }

  let found: { sheet: ExcelJS.Worksheet; headerRow: number; columns: Map<string, number> } | null =
    null;
  for (const sheet of workbook.worksheets) {
    const last = Math.min(sheet.rowCount, HEADER_SCAN_ROWS);
    for (let rowNumber = 1; rowNumber <= last && !found; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const columns = new Map<string, number>();
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const label = text(cellValue(cell.value));
        if (label) {
          const key = normalize(label);
          if (!columns.has(key)) columns.set(key, column);
        }
      });
      if (columns.has('itemcode') && columns.has('itemdesc')) {
        found = { sheet, headerRow: rowNumber, columns };
      }
    }
    if (found) break;
  }
  if (!found) {
    throw new StockParseError(
      'No header row with ItemCode and ItemDesc was found in the first 40 rows. Upload the ERP "Current Stock Valuation" export.',
    );
  }
  const { sheet, headerRow, columns } = found;
  const missing = REQUIRED.filter((name) => !columns.has(name));
  if (missing.length > 0) {
    throw new StockParseError(`The header row is missing columns: ${missing.join(', ')}.`);
  }

  const read = (rowNumber: number, key: string): unknown => {
    const column = columns.get(key);
    return column ? cellValue(sheet.getRow(rowNumber).getCell(column).value) : null;
  };

  const rows: StockRow[] = [];
  const items = new Map<string, StockRow>();
  const warnings: string[] = [];
  let skippedBlank = 0;
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const first = text(cellValue(sheet.getRow(rowNumber).getCell(1).value));
    if (first && /^summary\s*:?/i.test(first)) break;
    const itemCode = text(read(rowNumber, 'itemcode'));
    if (!itemCode) {
      if (columns.size > 0 && first) skippedBlank += 1;
      continue;
    }
    const itemDesc = text(read(rowNumber, 'itemdesc'));
    if (!itemDesc) {
      warnings.push(`Row ${rowNumber}: ${itemCode} has no ItemDesc and was skipped.`);
      continue;
    }
    const row: StockRow = {
      location: text(read(rowNumber, 'location')),
      locnDesc: text(read(rowNumber, 'locndesc')),
      itemCode,
      itemDesc,
      grade: text(read(rowNumber, 'grade')),
      stock: num(read(rowNumber, 'stock')),
      wac: num(read(rowNumber, 'wac')),
      value: num(read(rowNumber, 'value')),
      transit: num(read(rowNumber, 'transit')),
      reserved: num(read(rowNumber, 'reserved')),
      mainGroup: text(read(rowNumber, 'maingroup')),
      groupName: text(read(rowNumber, 'group')),
      subGroup: text(read(rowNumber, 'subgroup')),
      brand: text(read(rowNumber, 'brand')),
      itemType: text(read(rowNumber, 'type')),
      lastGrn: num(read(rowNumber, 'lastgrn')),
      lastGrnDate: dateOnly(read(rowNumber, 'lastgrndate')),
      landedCost: num(read(rowNumber, 'landedcost')),
    };
    rows.push(row);
    const existing = items.get(itemCode);
    if (!existing) {
      items.set(itemCode, row);
    } else {
      const differs = DESCRIPTIVE.filter((key) => (existing[key] ?? null) !== (row[key] ?? null));
      if (differs.length > 0) {
        warnings.push(
          `Row ${rowNumber}: ${itemCode} differs from its earlier row in this file (${differs.join(', ')}); the first row is used.`,
        );
      }
    }
  }
  if (skippedBlank > 0) {
    warnings.push(`${skippedBlank} row(s) without an ItemCode were ignored.`);
  }
  if (rows.length === 0) {
    throw new StockParseError('The file has a header but no item rows.');
  }
  return { sheetName: sheet.name, headerRow, rows, items, warnings };
}
