import type { PoolClient } from 'pg';

export type B2bBranchRecord = {
  id: string;
  custCode: string;
  branchName: string;
  salesman: string | null;
  salesChannel: string | null;
  lastSalesOrderNumber: string | null;
  lastInvoiceDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const b2bBranchColumns = `
  b2b_branches.id,
  b2b_branches.cust_code AS "custCode",
  b2b_branches.branch_name AS "branchName",
  b2b_branches.salesman,
  b2b_branches.sales_channel AS "salesChannel",
  b2b_branches.last_sales_order_number AS "lastSalesOrderNumber",
  b2b_branches.last_invoice_date AS "lastInvoiceDate",
  b2b_branches.created_at AS "createdAt",
  b2b_branches.updated_at AS "updatedAt"
`;

// Staff-only (see modification.md #2 -- the public complaint form never
// calls this; it stays free text there and staff match it here afterwards).
// With no query, returns a first page for browsing; with a query, returns
// name matches. Capped at 20 either way -- this is a picker, not a full
// export.
export async function searchB2bBranchesForStaff(
  client: PoolClient,
  query: string | undefined,
): Promise<
  Array<{
    custCode: string;
    branchName: string;
    salesman: string | null;
    salesChannel: string | null;
    lastSalesOrderNumber: string | null;
  }>
> {
  const trimmed = (query ?? '').trim();
  const result = await client.query<{
    custCode: string;
    branchName: string;
    salesman: string | null;
    salesChannel: string | null;
    lastSalesOrderNumber: string | null;
  }>(
    trimmed
      ? `SELECT cust_code AS "custCode", branch_name AS "branchName", salesman,
                sales_channel AS "salesChannel",
                last_sales_order_number AS "lastSalesOrderNumber"
         FROM b2b_branches
         WHERE branch_name ILIKE $1
         ORDER BY branch_name
         LIMIT 20`
      : `SELECT cust_code AS "custCode", branch_name AS "branchName", salesman,
                sales_channel AS "salesChannel",
                last_sales_order_number AS "lastSalesOrderNumber"
         FROM b2b_branches
         ORDER BY branch_name
         LIMIT 20`,
    trimmed ? [`%${trimmed}%`] : [],
  );
  return result.rows;
}

export async function findB2bBranchByCustCode(
  client: PoolClient,
  custCode: string,
): Promise<B2bBranchRecord | null> {
  const result = await client.query<B2bBranchRecord>(
    `SELECT ${b2bBranchColumns} FROM b2b_branches WHERE cust_code = $1`,
    [custCode],
  );
  return result.rows[0] ?? null;
}

export async function upsertB2bBranch(
  client: PoolClient,
  input: {
    custCode: string;
    branchName: string;
    salesman: string | null;
    salesChannel: string | null;
    lastSalesOrderNumber: string | null;
    lastInvoiceDate: string | null;
  },
): Promise<B2bBranchRecord> {
  const result = await client.query<B2bBranchRecord>(
    `INSERT INTO b2b_branches (cust_code, branch_name, salesman, sales_channel, last_sales_order_number, last_invoice_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cust_code) DO UPDATE SET
       branch_name = EXCLUDED.branch_name,
       salesman = EXCLUDED.salesman,
       sales_channel = EXCLUDED.sales_channel,
       last_sales_order_number = EXCLUDED.last_sales_order_number,
       last_invoice_date = EXCLUDED.last_invoice_date,
       updated_at = now()
     RETURNING ${b2bBranchColumns}`,
    [
      input.custCode,
      input.branchName,
      input.salesman,
      input.salesChannel,
      input.lastSalesOrderNumber,
      input.lastInvoiceDate,
    ],
  );
  return result.rows[0];
}
