import type { PoolClient } from 'pg';

export type BatchKind = 'revenue' | 'budget';

export type ImportBatch = {
  id: string;
  kind: BatchKind;
  fileName: string;
  fileSha256: string;
  rowCount: number;
  totalAmount: string;
  summary: Record<string, unknown>;
  isActive: boolean;
  uploadedBy: string | null;
  uploadedAt: Date;
};

const batchColumns = `
  id,
  kind,
  file_name AS "fileName",
  file_sha256 AS "fileSha256",
  row_count AS "rowCount",
  total_amount AS "totalAmount",
  summary,
  is_active AS "isActive",
  uploaded_by AS "uploadedBy",
  uploaded_at AS "uploadedAt"
`;

export type RevenueLineInput = {
  sourceRow: number | null;
  jobType: string;
  description: string | null;
  invDelNo: string | null;
  csoscOrderNo: string | null;
  orderDate: string | null;
  year: number | null;
  weekNo: number | null;
  monthNo: number | null;
  customer: string | null;
  lpoNo: string | null;
  csoscStatus: string | null;
  jobSheetStatus: string | null;
  salesPerson: string | null;
  qty: number;
  unitPrice: number;
  revenue: number;
  originalJobValue: number;
  billingCode: string | null;
  salesChannel: string | null;
  costStatus: string | null;
  remarks: string | null;
};

export type BudgetLineInput = {
  section: string;
  lineItem: string;
  period: string;
  amount: number;
  sortOrder: number;
};

export async function createImportBatch(
  client: PoolClient,
  input: {
    kind: BatchKind;
    fileName: string;
    fileSha256: string;
    rowCount: number;
    totalAmount: number;
    summary: Record<string, unknown>;
    uploadedBy: string;
  },
): Promise<ImportBatch> {
  // A new upload replaces the active batch of its kind; the previous one is
  // kept (inactive) as an audit trail of what the dashboards used to show.
  await client.query('UPDATE revenue_import_batches SET is_active = false WHERE kind = $1', [
    input.kind,
  ]);
  const result = await client.query<ImportBatch>(
    `INSERT INTO revenue_import_batches
       (kind, file_name, file_sha256, row_count, total_amount, summary, is_active, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, $7)
     RETURNING ${batchColumns}`,
    [
      input.kind,
      input.fileName,
      input.fileSha256,
      input.rowCount,
      input.totalAmount,
      JSON.stringify(input.summary),
      input.uploadedBy,
    ],
  );
  return result.rows[0]!;
}

const REVENUE_CHUNK = 400;

