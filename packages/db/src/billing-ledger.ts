import type { PoolClient } from 'pg';

// Accounts view of billed jobs: a ledger of every job that carries an amount,
// a statement per bill-to party, and an allocation by brand / product group
// for ERP cost allocation. "Billed amount" is the chargeable amount when set,
// otherwise service charge plus parts (the same rule as the delivery gate).
const BILLED = 'COALESCE(j.amount_chargeable, j.grand_total)';

// Where the job is in the accounts flow. Anyone who is not the paying customer
// is billed through the sales channel, including jobs with no payer recorded.
const STAGE = `CASE
  WHEN j.payment_by = 'Customer' AND j.payment_confirmed_at IS NOT NULL THEN 'Paid'
  WHEN j.invoice_no IS NULL THEN 'Not invoiced'
  WHEN j.payment_by = 'Customer' THEN 'Invoiced, awaiting payment'
  ELSE 'Invoiced to channel' END`;

// The party that receives the bill: the channel, or the customer when they pay.
const BILL_TO = `CASE
  WHEN j.payment_by = 'Customer' THEN COALESCE(NULLIF(j.customer_name, ''), 'Customer')
  ELSE COALESCE(NULLIF(j.bill_to_channel, ''), NULLIF(j.sales_channel, ''), 'Not set') END`;

export const BILLING_STAGES = [
  'Not invoiced',
  'Invoiced, awaiting payment',
  'Invoiced to channel',
  'Paid',
] as const;

export type BillingLedgerQuery = {
  from?: string;
  to?: string;
  type?: string;
  payer?: string;
  billTo?: string;
  stage?: string;
  search?: string;
};

export type BillingLedgerRow = {
  id: string;
  jobCardReference: string;
  jobCardDate: string | null;
  deliveryDate: string | null;
  billingJobType: string | null;
  registeredWarranty: string | null;
  finalWarranty: string | null;
  warrantyChangeReason: string | null;
  payer: string | null;
  billTo: string;
  customerName: string | null;
  customerType: string | null;
  b2bBranchSchool: string | null;
  salesman: string | null;
  salesChannel: string | null;
  region: string | null;
  salesOrderNumber: string | null;
  itemCode: string | null;
  brand: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  modelNo: string | null;
  serialNo: string | null;
  technicianName: string | null;
  serviceCharge: number;
  partsCost: number;
  grandTotal: number;
  adjustment: number;
  billedAmount: number;
  invoiceNo: string | null;
  invoiceDate: string | null;
  paymentMode: string | null;
  paymentReference: string | null;
  paymentConfirmedAt: Date | null;
  stage: string;
  jobFinalStatus: string;
};

export type BillingTotals = {
  jobs: number;
  serviceCharge: number;
  partsCost: number;
  adjustment: number;
  billedAmount: number;
  invoicedAmount: number;
  notInvoicedAmount: number;
};

export type ChannelStatementRow = {
  billTo: string;
  jobs: number;
  warrantyAmount: number;
  nonWarrantyAmount: number;
  billedAmount: number;
  invoicedAmount: number;
  notInvoicedAmount: number;
  paidAmount: number;
};

export type AllocationRow = {
  brand: string;
  mainGroup: string;
  groupName: string;
  jobs: number;
  serviceCharge: number;
  partsCost: number;
  billedAmount: number;
};

function where(query: BillingLedgerQuery) {
  const clauses = [`${BILLED} > 0`, `j.job_final_status <> 'Cancelled'`];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace('$n', `$${values.length}`));
  };
  const date = 'COALESCE(j.job_card_date, j.created_at::date)';
  if (query.from) add(`${date} >= $n::date`, query.from);
  if (query.to) add(`${date} <= $n::date`, query.to);
  if (query.type) add('j.billing_job_type = $n', query.type);
  if (query.payer === 'Sales channel') clauses.push(`j.payment_by IS DISTINCT FROM 'Customer'`);
  else if (query.payer) add('j.payment_by = $n', query.payer);
  if (query.billTo) add(`${BILL_TO} = $n`, query.billTo);
  if (query.stage) add(`${STAGE} = $n`, query.stage);
  if (query.search) {
    values.push(`%${query.search}%`);
    const n = `$${values.length}`;
    clauses.push(`(j.job_card_reference ILIKE ${n} OR j.customer_name ILIKE ${n}
      OR j.invoice_no ILIKE ${n} OR j.bill_to_channel ILIKE ${n}
      OR j.item_code ILIKE ${n} OR j.model_no ILIKE ${n} OR j.serial_no ILIKE ${n}
      OR j.sales_order_number ILIKE ${n})`);
  }
  return { clause: `WHERE ${clauses.join(' AND ')}`, values };
}

const num = (value: unknown) => Number(value) || 0;

