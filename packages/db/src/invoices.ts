import type { PoolClient } from 'pg';

// Jobs that carry an amount, for the Invoices tab, the Out-of-warranty
// dashboard section and finance follow-up. "Amount" is the chargeable amount
// when set, otherwise service charge plus parts (same rule as the delivery
// gate in apps/api/src/job-cards/billing.ts).
const AMOUNT = 'COALESCE(service_job_cards.amount_chargeable, service_job_cards.grand_total)';

export type JobInvoiceRecord = {
  id: string;
  jobCardReference: string;
  jobCardDate: string | null;
  customerName: string | null;
  customerType: string | null;
  billingJobType: string | null;
  warrantyStatus: string | null;
  finalWarrantyStatus: string | null;
  paymentBy: string | null;
  billToChannel: string | null;
  salesChannel: string | null;
  amount: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  paymentMode: string | null;
  paymentReference: string | null;
  paymentConfirmedAt: Date | null;
  jobFinalStatus: string;
  deliveryDate: string | null;
};

export type JobInvoiceQuery = {
  type?: string;
  paymentBy?: string;
  // Paid | Awaiting invoice | Awaiting payment | Channel | Unassigned
  paymentStatus?: string;
  search?: string;
  page: number;
  pageSize: number;
};

// Where a job is in the money flow.
const PAYMENT_STATUS = `CASE
  WHEN service_job_cards.payment_by = 'Customer' AND service_job_cards.payment_confirmed_at IS NOT NULL THEN 'Paid'
  WHEN service_job_cards.payment_by = 'Customer' AND service_job_cards.invoice_no IS NULL THEN 'Awaiting invoice'
  WHEN service_job_cards.payment_by = 'Customer' THEN 'Awaiting payment'
  WHEN service_job_cards.payment_by = 'Sales channel' THEN 'Channel'
  ELSE 'Unassigned' END`;

function filters(query: Pick<JobInvoiceQuery, 'type' | 'paymentBy' | 'paymentStatus' | 'search'>) {
  const where = [`${AMOUNT} > 0`, `service_job_cards.job_final_status <> 'Cancelled'`];
  const values: unknown[] = [];
  if (query.type) {
    values.push(query.type);
    where.push(`service_job_cards.billing_job_type = $${values.length}`);
  }
  if (query.paymentBy) {
    values.push(query.paymentBy);
    where.push(`service_job_cards.payment_by = $${values.length}`);
  }
  if (query.paymentStatus) {
    values.push(query.paymentStatus);
    where.push(`${PAYMENT_STATUS} = $${values.length}`);
  }
  if (query.search) {
    values.push(`%${query.search}%`);
    const n = values.length;
    where.push(`(service_job_cards.job_card_reference ILIKE $${n}
      OR service_job_cards.customer_name ILIKE $${n}
      OR service_job_cards.invoice_no ILIKE $${n}
      OR service_job_cards.bill_to_channel ILIKE $${n})`);
  }
  return { clause: `WHERE ${where.join(' AND ')}`, values };
}

export async function listJobInvoices(
  client: PoolClient,
  query: JobInvoiceQuery,
): Promise<{ items: (JobInvoiceRecord & { paymentStatus: string })[]; total: number }> {
  const { clause, values } = filters(query);
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM service_job_cards ${clause}`,
    values,
  );
  const limit = Math.min(Math.max(query.pageSize, 1), 200);
  const offset = (Math.max(query.page, 1) - 1) * limit;
  const result = await client.query<JobInvoiceRecord & { paymentStatus: string }>(
    `SELECT service_job_cards.id,
            service_job_cards.job_card_reference AS "jobCardReference",
            service_job_cards.job_card_date::text AS "jobCardDate",
            service_job_cards.customer_name AS "customerName",
            service_job_cards.customer_type AS "customerType",
            service_job_cards.billing_job_type AS "billingJobType",
            service_job_cards.warranty_status AS "warrantyStatus",
            service_job_cards.final_warranty_status AS "finalWarrantyStatus",
            service_job_cards.payment_by AS "paymentBy",
            service_job_cards.bill_to_channel AS "billToChannel",
            service_job_cards.sales_channel AS "salesChannel",
            ${AMOUNT} AS amount,
            service_job_cards.invoice_no AS "invoiceNo",
            service_job_cards.invoice_date::text AS "invoiceDate",
            service_job_cards.payment_mode AS "paymentMode",
            service_job_cards.payment_reference AS "paymentReference",
            service_job_cards.payment_confirmed_at AS "paymentConfirmedAt",
            service_job_cards.job_final_status AS "jobFinalStatus",
            service_job_cards.delivery_date::text AS "deliveryDate",
            ${PAYMENT_STATUS} AS "paymentStatus"
     FROM service_job_cards
     ${clause}
     ORDER BY service_job_cards.job_card_date DESC NULLS LAST, service_job_cards.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export type InvoiceSummary = {
  byType: { billingJobType: string; jobs: number; amount: number }[];
  byPaymentStatus: { paymentStatus: string; jobs: number; amount: number }[];
  // Out-of-warranty (CSIJO) jobs still waiting to be delivered, by money stage.
  outOfWarrantyPendingDelivery: { stage: string; jobs: number; amount: number }[];
};

export async function invoiceSummary(client: PoolClient): Promise<InvoiceSummary> {
  const base = `FROM service_job_cards WHERE ${AMOUNT} > 0 AND service_job_cards.job_final_status <> 'Cancelled'`;
  const byType = await client.query<{ billingJobType: string; jobs: number; amount: string }>(
    `SELECT COALESCE(billing_job_type, 'Unclassified') AS "billingJobType",
            count(*)::int AS jobs, COALESCE(sum(${AMOUNT}), 0)::text AS amount
     ${base} GROUP BY 1 ORDER BY 1`,
  );
  const byStatus = await client.query<{ paymentStatus: string; jobs: number; amount: string }>(
    `SELECT ${PAYMENT_STATUS} AS "paymentStatus",
            count(*)::int AS jobs, COALESCE(sum(${AMOUNT}), 0)::text AS amount
     ${base} GROUP BY 1 ORDER BY 1`,
  );
  const pending = await client.query<{ stage: string; jobs: number; amount: string }>(
    `SELECT CASE
              WHEN payment_by = 'Customer' AND payment_confirmed_at IS NOT NULL THEN 'Paid, pending delivery'
              WHEN payment_by = 'Customer' AND invoice_no IS NULL THEN 'Awaiting invoice'
              WHEN payment_by = 'Customer' THEN 'Awaiting payment'
              WHEN payment_by = 'Sales channel' THEN 'Billed to channel, pending delivery'
              ELSE 'Payer not chosen' END AS stage,
            count(*)::int AS jobs, COALESCE(sum(${AMOUNT}), 0)::text AS amount
     ${base}
       AND billing_job_type = 'CSIJO'
       AND job_final_status <> 'Delivered'
     GROUP BY 1 ORDER BY 1`,
  );
  const num = (rows: { amount: string }[]) => rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  return {
    byType: num(byType.rows) as InvoiceSummary['byType'],
    byPaymentStatus: num(byStatus.rows) as InvoiceSummary['byPaymentStatus'],
    outOfWarrantyPendingDelivery: num(
      pending.rows,
    ) as InvoiceSummary['outOfWarrantyPendingDelivery'],
  };
}