export async function insertRevenueLines(
  client: PoolClient,
  batchId: string,
  lines: RevenueLineInput[],
): Promise<void> {
  for (let start = 0; start < lines.length; start += REVENUE_CHUNK) {
    const chunk = lines.slice(start, start + REVENUE_CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((line, i) => {
      const base = i * 23;
      params.push(
        batchId,
        line.sourceRow,
        line.jobType,
        line.description,
        line.invDelNo,
        line.csoscOrderNo,
        line.orderDate,
        line.year,
        line.weekNo,
        line.monthNo,
        line.customer,
        line.lpoNo,
        line.csoscStatus,
        line.jobSheetStatus,
        line.salesPerson,
        line.qty,
        line.unitPrice,
        line.revenue,
        line.originalJobValue,
        line.billingCode,
        line.salesChannel,
        line.costStatus,
        line.remarks,
      );
      return '(' + Array.from({ length: 23 }, (_, k) => '$' + (base + k + 1)).join(', ') + ')';
    });
    await client.query(
      `INSERT INTO revenue_lines
         (batch_id, source_row, job_type, description, inv_del_no, csosc_order_no, order_date,
          year, week_no, month_no, customer, lpo_no, csosc_status, job_sheet_status, sales_person,
          qty, unit_price, revenue, original_job_value, billing_code, sales_channel, cost_status, remarks)
       VALUES ${rows.join(', ')}`,
      params,
    );
  }
}

export async function insertBudgetLines(
  client: PoolClient,
  batchId: string,
  lines: BudgetLineInput[],
): Promise<void> {
  for (let start = 0; start < lines.length; start += 500) {
    const chunk = lines.slice(start, start + 500);
    const params: unknown[] = [];
    const rows = chunk.map((line, i) => {
      const base = i * 6;
      params.push(batchId, line.section, line.lineItem, line.period, line.amount, line.sortOrder);
      return '(' + Array.from({ length: 6 }, (_, k) => '$' + (base + k + 1)).join(', ') + ')';
    });
    await client.query(
      `INSERT INTO budget_lines (batch_id, section, line_item, period, amount, sort_order)
       VALUES ${rows.join(', ')}`,
      params,
    );
  }
}

export async function listBatches(client: PoolClient, limit = 20): Promise<ImportBatch[]> {
  const result = await client.query<ImportBatch>(
    `SELECT ${batchColumns} FROM revenue_import_batches ORDER BY uploaded_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function findActiveBatch(
  client: PoolClient,
  kind: BatchKind,
): Promise<ImportBatch | null> {
  const result = await client.query<ImportBatch>(
    `SELECT ${batchColumns} FROM revenue_import_batches
     WHERE kind = $1 AND is_active ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
    [kind],
  );
  return result.rows[0] ?? null;
}

// Dimensions a report can be filtered by or grouped on. Each maps to a SQL
// expression over revenue_lines -- always from this fixed whitelist, never
// from request text, so the generated SQL stays injection-safe.
export const REVENUE_DIMENSIONS = {
  year: 'year',
  month: 'month_no',
  week: 'week_no',
  period: "to_char(make_date(year, month_no, 1), 'YYYY-MM')",
  yearWeek: "(year::text || '-W' || lpad(week_no::text, 2, '0'))",
  jobType: 'job_type',
  channel: "COALESCE(NULLIF(sales_channel, ''), 'UNASSIGNED')",
  salesPerson: "COALESCE(NULLIF(sales_person, ''), 'UNASSIGNED')",
  customer: "COALESCE(NULLIF(customer, ''), 'UNKNOWN')",
  costStatus: "COALESCE(NULLIF(cost_status, ''), 'UNKNOWN')",
  billingCode: "COALESCE(NULLIF(billing_code, ''), 'UNKNOWN')",
  jobStatus: "COALESCE(NULLIF(job_sheet_status, ''), 'UNKNOWN')",
  orderStatus: "COALESCE(NULLIF(csosc_status, ''), 'UNKNOWN')",
} as const;

export type RevenueDimension = keyof typeof REVENUE_DIMENSIONS;

// Pre-defined data-quality / finance exception checks.
export const REVENUE_EXCEPTIONS = {
  billingReview: {
    label: 'Billing code needs review',
    description:
      'The billing code could not be derived from the job remarks (HAA / INS not stated).',
    sql: "billing_code = 'REVIEW'",
  },
  channelReview: {
    label: 'Sales channel needs review',
    description: 'The remarks do not say HAA or INS, so the channel is undecided.',
    sql: "sales_channel = 'REVIEW'",
  },
  costReview: {
    label: 'Cost status needs review',
    description:
      'Cost status is REVIEW or ZERO COST - REVIEW; the revenue rule could not be applied cleanly.',
    sql: "cost_status ILIKE '%REVIEW%'",
  },
  zeroRevenue: {
    label: 'Zero-revenue jobs',
    description: 'Jobs that produce no revenue (for example zero-cost RWR).',
    sql: 'revenue = 0',
  },
  notApproved: {
    label: 'Order not Approved',
    description: 'The CSOSC order status is not Approved (pending approval or submission).',
    sql: "COALESCE(csosc_status, '') <> 'Approved'",
  },
  unmatchedOrder: {
    label: 'No matching CSOSC order',
    description: 'The invoice reference found no CSOSC job order in the workbook.',
    sql: "lpo_no = 'UNMATCHED CSOSC'",
  },
  noCustomer: {
    label: 'Missing customer',
    description: 'No customer name on the row.',
    sql: "COALESCE(customer, '') = ''",
  },
} as const;

export type RevenueExceptionKey = keyof typeof REVENUE_EXCEPTIONS;

export type RevenueFilters = Partial<Record<RevenueDimension, string>> & {
  exception?: RevenueExceptionKey;
  search?: string;
};

function filterClause(
  batchId: string,
  filters: RevenueFilters,
  options: { ignore?: RevenueDimension[] } = {},
): { where: string; params: unknown[] } {
  const params: unknown[] = [batchId];
  const where = ['batch_id = $1'];
  for (const dimension of Object.keys(REVENUE_DIMENSIONS) as RevenueDimension[]) {
    const value = filters[dimension];
    if (value === undefined || value === '' || options.ignore?.includes(dimension)) continue;
    params.push(value);
    where.push(`${REVENUE_DIMENSIONS[dimension]}::text = $${params.length}`);
  }
  if (filters.exception) where.push('(' + REVENUE_EXCEPTIONS[filters.exception].sql + ')');
  if (filters.search) {
    params.push('%' + filters.search.replace(/[%_\\]/g, (c) => '\\' + c) + '%');
    const p = '$' + params.length;
    where.push(
      `(customer ILIKE ${p} OR inv_del_no ILIKE ${p} OR csosc_order_no ILIKE ${p} OR remarks ILIKE ${p} OR sales_person ILIKE ${p})`,
    );
  }
  return { where: where.join(' AND '), params };
}

type Totals = { revenue: string; jobs: string; qty: string };

async function totalsFor(client: PoolClient, f: { where: string; params: unknown[] }) {
  const totals = await client.query<Totals>(
    `SELECT COALESCE(SUM(revenue), 0) AS revenue, COUNT(*) AS jobs, COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE ${f.where}`,
    f.params,
  );
  const t = totals.rows[0]!;
  return { revenue: Number(t.revenue), jobs: Number(t.jobs), qty: Number(t.qty) };
}

export async function revenueGroup(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
  dimension: RevenueDimension,
  limit = 500,
) {
  const f = filterClause(batchId, filters);
  const expr = REVENUE_DIMENSIONS[dimension];
  const rows = await client.query<{ key: string; revenue: string; jobs: string; qty: string }>(
    `SELECT ${expr}::text AS key, COALESCE(SUM(revenue), 0) AS revenue, COUNT(*) AS jobs,
            COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE ${f.where} AND ${expr} IS NOT NULL
     GROUP BY 1 ORDER BY SUM(revenue) DESC, 1 LIMIT ${Math.min(Math.max(limit, 1), 2000)}`,
    f.params,
  );
  return {
    totals: await totalsFor(client, f),
    rows: rows.rows.map((r) => ({
      key: r.key,
      revenue: Number(r.revenue),
      jobs: Number(r.jobs),
      qty: Number(r.qty),
    })),
  };
}

// Two-way pivot (e.g. month x job type) used by the stacked charts and the
// finance matrix reports.
export async function revenueMatrix(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
  rowDimension: RevenueDimension,
  columnDimension: RevenueDimension,
) {
  const f = filterClause(batchId, filters);
  const r = REVENUE_DIMENSIONS[rowDimension];
  const c = REVENUE_DIMENSIONS[columnDimension];
  const cells = await client.query<{
    row: string;
    col: string;
    revenue: string;
    jobs: string;
    qty: string;
  }>(
    `SELECT ${r}::text AS row, ${c}::text AS col, COALESCE(SUM(revenue), 0) AS revenue,
            COUNT(*) AS jobs, COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE ${f.where} AND ${r} IS NOT NULL AND ${c} IS NOT NULL
     GROUP BY 1, 2 ORDER BY 1, 2`,
    f.params,
  );
  return {
    totals: await totalsFor(client, f),
    cells: cells.rows.map((x) => ({
      row: x.row,
      col: x.col,
      revenue: Number(x.revenue),
      jobs: Number(x.jobs),
      qty: Number(x.qty),
    })),
  };
}

export async function revenueExceptions(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
) {
  const base = filterClause(batchId, { ...filters, exception: undefined });
  const out = [];
  for (const [key, def] of Object.entries(REVENUE_EXCEPTIONS)) {
    const result = await client.query<{ jobs: string; revenue: string }>(
      `SELECT COUNT(*) AS jobs, COALESCE(SUM(revenue), 0) AS revenue
       FROM revenue_lines WHERE ${base.where} AND (${def.sql})`,
      base.params,
    );
    out.push({
      key,
      label: def.label,
      description: def.description,
      jobs: Number(result.rows[0]!.jobs),
      revenue: Number(result.rows[0]!.revenue),
    });
  }
  return { totals: await totalsFor(client, base), exceptions: out };
}

export async function revenueSummary(client: PoolClient, batchId: string, filters: RevenueFilters) {
  const f = filterClause(batchId, filters);
  const years = await client.query<{ year: number }>(
    `SELECT DISTINCT year FROM revenue_lines WHERE batch_id = $1 AND year IS NOT NULL ORDER BY year`,
    [batchId],
  );
  const distinct = async (dimension: RevenueDimension) =>
    (
      await client.query<{ v: string }>(
        `SELECT DISTINCT ${REVENUE_DIMENSIONS[dimension]}::text AS v FROM revenue_lines
         WHERE batch_id = $1 AND ${REVENUE_DIMENSIONS[dimension]} IS NOT NULL ORDER BY 1`,
        [batchId],
      )
    ).rows.map((r) => r.v);
  const weeksClause = filterClause(batchId, { year: filters.year, month: filters.month });
  const weeks = await client.query<{ v: string }>(
    `SELECT DISTINCT week_no::text AS v FROM revenue_lines
     WHERE ${weeksClause.where} AND week_no IS NOT NULL ORDER BY 1`,
    weeksClause.params,
  );
  const rates = await client.query<{ summary: { rates?: unknown } }>(
    `SELECT summary FROM revenue_import_batches WHERE id = $1`,
    [batchId],
  );
  return {
    totals: await totalsFor(client, f),
    rates: rates.rows[0]?.summary?.rates ?? [],
    options: {
      years: years.rows.map((r) => r.year),
      weeks: weeks.rows.map((r) => r.v).sort((a, b) => Number(a) - Number(b)),
      jobTypes: await distinct('jobType'),
      channels: await distinct('channel'),
      costStatuses: await distinct('costStatus'),
    },
  };
}

const lineColumns = `
  id, source_row AS "sourceRow", job_type AS "jobType", description,
  inv_del_no AS "invDelNo", csosc_order_no AS "csoscOrderNo", order_date::text AS "orderDate",
  year, week_no AS "weekNo", month_no AS "month", customer, lpo_no AS "lpoNo",
  csosc_status AS "orderStatus", job_sheet_status AS "jobSheetStatus",
  sales_person AS "salesPerson", qty, unit_price AS "unitPrice", revenue,
  original_job_value AS "originalJobValue", billing_code AS "billingCode",
  sales_channel AS "salesChannel", cost_status AS "costStatus", remarks
`;

export async function revenueLines(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
  page: number,
  pageSize: number,
) {
  const f = filterClause(batchId, filters);
  const totals = await client.query<{ total: string; revenue: string; qty: string }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE ${f.where}`,
    f.params,
  );
  const params = [...f.params, pageSize, (page - 1) * pageSize];
  const rows = await client.query(
    `SELECT ${lineColumns}
     FROM revenue_lines WHERE ${f.where}
     ORDER BY order_date DESC NULLS LAST, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows,
    total: Number(totals.rows[0]!.total),
    revenue: Number(totals.rows[0]!.revenue),
    qty: Number(totals.rows[0]!.qty),
  };
}

