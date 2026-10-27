import type { PoolClient } from 'pg';

// Accounts view of billed jobs: a ledger of every job that carries an amount,
// a statement per bill-to party, and an allocation by brand / product group
// for ERP cost allocation. "Billed amount" is the chargeable amount when set,
// otherwise service charge plus parts (the same rule as the delivery gate).
const BILLED = 'COALESCE(j.amount_chargeable, j.grand_total)';

// Two sources feed the ledger, both read as "j":
//  - service job cards (warranty and service jobs), and
//  - Completed Delivery & Installation jobs, one row per line (item) with the
//    revenue saved when the job was completed. They are billed to the line's
//    sales channel as internal billing, so accounts have one report. Draft and
//    Cancelled jobs are not in it, and a reopened job drops out until it is
//    completed again. The Warranty columns carry the activity type (CSIDI, CSIDO,
//    CSIII), the same as the Type column, since warranty does not apply.
const SOURCE = `(
  SELECT s.id::text AS id, s.id AS sort_id, 'job-card'::text AS source, s.id::text AS source_ref,
         s.job_card_reference, s.job_card_date, s.delivery_date, s.billing_job_type,
         s.warranty_status, s.final_warranty_status, s.warranty_override_reason,
         s.payment_by, s.bill_to_channel, s.customer_name, s.customer_type,
         s.b2b_branch_school, s.salesman, s.sales_channel, s.region, s.sales_order_number,
         s.item_code, s.brand, s.main_group, s.group_name, s.sub_group, s.model_no,
         s.serial_no, s.technician_name, s.service_charge, s.total_cost, s.grand_total,
         s.amount_chargeable, s.invoice_no, s.invoice_date, s.payment_mode,
         s.payment_reference, s.payment_confirmed_at, s.final_status, s.job_final_status,
         s.created_at, NULL::text AS other_types, NULL::numeric AS job_total
    FROM service_job_cards s
  UNION ALL
  SELECT 'di:' || l.id, l.id, 'dandi', d.id::text,
         d.reference, d.service_date, d.service_date, l.txn_type,
         l.txn_type, l.txn_type, NULL::text,
         NULL::text, l.sales_channel, d.customer_name, 'B2B',
         d.customer_name, d.salesman, l.sales_channel, d.region, d.delivery_note_ref,
         l.item_code, l.brand, l.main_group, l.group_name, l.sub_group, l.item_code,
         NULL::text, NULL::text, l.revenue, 0::numeric, l.revenue,
         NULL::numeric, d.erp_inv_no, NULL::date, NULL::text,
         NULL::text, NULL::timestamptz, 'Completed', 'Completed',
         COALESCE(d.completed_at, d.created_at),
         (SELECT string_agg(DISTINCT x.txn_type, ', ' ORDER BY x.txn_type)
            FROM di_job_lines x WHERE x.job_id = d.id AND x.txn_type <> l.txn_type),
         (SELECT sum(x.revenue) FROM di_job_lines x WHERE x.job_id = d.id)
    FROM di_job_lines l JOIN di_jobs d ON d.id = l.job_id
   WHERE d.status = 'Completed'
)`;

// Anything not paid by the customer is internal billing: warranty jobs (CSIJW) and
// out-of-warranty B2B jobs billed to the sales channel (JDI, JER-C/INS). There is
// no ERP invoice to chase; accounts take the report and make the internal
// adjustments. These have their own stage and stay out of the invoiced / not-yet-
// invoiced figures. Only jobs the customer pays follow the invoice and payment flow.
const INTERNAL = `j.payment_by IS DISTINCT FROM 'Customer'`;

// Where the job is in the accounts flow. Anyone who is not the paying customer
// is billed through the sales channel, including jobs with no payer recorded.
const STAGE = `CASE
  WHEN ${INTERNAL} THEN 'Internal billing'
  WHEN j.payment_by = 'Customer' AND j.payment_confirmed_at IS NOT NULL THEN 'Paid'
  WHEN j.invoice_no IS NULL THEN 'Not invoiced'
  ELSE 'Invoiced, awaiting payment' END`;

// The party that receives the bill: the channel, or the customer when they pay.
const BILL_TO = `CASE
  WHEN j.payment_by = 'Customer' THEN COALESCE(NULLIF(j.customer_name, ''), 'Customer')
  ELSE COALESCE(NULLIF(j.bill_to_channel, ''), NULLIF(j.sales_channel, ''), 'Not set') END`;

export const BILLING_STAGES = [
  'Internal billing',
  'Not invoiced',
  'Invoiced, awaiting payment',
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
  /** 'job-card' (service job card) or 'dandi' (a Completed Delivery & Installation line). */
  source: string;
  /** The job card id, or the Delivery & Installation job id, to open it. */
  sourceRef: string;
  /** Delivery & Installation only: the other activity types on the same job, and the whole job's revenue. */
  otherTypes: string | null;
  jobTotal: number | null;
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
  // Warranty jobs billed internally (no ERP invoice); not part of the two above.
  internalAmount: number;
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
  const clauses = [`${BILLED} > 0`, `j.job_final_status IS DISTINCT FROM 'Cancelled'`];
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
    `SELECT count(*)::text AS total FROM ${SOURCE} j ${clause}`,
    values,
  );
  const limit = paging ? Math.min(Math.max(paging.pageSize, 1), 200) : 50000;
  const offset = paging ? (Math.max(paging.page, 1) - 1) * limit : 0;
  const result = await client.query(
    `SELECT j.id, j.source, j.source_ref AS "sourceRef", j.job_card_reference AS "jobCardReference",
            j.other_types AS "otherTypes", j.job_total::float8 AS "jobTotal",
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
            ${STAGE} AS stage, COALESCE(j.final_status, j.job_final_status) AS "jobFinalStatus"
     FROM ${SOURCE} j ${clause}
     ORDER BY ${BILL_TO} ASC, j.job_card_date DESC NULLS LAST, j.sort_id DESC, j.id DESC
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
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NOT NULL AND NOT (${INTERNAL})), 0)::float8 AS "invoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NULL AND NOT (${INTERNAL})), 0)::float8 AS "notInvoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE ${INTERNAL}), 0)::float8 AS "internalAmount"
     FROM ${SOURCE} j ${clause}`,
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
    internalAmount: num(row.internalAmount),
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
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NOT NULL AND NOT (${INTERNAL})), 0)::float8 AS "invoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.invoice_no IS NULL AND NOT (${INTERNAL})), 0)::float8 AS "notInvoicedAmount",
            COALESCE(sum(${BILLED}) FILTER (WHERE j.payment_confirmed_at IS NOT NULL), 0)::float8 AS "paidAmount"
     FROM ${SOURCE} j ${clause}
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
     FROM ${SOURCE} j ${clause}
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
    `SELECT DISTINCT ${BILL_TO} AS party FROM ${SOURCE} j
     WHERE ${BILLED} > 0 AND j.job_final_status IS DISTINCT FROM 'Cancelled' AND j.payment_by IS DISTINCT FROM 'Customer'
     ORDER BY 1`,
  );
  return result.rows.map((r) => r.party);
}
