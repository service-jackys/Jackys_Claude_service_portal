import type { PoolClient } from 'pg';

export type B2bBranchRecord = {
  id: string;
  custCode: string;
  branchName: string;
  salesman: string | null;
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
  b2b_branches.last_sales_order_number AS "lastSalesOrderNumber",
  b2b_branches.last_invoice_date AS "lastInvoiceDate",
  b2b_branches.created_at AS "createdAt",
  b2b_branches.updated_at AS "updatedAt"
`;

// Public-facing: name + custCode only, never the salesman (that's an
// internal detail, surfaced to staff later in appointments/job cards, not
// to the customer submitting the complaint).
export async function listB2bBranchesForPublicPicker(
  client: PoolClient,
): Promise<Array<{ custCode: string; branchName: string }>> {
  const result = await client.query<{ custCode: string; branchName: string }>(
    `SELECT cust_code AS "custCode", branch_name AS "branchName"
     FROM b2b_branches
     ORDER BY branch_name`,
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
    lastSalesOrderNumber: string | null;
    lastInvoiceDate: string | null;
  },
): Promise<B2bBranchRecord> {
  const result = await client.query<B2bBranchRecord>(
    `INSERT INTO b2b_branches (cust_code, branch_name, salesman, last_sales_order_number, last_invoice_date)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cust_code) DO UPDATE SET
       branch_name = EXCLUDED.branch_name,
       salesman = EXCLUDED.salesman,
       last_sales_order_number = EXCLUDED.last_sales_order_number,
       last_invoice_date = EXCLUDED.last_invoice_date,
       updated_at = now()
     RETURNING ${b2bBranchColumns}`,
    [
      input.custCode,
      input.branchName,
      input.salesman,
      input.lastSalesOrderNumber,
      input.lastInvoiceDate,
    ],
  );
  return result.rows[0];
}
