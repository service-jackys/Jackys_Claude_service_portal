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

export type RevenueFilters = {
  year?: number;
  month?: number;
  jobType?: string;
  channel?: string;
  search?: string;
};

function filterClause(
  batchId: string,
  filters: RevenueFilters,
  options: { ignoreMonth?: boolean } = {},
): { where: string; params: unknown[] } {
  const params: unknown[] = [batchId];
  const where = ['batch_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', '$' + params.length));
  };
  if (filters.year !== undefined) add('year = ?', filters.year);
  if (filters.month !== undefined && !options.ignoreMonth) add('month_no = ?', filters.month);
  if (filters.jobType) add('job_type = ?', filters.jobType);
  if (filters.channel) add("COALESCE(sales_channel, '') = ?", filters.channel);
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

export async function revenueSummary(client: PoolClient, batchId: string, filters: RevenueFilters) {
  const f = filterClause(batchId, filters);
  const fTrend = filterClause(batchId, filters, { ignoreMonth: true });

  const totals = await client.query<Totals>(
    `SELECT COALESCE(SUM(revenue), 0) AS revenue, COUNT(*) AS jobs, COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE ${f.where}`,
    f.params,
  );
  const byMonth = await client.query(
    `SELECT year, month_no AS "month", SUM(revenue) AS revenue, COUNT(*) AS jobs, SUM(qty) AS qty
     FROM revenue_lines WHERE ${fTrend.where} AND year IS NOT NULL AND month_no IS NOT NULL
     GROUP BY year, month_no ORDER BY year, month_no`,
    fTrend.params,
  );
  const group = async (expr: string, limit: number) =>
    (
      await client.query(
        `SELECT ${expr} AS label, SUM(revenue) AS revenue, COUNT(*) AS jobs, SUM(qty) AS qty
         FROM revenue_lines WHERE ${f.where}
         GROUP BY 1 ORDER BY SUM(revenue) DESC, 1 LIMIT ${limit}`,
        f.params,
      )
    ).rows;
  const years = await client.query<{ year: number }>(
    `SELECT DISTINCT year FROM revenue_lines WHERE batch_id = $1 AND year IS NOT NULL ORDER BY year`,
    [batchId],
  );
  const channels = await client.query<{ channel: string }>(
    `SELECT DISTINCT COALESCE(sales_channel, '') AS channel FROM revenue_lines
     WHERE batch_id = $1 ORDER BY 1`,
    [batchId],
  );
  const jobTypes = await client.query<{ jobType: string }>(
    `SELECT DISTINCT job_type AS "jobType" FROM revenue_lines WHERE batch_id = $1 ORDER BY 1`,
    [batchId],
  );
  const t = totals.rows[0]!;
  return {
    totals: { revenue: Number(t.revenue), jobs: Number(t.jobs), qty: Number(t.qty) },
    byMonth: byMonth.rows,
    byJobType: await group('job_type', 20),
    byChannel: await group("COALESCE(NULLIF(sales_channel, ''), 'UNASSIGNED')", 20),
    bySalesPerson: await group("COALESCE(NULLIF(sales_person, ''), 'UNASSIGNED')", 10),
    topCustomers: await group("COALESCE(NULLIF(customer, ''), 'UNKNOWN')", 10),
    options: {
      years: years.rows.map((r) => r.year),
      channels: channels.rows.map((r) => r.channel),
      jobTypes: jobTypes.rows.map((r) => r.jobType),
    },
  };
}

export async function revenueLines(
  client: PoolClient,
  batchId: string,
  filters: RevenueFilters,
  page: number,
  pageSize: number,
) {
  const f = filterClause(batchId, filters);
  const totals = await client.query<{ total: string; revenue: string }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(revenue), 0) AS revenue FROM revenue_lines WHERE ${f.where}`,
    f.params,
  );
  const params = [...f.params, pageSize, (page - 1) * pageSize];
  const rows = await client.query(
    `SELECT id, job_type AS "jobType", description, inv_del_no AS "invDelNo",
            csosc_order_no AS "csoscOrderNo", order_date::text AS "orderDate", customer,
            job_sheet_status AS "jobSheetStatus", sales_person AS "salesPerson", qty,
            unit_price AS "unitPrice", revenue, billing_code AS "billingCode",
            sales_channel AS "salesChannel", cost_status AS "costStatus"
     FROM revenue_lines WHERE ${f.where}
     ORDER BY order_date DESC NULLS LAST, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows,
    total: Number(totals.rows[0]!.total),
    revenue: Number(totals.rows[0]!.revenue),
  };
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