export async function revenueExportLines(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
  limit = 50000,
) {
  const f = filterClause(batchId, filters);
  const rows = await client.query(
    `SELECT ${lineColumns} FROM revenue_lines WHERE ${f.where}
     ORDER BY order_date DESC NULLS LAST, id DESC LIMIT ${limit}`,
    f.params,
  );
  return rows.rows;
}

export async function budgetVsActual(
  client: PoolClient,
  budgetBatchId: string,
  revenueBatchId: string | null,
) {
  const budget = await client.query<{
    section: string;
    lineItem: string;
    period: string;
    amount: string;
    sortOrder: number;
  }>(
    `SELECT section, line_item AS "lineItem", to_char(period, 'YYYY-MM') AS period, amount,
            sort_order AS "sortOrder"
     FROM budget_lines WHERE batch_id = $1 ORDER BY sort_order, period`,
    [budgetBatchId],
  );
  let actual: { period: string; revenue: string; qty: string }[] = [];
  if (revenueBatchId) {
    const result = await client.query<{ period: string; revenue: string; qty: string }>(
      `SELECT to_char(make_date(year, month_no, 1), 'YYYY-MM') AS period,
              SUM(revenue) AS revenue, SUM(qty) AS qty
       FROM revenue_lines
       WHERE batch_id = $1 AND year IS NOT NULL AND month_no BETWEEN 1 AND 12
       GROUP BY 1 ORDER BY 1`,
      [revenueBatchId],
    );
    actual = result.rows;
  }
  return { budget: budget.rows, actual };
}
