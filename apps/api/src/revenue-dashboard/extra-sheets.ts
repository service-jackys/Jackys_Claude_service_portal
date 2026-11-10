import type ExcelJS from 'exceljs';

// Sheets of the Service Dashboard master that are kept (beyond "Revenue Source") so the Ask AI
// can answer from them. The date column is the one a date filter uses.
export const EXTRA_SHEETS = [
  {
    name: 'Net Sale Current',
    dateColumn: 'Inv Dt',
    note: 'ERP net sale lines of the service invoices, one row per invoice line. Service charge lines (delivery, delivery + installation, installation) are the rows whose "Invi Item Code" starts with "SERV" (for example SERV-DELIVERY-HAA, SERV- DEL&INST -JERC); on those rows "Invi Item Desc" holds the appliance model, "Txn Code" is the job type (CSIDI, CSIDO, CSIII), "Sm Name" is the sales person, "Inv No" the invoice number. The ERP "Net Val" is 0 on them; the charge worked out by the workbook is in "Proposed Revenue" (use that for delivery charge amounts).',
  },
  {
    name: 'CSIDI',
    dateColumn: 'Date',
    note: 'Delivery + installation invoices with the workbook pricing; "Salesman" is the sales person, "Proposed Revenue" the workbook charge.',
  },
  {
    name: 'CSIDO',
    dateColumn: 'Date',
    note: 'Delivery only invoices; "Salesman" is the sales person.',
  },
  {
    name: 'CSIII',
    dateColumn: 'Date',
    note: 'Installation only invoices; "Salesman" is the sales person.',
  },
] as const;

// Columns that identify a customer (or are free text that may contain one). Dropped at read
// time: never stored, so they can never reach the AI.
const BLOCKED_COLUMN =
  /^(cust(omer)?[ _.]?(name|code)|customer|trn[ _.]?no\.?|remarks|source\.name)$/i;

const MAX_ROWS = 20000;

export type SheetColumn = { name: string; type: 'text' | 'number' | 'date' };
export type ParsedExtraSheet = {
  name: string;
  dateColumn: string | null;
  columns: SheetColumn[];
  rows: Record<string, string | number | boolean>[];
};

function plainValue(value: ExcelJS.CellValue | undefined): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return plainValue(v.result as ExcelJS.CellValue);
    if (Array.isArray(v.richText))
      return (v.richText as { text: string }[]).map((p) => p.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return value;
}

function cleanCell(value: ExcelJS.CellValue | undefined): string | number | boolean | null {
  const v = plainValue(value);
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  const s = String(v)
    .replace(/_x000D_/g, '')
    .replace(/\r/g, '')
    .trim();
  return s === '' ? null : s.slice(0, 200);
}

export function parseExtraSheets(workbook: ExcelJS.Workbook): ParsedExtraSheet[] {
  const out: ParsedExtraSheet[] = [];
  for (const config of EXTRA_SHEETS) {
    const sheet = workbook.getWorksheet(config.name);
    if (!sheet) continue;
    const names = new Map<number, string>();
    const seen = new Set<string>();
    sheet.getRow(1).eachCell((cell, col) => {
      const label = cleanCell(cell.value);
      if (typeof label !== 'string' || BLOCKED_COLUMN.test(label)) return;
      let name = label;
      for (let n = 2; seen.has(name.toLowerCase()); n += 1) name = `${label} ${n}`;
      seen.add(name.toLowerCase());
      names.set(col, name);
    });
    if (!names.size) continue;
    const types = new Map<string, Set<string>>();
    const rows: ParsedExtraSheet['rows'] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || rows.length >= MAX_ROWS) return;
      const data: Record<string, string | number | boolean> = {};
      for (const [col, name] of names) {
        const value = cleanCell(row.getCell(col).value);
        if (value === null) continue;
        data[name] = value;
        const kind =
          typeof value === 'number'
            ? 'number'
            : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
              ? 'date'
              : 'text';
        (types.get(name) ?? types.set(name, new Set()).get(name)!).add(kind);
      }
      if (Object.keys(data).length) rows.push(data);
    });
    if (!rows.length) continue;
    const columns: SheetColumn[] = [...names.values()]
      .filter((name) => types.has(name))
      .map((name) => {
        const kinds = types.get(name)!;
        return { name, type: kinds.size === 1 ? ([...kinds][0] as SheetColumn['type']) : 'text' };
      });
    out.push({
      name: config.name,
      dateColumn: columns.some((c) => c.name === config.dateColumn) ? config.dateColumn : null,
      columns,
      rows,
    });
  }
  return out;
}
