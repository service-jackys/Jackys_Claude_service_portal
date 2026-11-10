import type { PoolClient } from 'pg';

// Lookups on the extra workbook sheets (Net Sale Current, CSIDI, CSIDO, CSIII; modification
// #247). Same idea as revenue-lookup.ts: the AI proposes, the server checks the names against
// the columns stored for the batch (customer columns were never stored), then runs read-only SQL.

export type SheetCatalogEntry = {
  name: string;
  rows: number;
  dateColumn: string | null;
  columns: { name: string; type: 'text' | 'number' | 'date' }[];
};

export interface SheetLookup {
  sheet: string;
  groupBy: string[];
  filters: Record<string, string>;
  sum: string[];
  dateFrom?: string;
  dateTo?: string;
  limit: number;
}

const MAX_ROWS = 60; // the request cleaner keeps only the first 60 items of any list
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readCatalog(summary: unknown): SheetCatalogEntry[] {
  const list = (summary as { sheets?: unknown } | null)?.sheets;
  return Array.isArray(list) ? (list as SheetCatalogEntry[]) : [];
}

/** What the AI is told exists: sheet names, columns (with type) and the date column. */
export function describeCatalog(catalog: SheetCatalogEntry[]) {
  return catalog.map((s) => ({
    sheet: s.name,
    rows: s.rows,
    dateColumn: s.dateColumn,
    columns: s.columns.map((c) => `${c.name} (${c.type})`),
  }));
}

export const SHEET_LOOKUP_INSTRUCTIONS =
  'PAGE DATA may list extraSheets (other sheets of the uploaded master workbook, customer columns removed). ' +
  'To query one, add to the lookups list an item {"sheet":"<sheet name>","groupBy":[up to 2 column names],"filters":{"<column>":"exact value"},"sum":[up to 3 number columns],"dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD","limit":number up to ' +
  MAX_ROWS +
  "}. Use column names exactly as listed. Each result row gives the group values, rows (count of sheet rows) and the sums. The date range applies to the sheet's dateColumn. ";

export function parseSheetLookups(text: string, catalog: SheetCatalogEntry[]): SheetLookup[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start || !catalog.length) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (raw as { lookups?: unknown })?.lookups;
  if (!Array.isArray(list)) return [];
  const out: SheetLookup[] = [];
  for (const item of list) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { sheet?: unknown }).sheet !== 'string'
    )
      continue;
    const entry = item as Record<string, unknown>;
    const sheet = catalog.find((s) => s.name === entry.sheet);
    if (!sheet) continue;
    const known = new Map(sheet.columns.map((c) => [c.name, c.type]));
    const names = (value: unknown, numeric: boolean, max: number) =>
      (Array.isArray(value) ? value : [])
        .filter(
          (c): c is string =>
            typeof c === 'string' && known.has(c) && (!numeric || known.get(c) === 'number'),
        )
        .filter((c, i, all) => all.indexOf(c) === i)
        .slice(0, max);
    const filters: Record<string, string> = {};
    const given =
      entry.filters && typeof entry.filters === 'object'
        ? (entry.filters as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(given)) {
      if (!known.has(key)) continue;
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const v = String(value).trim();
      if (v && v.length <= 60) filters[key] = v;
    }
    const lookup: SheetLookup = {
      sheet: sheet.name,
      groupBy: names(entry.groupBy, false, 2),
      filters,
      sum: names(entry.sum, true, 3),
      limit: Math.min(Math.max(Math.trunc(Number(entry.limit)) || 40, 1), MAX_ROWS),
    };
    if (sheet.dateColumn) {
      if (typeof entry.dateFrom === 'string' && DATE.test(entry.dateFrom))
        lookup.dateFrom = entry.dateFrom;
      if (typeof entry.dateTo === 'string' && DATE.test(entry.dateTo)) lookup.dateTo = entry.dateTo;
    }
    out.push(lookup);
  }
  return out;
}

export async function runSheetLookups(
  client: Pick<PoolClient, 'query'>,
  batchId: string | number,
  catalog: SheetCatalogEntry[],
  lookups: SheetLookup[],
) {
  const results: Array<Record<string, unknown>> = [];
  for (const lookup of lookups) {
    const sheet = catalog.find((s) => s.name === lookup.sheet);
    if (!sheet) continue;
    const params: unknown[] = [batchId, lookup.sheet];
    const ph = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = ['batch_id = $1', 'sheet = $2'];
    for (const [column, value] of Object.entries(lookup.filters))
      where.push(`lower(data->>${ph(column)}) = lower(${ph(value)})`);
    if (sheet.dateColumn && (lookup.dateFrom || lookup.dateTo)) {
      const dc = ph(sheet.dateColumn);
      where.push(`data->>${dc} ~ '^\\d{4}-\\d{2}-\\d{2}$'`);
      if (lookup.dateFrom) where.push(`data->>${dc} >= ${ph(lookup.dateFrom)}`);
      if (lookup.dateTo) where.push(`data->>${dc} <= ${ph(lookup.dateTo)}`);
    }
    const keys = lookup.groupBy.map((c) => `data->>${ph(c)}`);
    const sums = lookup.sum.map((c) => {
      const p = ph(c);
      return `COALESCE(SUM(CASE WHEN jsonb_typeof(data->${p}) = 'number' THEN (data->>${p})::numeric END), 0)`;
    });
    const select = [
      ...keys.map((k, i) => `${k} AS k${i}`),
      'COUNT(*) AS n',
      ...sums.map((s, i) => `${s} AS s${i}`),
    ];
    const groupSql = keys.length
      ? ` GROUP BY ${keys.map((_, i) => `k${i}`).join(', ')} ORDER BY ${keys.map((_, i) => `k${i}`).join(', ')}`
      : '';
    const rows = await client.query(
      `SELECT ${select.join(', ')} FROM workbook_sheet_rows WHERE ${where.join(' AND ')}${groupSql} LIMIT ${lookup.limit}`,
      params,
    );
    results.push({
      asked: {
        sheet: lookup.sheet,
        filters: lookup.filters,
        dateFrom: lookup.dateFrom,
        dateTo: lookup.dateTo,
      },
      columns: [...lookup.groupBy, 'rows', ...lookup.sum],
      rows: rows.rows.map((r: Record<string, string>) => [
        ...lookup.groupBy.map((_, i) => r[`k${i}`]),
        Number(r.n),
        ...lookup.sum.map((_, i) => Math.round(Number(r[`s${i}`]) * 100) / 100),
      ]),
      truncated: rows.rows.length >= lookup.limit,
    });
  }
  return results;
}
