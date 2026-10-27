import type { PoolClient } from 'pg';

// Reads for the Portal vs master Excel comparison (Delivery & Installation).

export type WorkbookDandiRow = {
  jobType: string;
  invDelNo: string | null;
  customer: string | null;
  salesPerson: string | null;
  salesChannel: string | null;
  orderDate: string | null;
  qty: number;
  revenue: number;
};

/** The CSIDI / CSIDO / CSIII lines of the active workbook upload for one month (YYYY-MM). */
export async function workbookDandiLines(
  client: PoolClient,
  batchId: string,
  month: string,
): Promise<WorkbookDandiRow[]> {
  const result = await client.query<WorkbookDandiRow>(
    `SELECT upper(job_type) AS "jobType", inv_del_no AS "invDelNo", customer,
            sales_person AS "salesPerson", sales_channel AS "salesChannel",
            to_char(order_date, 'YYYY-MM-DD') AS "orderDate",
            qty::float8 AS qty, revenue::float8 AS revenue
     FROM revenue_lines
     WHERE batch_id = $1 AND upper(job_type) IN ('CSIDI', 'CSIDO', 'CSIII')
       AND year IS NOT NULL AND month_no BETWEEN 1 AND 12
       AND make_date(year, month_no, 1) = ($2 || '-01')::date`,
    [batchId, month],
  );
  return result.rows;
}

export type PortalDandiJobRow = {
  id: string;
  reference: string;
  serviceDate: string;
  customerName: string | null;
  salesman: string | null;
  deliveryNoteRef: string | null;
  erpInvNo: string | null;
  channels: string[];
  csidiQty: number;
  csidiRevenue: number;
  csidoQty: number;
  csidoRevenue: number;
  csiiiQty: number;
  csiiiRevenue: number;
};

/**
 * Completed jobs dated in the month, plus any Completed job (any date) whose
 * delivery note or ERP Inv No is one the workbook month names -- so a job dated
 * a day either side of the month end still pairs up with its workbook line.
 */
export async function portalDandiJobs(
  client: PoolClient,
  month: string,
  keys: string[],
): Promise<PortalDandiJobRow[]> {
  const result = await client.query<PortalDandiJobRow>(
    `SELECT j.id, j.reference, to_char(j.service_date, 'YYYY-MM-DD') AS "serviceDate",
            j.customer_name AS "customerName", j.salesman,
            j.delivery_note_ref AS "deliveryNoteRef", j.erp_inv_no AS "erpInvNo",
            COALESCE(array_agg(DISTINCT l.sales_channel) FILTER (WHERE l.sales_channel IS NOT NULL), '{}') AS channels,
            COALESCE(sum(l.qty) FILTER (WHERE l.txn_type = 'CSIDI'), 0)::float8 AS "csidiQty",
            COALESCE(sum(l.revenue) FILTER (WHERE l.txn_type = 'CSIDI'), 0)::float8 AS "csidiRevenue",
            COALESCE(sum(l.qty) FILTER (WHERE l.txn_type = 'CSIDO'), 0)::float8 AS "csidoQty",
            COALESCE(sum(l.revenue) FILTER (WHERE l.txn_type = 'CSIDO'), 0)::float8 AS "csidoRevenue",
            COALESCE(sum(l.qty) FILTER (WHERE l.txn_type = 'CSIII'), 0)::float8 AS "csiiiQty",
            COALESCE(sum(l.revenue) FILTER (WHERE l.txn_type = 'CSIII'), 0)::float8 AS "csiiiRevenue"
     FROM di_jobs j LEFT JOIN di_job_lines l ON l.job_id = j.id
     WHERE j.status = 'Completed'
       AND (to_char(j.service_date, 'YYYY-MM') = $1
            OR upper(btrim(j.delivery_note_ref)) = ANY($2::text[])
            OR upper(btrim(j.erp_inv_no)) = ANY($2::text[]))
     GROUP BY j.id
     ORDER BY j.service_date, j.id`,
    [month, keys],
  );
  return result.rows;
}

/** Channel name -> the name the master workbook uses for it. */
export async function channelReportingNames(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ name: string; reportingName: string | null }>(
    `SELECT name, reporting_name AS "reportingName" FROM sales_channels`,
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    if (row.reportingName) map.set(row.name.trim().toLowerCase(), row.reportingName);
  }
  return map;
}