export async function queryBillingLedger(
  client: PoolClient,
  query: BillingLedgerQuery,
  paging?: { page: number; pageSize: number },
): Promise<{ rows: BillingLedgerRow[]; total: number }> {
  const { clause, values } = where(query);
  const total = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM service_job_cards j ${clause}`,
    values,
  );
  const limit = paging ? Math.min(Math.max(paging.pageSize, 1), 200) : 50000;
  const offset = paging ? (Math.max(paging.page, 1) - 1) * limit : 0;
  const result = await client.query(
    `SELECT j.id, j.job_card_reference AS "jobCardReference",
            j.job_card_date::text AS "jobCardDate", j.delivery_date::text AS "deliveryDate",
            j.billing_job_type AS "billingJobType",
            j.warranty_status AS "registeredWarranty",
            COALESCE(j.final_warranty_status, j.warranty_status) AS "finalWarranty",
            j.warranty_override_reason AS "warrantyChangeReason",
            COALESCE(j.payment_by, 'Sales channel') AS payer, ${BILL_TO} AS "billTo",
            j.customer_name AS "customerName", j.customer_type AS "customerType",
            COALESCE(j.b2b_branch_school, '') AS "b2bBranchSchool", j.salesman,
            j.sales_channel AS "salesChannel", j.region,
            j.sales_order_number AS "salesOrderNumber",
            j.item_code AS "itemCode", j.brand, j.main_group AS "mainGroup",
            j.group_name AS "groupName", j.sub_group AS "subGroup",
            j.model_no AS "modelNo", j.serial_no AS "serialNo",
            j.technician_name AS "technicianName",
            COALESCE(j.service_charge, 0)::float8 AS "serviceCharge",
            COALESCE(j.total_cost, 0)::float8 AS "partsCost",
            COALESCE(j.grand_total, 0)::float8 AS "grandTotal",
            (${BILLED} - COALESCE(j.grand_total, 0))::float8 AS adjustment,
            ${BILLED}::float8 AS "billedAmount",
            j.invoice_no AS "invoiceNo", j.invoice_date::text AS "invoiceDate",
            j.payment_mode AS "paymentMode", j.payment_reference AS "paymentReference",
            j.payment_confirmed_at AS "paymentConfirmedAt",
            ${STAGE} AS stage, j.job_final_status AS "jobFinalStatus"
     FROM service_job_cards j ${clause}
     ORDER BY ${BILL_TO} ASC, j.job_card_date DESC NULLS LAST, j.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { rows: result.rows as BillingLedgerRow[], total: Number(total.rows[0].total) };
}

export async function billingTotals(
  client: PoolClient,
  query: BillingLedgerQuery,
): Promise<BillingTotals> {
  const { clause, values } = where(query);
  const result = await client.query(
    `SELECT count(*)::int AS jobs,
            COALESCE(sum(j.service_charge), 0)::float8 AS "serviceCharge",
            COALESCE(sum(j.total_cost), 0)::float8 AS "partsCost",
            COALESCE(sum(${BILLED} - COALESCE(j.grand_total, 0)), 0)::float8 AS adjustment,
            COALESCE(sum(${BILLED}), 0)::float8 AS "billedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NOT NULL), 0)::float8 AS "invoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NULL), 0)::float8 AS "notInvoicedAmount"
     FROM service_job_cards j ${clause}`,
    values,
  );
  const row = result.rows[0];
  return {
    jobs: num(row.jobs),
    serviceCharge: num(row.serviceCharge),
    partsCost: num(row.partsCost),
    adjustment: num(row.adjustment),
    billedAmount: num(row.billedAmount),
    invoicedAmount: num(row.invoicedAmount),
    notInvoicedAmount: num(row.notInvoicedAmount),
  };
}

export async function channelStatement(
  client: PoolClient,
  query: BillingLedgerQuery,
): Promise<ChannelStatementRow[]> {
  const { clause, values } = where(query);
  const result = await client.query(
    `SELECT ${BILL_TO} AS "billTo", count(*)::int AS jobs,
            COALESCE(sum(${BILLED}) FILTER (WHERE j.billing_job_type = 'CSIJW'), 0)::float8 AS "warrantyAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.billing_job_type IS DISTINCT FROM 'CSIJW'), 0)::float8 AS "nonWarrantyAmount",
            COALESCE(sum(${BILLED}), 0)::float8 AS "billedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NOT NULL), 0)::float8 AS "invoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NULL), 0)::float8 AS "notInvoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.payment_confirmed_at IS NOT NULL), 0)::float8 AS "paidAmount"
     FROM service_job_cards j ${clause}
     GROUP BY 1 ORDER BY "billedAmount" DESC, 1`,
    values,
  );
  return result.rows.map((r) => ({
    billTo: r.billTo,
    jobs: num(r.jobs),
    warrantyAmount: num(r.warrantyAmount),
    nonWarrantyAmount: num(r.nonWarrantyAmount),
    billedAmount: num(r.billedAmount),
    invoicedAmount: num(r.invoicedAmount),
    notInvoicedAmount: num(r.notInvoicedAmount),
    paidAmount: num(r.paidAmount),
  }));
}

export async function costAllocation(
  client: PoolClient,
  query: BillingLedgerQuery,
): Promise<AllocationRow[]> {
  const { clause, values } = where(query);
  const result = await client.query(
    `SELECT COALESCE(NULLIF(j.brand, ''), 'Unassigned') AS brand,
            COALESCE(NULLIF(j.main_group, ''), 'Unassigned') AS "mainGroup",
            COALESCE(NULLIF(j.group_name, ''), 'Unassigned') AS "groupName",
            count(*)::int AS jobs,
            COALESCE(sum(j.service_charge), 0)::float8 AS "serviceCharge",
            COALESCE(sum(j.total_cost), 0)::float8 AS "partsCost",
            COALESCE(sum(${BILLED}), 0)::float8 AS "billedAmount"
     FROM service_job_cards j ${clause}
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    values,
  );
  return result.rows.map((r) => ({
    brand: r.brand,
    mainGroup: r.mainGroup,
    groupName: r.groupName,
    jobs: num(r.jobs),
    serviceCharge: num(r.serviceCharge),
    partsCost: num(r.partsCost),
    billedAmount: num(r.billedAmount),
  }));
}

// Channels that currently appear as a bill-to party, for the filter.
export async function billToParties(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ party: string }>(
    `SELECT DISTINCT ${BILL_TO} AS party FROM service_job_cards j
     WHERE ${BILLED} > 0 AND j.job_final_status <> 'Cancelled' AND j.payment_by IS DISTINCT FROM 'Customer'
     ORDER BY 1`,
  );
  return result.rows.map((r) => r.party);
}
