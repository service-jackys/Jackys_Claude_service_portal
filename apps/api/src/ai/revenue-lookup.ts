import type { PoolClient } from 'pg';

// Read-only lookups the Ask AI may request on the Service Revenue Dashboard (modification #246).
// The AI proposes a small JSON plan; this file validates it against a fixed whitelist and runs it.
// Only grouped counts and amounts come back: never customers, sales people, invoice or order
// numbers or individual lines. Every SQL expression below is fixed text, and every value the AI
// supplies goes in as a bound parameter.

const DIMENSIONS = {
  date: "to_char(order_date, 'YYYY-MM-DD')",
  period: "to_char(make_date(year, month_no, 1), 'YYYY-MM')",
  year: 'year::text',
  month: 'month_no::text',
  week: 'week_no::text',
  jobType: 'job_type',
  channel: "COALESCE(NULLIF(sales_channel, ''), 'UNASSIGNED')",
  costStatus: "COALESCE(NULLIF(cost_status, ''), 'UNKNOWN')",
  billingCode: "COALESCE(NULLIF(billing_code, ''), 'UNKNOWN')",
  jobStatus: "COALESCE(NULLIF(job_sheet_status, ''), 'UNKNOWN')",
  orderStatus: "COALESCE(NULLIF(csosc_status, ''), 'UNKNOWN')",
} as const;

export type LookupDimension = keyof typeof DIMENSIONS;
export const LOOKUP_DIMENSIONS = Object.keys(DIMENSIONS) as LookupDimension[];

export interface Lookup {
  groupBy: LookupDimension[];
  filters: Partial<Record<LookupDimension, string>>;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
}

const MAX_LOOKUPS = 3;
const MAX_ROWS = 60; // the request cleaner keeps only the first 60 items of any list
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// What the AI is told about the lookups it may ask for.
export const LOOKUP_INSTRUCTIONS =
  'You may ask the server for extra figures from the revenue workbook before answering. ' +
  'Reply with ONLY a JSON object: {"lookups":[...]} with at most 3 lookups, or {"lookups":[]} when PAGE DATA already has what you need. ' +
  'Each lookup is {"groupBy":[up to 2 of ' +
  LOOKUP_DIMENSIONS.join(', ') +
  '],"filters":{any of those names:"exact value"},"dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD","limit":number up to ' +
  MAX_ROWS +
  '}. groupBy may be empty for one total. Each result row has lines (workbook rows), invoices (distinct invoice numbers), qty and revenue (AED). ' +
  'Job types are written like CSIJO, CSIJW, CSIDI, CSIDO, CSIII; dates like 2026-11-10; periods like 2026-11. ' +
  'Customers, sales people and invoice numbers are not available. No text outside the JSON.';

/** Reads the AI's reply and keeps only valid, whitelisted lookups. Anything else is dropped. */
export function parseLookupPlan(text: string): Lookup[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (raw as { lookups?: unknown })?.lookups;
  if (!Array.isArray(list)) return [];
  const out: Lookup[] = [];
  for (const item of list.slice(0, MAX_LOOKUPS)) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if ('sheet' in entry) continue; // sheet lookups are read by sheet-lookup.ts
    const groupBy = (Array.isArray(entry.groupBy) ? entry.groupBy : [])
      .filter((d): d is LookupDimension => typeof d === 'string' && d in DIMENSIONS)
      .filter((d, i, all) => all.indexOf(d) === i)
      .slice(0, 2);
    const filters: Lookup['filters'] = {};
    const given =
      entry.filters && typeof entry.filters === 'object'
        ? (entry.filters as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(given)) {
      if (!(key in DIMENSIONS)) continue;
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const text = String(value).trim();
      if (text && text.length <= 60) filters[key as LookupDimension] = text;
    }
    const lookup: Lookup = {
      groupBy,
      filters,
      limit: Math.min(Math.max(Math.trunc(Number(entry.limit)) || 60, 1), MAX_ROWS),
    };
    if (typeof entry.dateFrom === 'string' && DATE.test(entry.dateFrom))
      lookup.dateFrom = entry.dateFrom;
    if (typeof entry.dateTo === 'string' && DATE.test(entry.dateTo)) lookup.dateTo = entry.dateTo;
    out.push(lookup);
  }
  return out;
}

/** Runs the lookups against one revenue batch. Read-only. */
export async function runLookups(
  client: Pick<PoolClient, 'query'>,
  batchId: string | number,
  lookups: Lookup[],
) {
  const results: Array<Record<string, unknown>> = [];
  for (const lookup of lookups) {
    const params: unknown[] = [batchId];
    const where = ['batch_id = $1'];
    for (const [key, value] of Object.entries(lookup.filters)) {
      params.push(value);
      where.push(`${DIMENSIONS[key as LookupDimension]} = $${params.length}`);
    }
    if (lookup.dateFrom) {
      params.push(lookup.dateFrom);
      where.push(`order_date >= $${params.length}::date`);
    }
    if (lookup.dateTo) {
      params.push(lookup.dateTo);
      where.push(`order_date <= $${params.length}::date`);
    }
    if (lookup.groupBy.includes('date') || lookup.filters.date || lookup.dateFrom || lookup.dateTo)
      where.push('order_date IS NOT NULL');
    const keys = lookup.groupBy.map((d, i) => `${DIMENSIONS[d]} AS k${i}`);
    const select = [
      ...keys,
      'COUNT(*) AS lines',
      'COUNT(DISTINCT inv_del_no) AS invoices',
      'COALESCE(SUM(qty), 0) AS qty',
      'COALESCE(SUM(revenue), 0) AS revenue',
    ].join(', ');
    const group = lookup.groupBy.length
      ? ` GROUP BY ${lookup.groupBy.map((_, i) => `k${i}`).join(', ')} ORDER BY ${lookup.groupBy.map((_, i) => `k${i}`).join(', ')}`
      : '';
    const sql = `SELECT ${select} FROM revenue_lines WHERE ${where.join(' AND ')}${group} LIMIT ${lookup.limit}`;
    const rows = await client.query(sql, params);
    results.push({
      asked: {
        groupBy: lookup.groupBy,
        filters: lookup.filters,
        dateFrom: lookup.dateFrom,
        dateTo: lookup.dateTo,
      },
      rows: rows.rows.map((r: Record<string, string>) => {
        const row: Record<string, unknown> = {};
        lookup.groupBy.forEach((d, i) => {
          row[d] = r[`k${i}`];
        });
        row.lines = Number(r.lines);
        row.invoices = Number(r.invoices);
        row.qty = Number(r.qty);
        row.revenue = Math.round(Number(r.revenue) * 100) / 100;
        return row;
      }),
      truncated: rows.rows.length >= lookup.limit,
    });
  }
  return results;
}
