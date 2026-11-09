import type { Pool, PoolClient } from 'pg';

// Ask AI beyond the screen for the operational sections (modification #232+):
// counts and statuses only, built by the API from the database. Never names,
// contact details, addresses or free text.
const NUMERIC_KEYS = new Set(['n', 'value', 'csidi', 'csido', 'csiii']);
type Rows = Record<string, unknown>[];

async function counts(client: PoolClient, sql: string): Promise<Rows> {
  const result = await client.query(sql);
  return result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row))
      out[key] = NUMERIC_KEYS.has(key) ? Number(value) : value;
    return out;
  });
}

async function complaints(client: PoolClient) {
  const open = "status NOT IN ('Closed', 'Cancelled')";
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM complaints'))[0]?.n ?? 0,
    byStatus: await counts(
      client,
      `SELECT status, count(*) AS n FROM complaints GROUP BY 1 ORDER BY n DESC`,
    ),
    openByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - submitted_at < interval '3 days' THEN '0-2 days'
                WHEN now() - submitted_at < interval '8 days' THEN '3-7 days'
                WHEN now() - submitted_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM complaints WHERE ${open} GROUP BY 1 ORDER BY min(submitted_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(submitted_at, 'YYYY-MM') AS month, count(*) AS n FROM complaints
       WHERE submitted_at >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT customer_type AS type, count(*) AS n FROM complaints GROUP BY 1 ORDER BY n DESC`,
    ),
    byRegion: await counts(
      client,
      `SELECT COALESCE(NULLIF(region, ''), 'Not stated') AS region, count(*) AS n
       FROM complaints GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byBrand: await counts(
      client,
      `SELECT COALESCE(NULLIF(brand, ''), 'Not stated') AS brand, count(*) AS n
       FROM complaints GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byWarranty: await counts(
      client,
      `SELECT COALESCE(NULLIF(warranty_classification, ''), 'Not stated') AS warranty, count(*) AS n
       FROM complaints GROUP BY 1 ORDER BY n DESC`,
    ),
  };
}

async function appointments(client: PoolClient) {
  const open = "status IN ('Scheduled', 'In Progress')";
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM appointments'))[0]?.n ?? 0,
    byStatus: await counts(
      client,
      `SELECT status, count(*) AS n FROM appointments GROUP BY 1 ORDER BY n DESC`,
    ),
    openByDueDate: await counts(
      client,
      `SELECT CASE
                WHEN appointment_date < current_date THEN 'Overdue'
                WHEN appointment_date = current_date THEN 'Today'
                WHEN appointment_date <= current_date + 7 THEN 'Next 7 days'
                ELSE 'Later' END AS due, count(*) AS n
       FROM appointments WHERE ${open} GROUP BY 1 ORDER BY min(appointment_date)`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(appointment_date, 'YYYY-MM') AS month, count(*) AS n FROM appointments
       WHERE appointment_date >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT customer_type AS type, count(*) AS n FROM appointments GROUP BY 1 ORDER BY n DESC`,
    ),
    byRegion: await counts(
      client,
      `SELECT COALESCE(NULLIF(region, ''), 'Not stated') AS region, count(*) AS n
       FROM appointments GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byBrand: await counts(
      client,
      `SELECT COALESCE(NULLIF(brand, ''), 'Not stated') AS brand, count(*) AS n
       FROM appointments GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byWarranty: await counts(
      client,
      `SELECT COALESCE(NULLIF(job_warranty, ''), 'Not stated') AS warranty, count(*) AS n
       FROM appointments GROUP BY 1 ORDER BY n DESC`,
    ),
    openWithoutTechnician:
      (
        await counts(
          client,
          `SELECT count(*) AS n FROM appointments WHERE ${open} AND technician_id IS NULL`,
        )
      )[0]?.n ?? 0,
  };
}

async function jobCards(client: PoolClient) {
  const open = "job_final_status NOT IN ('Cancelled', 'Rejected', 'BER') AND final_status IS NULL";
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM service_job_cards'))[0]?.n ?? 0,
    byJobStatus: await counts(
      client,
      `SELECT job_final_status AS status, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
    byFinalStatus: await counts(
      client,
      `SELECT ${blank('final_status', 'finalStatus')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
    byClosureApproval: await counts(
      client,
      `SELECT ${blank('closure_approval_status', 'closureApproval')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
    openByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - created_at < interval '3 days' THEN '0-2 days'
                WHEN now() - created_at < interval '8 days' THEN '3-7 days'
                WHEN now() - created_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM service_job_cards WHERE ${open} GROUP BY 1 ORDER BY min(created_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(created_at, 'YYYY-MM') AS month, count(*) AS n FROM service_job_cards
       WHERE created_at >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT ${blank('customer_type', 'type')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
    byRegion: await counts(
      client,
      `SELECT ${blank('region', 'region')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byBrand: await counts(
      client,
      `SELECT ${blank('brand', 'brand')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byWarranty: await counts(
      client,
      `SELECT ${blank('COALESCE(final_warranty_status, warranty_status)', 'warranty')}, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
    bySource: await counts(
      client,
      `SELECT source_type AS source, count(*) AS n FROM service_job_cards GROUP BY 1 ORDER BY n DESC`,
    ),
  };
}

async function quotations(client: PoolClient) {
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM quotations'))[0]?.n ?? 0,
    byStatus: await counts(
      client,
      `SELECT quotation_status AS status, count(*) AS n FROM quotations GROUP BY 1 ORDER BY n DESC`,
    ),
    byErpStatus: await counts(
      client,
      `SELECT ${blank('erp_status', 'erp')}, count(*) AS n FROM quotations GROUP BY 1 ORDER BY n DESC`,
    ),
    pendingByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - created_at < interval '3 days' THEN '0-2 days'
                WHEN now() - created_at < interval '8 days' THEN '3-7 days'
                WHEN now() - created_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM quotations WHERE quotation_status = 'Pending' GROUP BY 1 ORDER BY min(created_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(quotation_date, 'YYYY-MM') AS month, count(*) AS n,
              round(COALESCE(sum(grand_total), 0)) AS value
       FROM quotations
       WHERE quotation_date >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT ${blank('customer_type', 'type')}, count(*) AS n FROM quotations GROUP BY 1 ORDER BY n DESC`,
    ),
    byWarranty: await counts(
      client,
      `SELECT ${blank('warranty_status', 'warranty')}, count(*) AS n FROM quotations GROUP BY 1 ORDER BY n DESC`,
    ),
    valueByStatus: await counts(
      client,
      `SELECT quotation_status AS status, round(COALESCE(sum(grand_total), 0)) AS value, count(*) AS n
       FROM quotations GROUP BY 1 ORDER BY value DESC`,
    ),
  };
}

async function inspections(client: PoolClient) {
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM inspections'))[0]?.n ?? 0,
    reviewState: await counts(
      client,
      `SELECT CASE WHEN reviewed_by IS NULL OR reviewed_by = '' THEN 'Not reviewed' ELSE 'Reviewed' END AS review, count(*) AS n
       FROM inspections GROUP BY 1 ORDER BY n DESC`,
    ),
    withOrWithoutQuotation: await counts(
      client,
      `SELECT CASE WHEN ref_quotation_no IS NULL OR ref_quotation_no = '' THEN 'No quotation yet' ELSE 'Quotation referenced' END AS quotation, count(*) AS n
       FROM inspections GROUP BY 1 ORDER BY n DESC`,
    ),
    unreviewedByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - created_at < interval '3 days' THEN '0-2 days'
                WHEN now() - created_at < interval '8 days' THEN '3-7 days'
                WHEN now() - created_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM inspections WHERE reviewed_by IS NULL OR reviewed_by = ''
       GROUP BY 1 ORDER BY min(created_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(inspection_date, 'YYYY-MM') AS month, count(*) AS n,
              round(COALESCE(sum(est_repair_cost), 0)) AS value
       FROM inspections
       WHERE inspection_date >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT ${blank('customer_type', 'type')}, count(*) AS n FROM inspections GROUP BY 1 ORDER BY n DESC`,
    ),
    byWarranty: await counts(
      client,
      `SELECT ${blank('warranty_status', 'warranty')}, count(*) AS n FROM inspections GROUP BY 1 ORDER BY n DESC`,
    ),
  };
}

async function warrantyApprovals(client: PoolClient) {
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM warranty_approvals'))[0]?.n ?? 0,
    byStatus: await counts(
      client,
      `SELECT status, count(*) AS n, round(COALESCE(sum(estimated_cost), 0)) AS value
       FROM warranty_approvals GROUP BY 1 ORDER BY n DESC`,
    ),
    pendingByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - created_at < interval '3 days' THEN '0-2 days'
                WHEN now() - created_at < interval '8 days' THEN '3-7 days'
                WHEN now() - created_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM warranty_approvals WHERE status = 'Pending' GROUP BY 1 ORDER BY min(created_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(created_at, 'YYYY-MM') AS month, count(*) AS n,
              round(COALESCE(sum(estimated_cost), 0)) AS value
       FROM warranty_approvals
       WHERE created_at >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    bySource: await counts(
      client,
      `SELECT CASE WHEN job_card_id IS NOT NULL THEN 'Job card'
                   WHEN inspection_id IS NOT NULL THEN 'Inspection'
                   ELSE 'Quotation' END AS source, count(*) AS n
       FROM warranty_approvals GROUP BY 1 ORDER BY n DESC`,
    ),
    byWarranty: await counts(
      client,
      `SELECT ${blank('warranty_status', 'warranty')}, count(*) AS n FROM warranty_approvals GROUP BY 1 ORDER BY n DESC`,
    ),
    byDecisionMethod: await counts(
      client,
      `SELECT ${blank('decision_method', 'method')}, count(*) AS n
       FROM warranty_approvals WHERE status <> 'Pending' GROUP BY 1 ORDER BY n DESC`,
    ),
  };
}

async function deliveryInstall(client: PoolClient) {
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  return {
    total: (await counts(client, 'SELECT count(*) AS n FROM di_jobs'))[0]?.n ?? 0,
    byStatus: await counts(
      client,
      `SELECT status, count(*) AS n, round(COALESCE(sum(total_revenue), 0)) AS value
       FROM di_jobs GROUP BY 1 ORDER BY n DESC`,
    ),
    draftsByAge: await counts(
      client,
      `SELECT CASE
                WHEN now() - created_at < interval '3 days' THEN '0-2 days'
                WHEN now() - created_at < interval '8 days' THEN '3-7 days'
                WHEN now() - created_at < interval '15 days' THEN '8-14 days'
                ELSE '15+ days' END AS age, count(*) AS n
       FROM di_jobs WHERE status = 'Draft' GROUP BY 1 ORDER BY min(created_at) DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(service_date, 'YYYY-MM') AS month, count(*) AS n,
              round(COALESCE(sum(total_csidi), 0)) AS csidi,
              round(COALESCE(sum(total_csido), 0)) AS csido,
              round(COALESCE(sum(total_csiii), 0)) AS csiii,
              round(COALESCE(sum(total_revenue), 0)) AS value
       FROM di_jobs
       WHERE status = 'Completed'
         AND service_date >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byRegion: await counts(
      client,
      `SELECT ${blank('region', 'region')}, count(*) AS n FROM di_jobs GROUP BY 1 ORDER BY n DESC`,
    ),
    bySalesChannel: await counts(
      client,
      `SELECT ${blank('sales_channel', 'channel')}, count(*) AS n, round(COALESCE(sum(total_revenue), 0)) AS value
       FROM di_jobs WHERE status = 'Completed' GROUP BY 1 ORDER BY value DESC LIMIT 15`,
    ),
  };
}

async function walkIn(client: PoolClient) {
  const blank = (col: string, alias: string) =>
    `COALESCE(NULLIF(${col}, ''), 'Not stated') AS ${alias}`;
  const w = "source_type = 'Walk-in'";
  return {
    total:
      (await counts(client, `SELECT count(*) AS n FROM service_job_cards WHERE ${w}`))[0]?.n ?? 0,
    today:
      (
        await counts(
          client,
          `SELECT count(*) AS n FROM service_job_cards WHERE ${w} AND created_at::date = current_date`,
        )
      )[0]?.n ?? 0,
    byJobStatus: await counts(
      client,
      `SELECT job_final_status AS status, count(*) AS n FROM service_job_cards WHERE ${w} GROUP BY 1 ORDER BY n DESC`,
    ),
    byMonth: await counts(
      client,
      `SELECT to_char(created_at, 'YYYY-MM') AS month, count(*) AS n FROM service_job_cards
       WHERE ${w} AND created_at >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
    ),
    byCustomerType: await counts(
      client,
      `SELECT ${blank('customer_type', 'type')}, count(*) AS n FROM service_job_cards WHERE ${w} GROUP BY 1 ORDER BY n DESC`,
    ),
    byWarranty: await counts(
      client,
      `SELECT ${blank('COALESCE(final_warranty_status, warranty_status)', 'warranty')}, count(*) AS n FROM service_job_cards WHERE ${w} GROUP BY 1 ORDER BY n DESC`,
    ),
    byBrand: await counts(
      client,
      `SELECT ${blank('brand', 'brand')}, count(*) AS n FROM service_job_cards WHERE ${w} GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
    byRegion: await counts(
      client,
      `SELECT ${blank('region', 'region')}, count(*) AS n FROM service_job_cards WHERE ${w} GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    ),
  };
}

export const OPS_SECTIONS: Record<
  string,
  { read: string; build: (c: PoolClient) => Promise<unknown> }
> = {
  walk_in: { read: 'service_job_card.read', build: walkIn },
  delivery_install: { read: 'di_jobs.read', build: deliveryInstall },
  complaints: { read: 'complaints.read', build: complaints },
  appointments: { read: 'appointments.read', build: appointments },
  job_cards: { read: 'service_job_card.read', build: jobCards },
  quotations: { read: 'quotation.read', build: quotations },
  inspections: { read: 'inspection.read', build: inspections },
  warranty_approvals: { read: 'warranty_approval.read', build: warrantyApprovals },
};

export async function buildOpsSnapshot(pool: Pool, section: string) {
  const entry = OPS_SECTIONS[section];
  if (!entry) return null;
  const client = await pool.connect();
  try {
    return await entry.build(client);
  } finally {
    client.release();
  }
}
