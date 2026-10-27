import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { StockItem } from '../../../../packages/db/src/stock-master.js';

export class StockParseError extends Error {}

export type ParsedStockFile = {
  sheetName: string;
  headerRow: number;
  /** Data rows read (an item can appear on several rows, e.g. one per barcode). */
  rowCount: number;
  /** One entry per item code, keyed by the upper-cased code (first row wins). */
  items: Map<string, StockItem>;
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

/** Header names (normalised) per field. The ERP Item Listing uses the first of
 *  each; the older ERP stock-valuation names are accepted too. */
const COLUMN_NAMES = {
  itemCode: ['itemcode'],
  itemDesc: ['itemdesc'],
  mainGroup: ['maingrpname', 'maingroup'],
  groupName: ['grpname', 'group'],
  subGroup: ['subgrpname', 'subgroup'],
  brand: ['brandname', 'brand'],
} as const;

const REQUIRED_LABELS: Record<keyof typeof COLUMN_NAMES, string> = {
  itemCode: 'Item Code',
  itemDesc: 'Item Desc',
  mainGroup: 'Maingrp Name',
  groupName: 'Grp Name',
  subGroup: 'SUBGRPNAME',
  brand: 'BRANDNAME',
};

const DESCRIPTIVE: (keyof StockItem)[] = [
  'itemDesc',
  'mainGroup',
  'groupName',
  'subGroup',
  'brand',
];

function findColumns(headers: Map<string, number>): Map<keyof typeof COLUMN_NAMES, number> | null {
  if (!headers.has('itemcode') || !headers.has('itemdesc')) return null;
  const found = new Map<keyof typeof COLUMN_NAMES, number>();
  for (const [field, names] of Object.entries(COLUMN_NAMES) as [
    keyof typeof COLUMN_NAMES,
    readonly string[],
  ][]) {
    const name = names.find((candidate) => headers.has(candidate));
    if (name) found.set(field, headers.get(name)!);
  }
  return found;
}

/**
 * Reads the ERP "Item Listing" workbook (Item Code, Item Desc, Maingrp Name,
 * Grp Name, SUBGRPNAME, BRANDNAME). The file has well over 100,000 rows, so it
 * is streamed rather than loaded whole.
 */
export async function parseStockWorkbook(buffer: Buffer): Promise<ParsedStockFile> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  const items = new Map<string, StockItem>();
  const warnings: string[] = [];
  let warningCount = 0;
  const warn = (message: string) => {
    warningCount += 1;
    if (warnings.length < WARNING_LIMIT) warnings.push(message);
  };
  let sheetName = '';
  let headerRow = 0;
  let rowCount = 0;
  let missing: string[] | null = null;

  try {
    for await (const worksheet of reader) {
      let columns: Map<keyof typeof COLUMN_NAMES, number> | null = null;
      let scanned = 0;
      for await (const row of worksheet) {
        const rowNumber = row.number;
        const values = row.values as ExcelJS.CellValue[];
        if (!columns) {
          scanned += 1;
          if (scanned > HEADER_SCAN_ROWS) break;
          const headers = new Map<string, number>();
          values.forEach((raw, column) => {
            const label = text(cellValue(raw));
            if (label && !headers.has(normalize(label))) headers.set(normalize(label), column);
          });
          const found = findColumns(headers);
          if (found) {
            const lacking = (Object.keys(COLUMN_NAMES) as (keyof typeof COLUMN_NAMES)[]).filter(
              (field) => !found.has(field),
            );
            if (lacking.length > 0) {
              missing = lacking.map((field) => REQUIRED_LABELS[field]);
              break;
            }
            columns = found;
            sheetName = (worksheet as unknown as { name?: string }).name ?? '';
            headerRow = rowNumber;
          }
          continue;
        }
        const first = text(cellValue(values[1]));
        if (first && /^summary\s*:?/i.test(first)) break;
        const read = (field: keyof typeof COLUMN_NAMES) =>
          text(cellValue(values[columns!.get(field)!]));
        const itemCode = read('itemCode');
        if (!itemCode) continue;
        const itemDesc = read('itemDesc');
        if (!itemDesc) {
          warn(`Row ${rowNumber}: ${itemCode} has no Item Desc and was skipped.`);
          continue;
        }
        rowCount += 1;
        const item: StockItem = {
          itemCode,
          itemDesc,
          mainGroup: read('mainGroup'),
          groupName: read('groupName'),
          subGroup: read('subGroup'),
          brand: read('brand'),
        };
        const key = itemCode.toUpperCase();
        const existing = items.get(key);
        if (!existing) {
          items.set(key, item);
          continue;
        }
        const differs = DESCRIPTIVE.filter(
          (field) => (existing[field] ?? null) !== (item[field] ?? null),
        );
        if (existing.itemCode !== itemCode) {
          warn(
            `Row ${rowNumber}: ${itemCode} is the same item code as ${existing.itemCode} apart from upper / lower case; the first row is used.`,
          );
        } else if (differs.length > 0) {
          warn(
            `Row ${rowNumber}: ${itemCode} differs from its earlier row in this file (${differs.join(', ')}); the first row is used.`,
          );
        }
      }
      if (headerRow > 0 || missing) break;
    }
  } catch (error) {
    if (error instanceof StockParseError) throw error;
    throw new StockParseError('The file could not be read as an .xlsx workbook.');
  }

  if (missing) {
    throw new StockParseError(`The header row is missing columns: ${missing.join(', ')}.`);
  }
  if (headerRow === 0) {
    throw new StockParseError(
      'No header row with Item Code and Item Desc was found in the first 40 rows. Upload the ERP "Item Listing" export.',
    );
  }
  if (items.size === 0) {
    throw new StockParseError('The file has a header but no item rows.');
  }
  if (warningCount > warnings.length) {
    warnings.push(`${warningCount - warnings.length} more warning(s) not shown.`);
  }
  return { sheetName, headerRow, rowCount, items, warnings };
}
