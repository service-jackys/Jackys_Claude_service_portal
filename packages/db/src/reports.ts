import type { PoolClient } from 'pg';

// Generic runner for the Reports page (modification.md #52). The caller
// (apps/api/src/reports) passes fixed, hand-written SQL fragments from its
// report catalogue; only the date range, search text and paging arrive as
// bind parameters, so nothing user-supplied is ever concatenated into SQL.
export type ReportQuerySpec = {
  selectSql: string;
  fromSql: string;
  dateExpr: string;
  searchExprs: string[];
  orderBy: string;
};

export type ReportQueryFilters = {
  from?: string;
  to?: string;
  search?: string;
};

export async function queryReportRows(
  client: PoolClient,
  spec: ReportQuerySpec,
  filters: ReportQueryFilters,
  paging: { limit: number; offset: number },
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.from) where.push(`${spec.dateExpr} >= ${add(filters.from)}::date`);
  if (filters.to) where.push(`${spec.dateExpr} <= ${add(filters.to)}::date`);
  if (filters.search) {
    const parameter = add(`%${filters.search}%`);
    where.push(`(${spec.searchExprs.map((expr) => `${expr} ILIKE ${parameter}`).join(' OR ')})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${spec.fromSql} ${whereSql}`,
    values,
  );
  const limit = add(paging.limit);
  const offset = add(paging.offset);
  const result = await client.query(
    `SELECT ${spec.selectSql} FROM ${spec.fromSql} ${whereSql}
     ORDER BY ${spec.orderBy}
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { rows: result.rows as Record<string, unknown>[], total: Number(count.rows[0].total) };
}
