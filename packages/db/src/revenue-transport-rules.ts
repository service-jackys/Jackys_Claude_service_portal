import type { PoolClient } from 'pg';

// Transport rules (2-trip daily cap) storage and revenue-line adjustment, modification #249.

export interface StoredTransportRules {
  dailyCap: boolean;
  deliveryOnlyCap: boolean;
  mixedInvoiceTransport: boolean;
  maxTrips: number;
  appliedBatchId: string | null;
  appliedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

type Q = Pick<PoolClient, 'query'>;

export async function getTransportRules(client: Q): Promise<StoredTransportRules> {
  const r = await client.query<StoredTransportRules>(
    `SELECT t.daily_cap AS "dailyCap", t.delivery_only_cap AS "deliveryOnlyCap",
            t.mixed_invoice_transport AS "mixedInvoiceTransport", t.max_trips AS "maxTrips",
            t.applied_batch_id::text AS "appliedBatchId", t.applied_at AS "appliedAt",
            t.updated_at AS "updatedAt", p.display_name AS "updatedByName"
       FROM revenue_transport_rules t LEFT JOIN profiles p ON p.id = t.updated_by
      WHERE t.id = 1`,
  );
  return (
    r.rows[0] ?? {
      dailyCap: true,
      deliveryOnlyCap: false,
      mixedInvoiceTransport: true,
      maxTrips: 2,
      appliedBatchId: null,
      appliedAt: null,
      updatedAt: new Date(0).toISOString(),
      updatedByName: null,
    }
  );
}

export async function saveTransportRules(
  client: Q,
  rules: {
    dailyCap: boolean;
    deliveryOnlyCap: boolean;
    mixedInvoiceTransport: boolean;
    maxTrips: number;
  },
  profileId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO revenue_transport_rules (id, daily_cap, delivery_only_cap, mixed_invoice_transport, max_trips, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET daily_cap = $1, delivery_only_cap = $2, mixed_invoice_transport = $3,
       max_trips = $4, updated_by = $5, updated_at = now()`,
    [rules.dailyCap, rules.deliveryOnlyCap, rules.mixedInvoiceTransport, rules.maxTrips, profileId],
  );
}

/** Delivery / installation revenue lines of a batch in workbook order, with the workbook's revenue. */
export async function listTransportLines(client: Q, batchId: string | number) {
  await client.query(
    `UPDATE revenue_lines SET workbook_revenue = revenue WHERE batch_id = $1 AND workbook_revenue IS NULL`,
    [batchId],
  );
  const r = await client.query<{
    id: string;
    invDelNo: string | null;
    jobType: string;
    workbookRevenue: string;
  }>(
    `SELECT id::text AS id, inv_del_no AS "invDelNo", job_type AS "jobType", workbook_revenue::text AS "workbookRevenue"
       FROM revenue_lines WHERE batch_id = $1 AND job_type IN ('CSIDI', 'CSIDO')
      ORDER BY source_row NULLS LAST, id`,
    [batchId],
  );
  return r.rows.map((x) => ({ ...x, workbookRevenue: Number(x.workbookRevenue) }));
}

/** Resets every line of the batch to the workbook revenue, applies the adjustments, records the run. */
export async function applyTransportRevenue(
  client: Q,
  batchId: string | number,
  updates: { id: string; revenue: number }[],
): Promise<void> {
  await client.query(
    `UPDATE revenue_lines SET revenue = workbook_revenue
      WHERE batch_id = $1 AND workbook_revenue IS NOT NULL AND revenue IS DISTINCT FROM workbook_revenue`,
    [batchId],
  );
  if (updates.length)
    await client.query(
      `UPDATE revenue_lines r SET revenue = v.revenue
         FROM (SELECT unnest($2::bigint[]) AS id, unnest($3::numeric[]) AS revenue) v
        WHERE r.id = v.id AND r.batch_id = $1`,
      [batchId, updates.map((u) => u.id), updates.map((u) => u.revenue)],
    );
  await client.query(
    `UPDATE revenue_transport_rules SET applied_batch_id = $1, applied_at = now() WHERE id = 1`,
    [batchId],
  );
}

/** Workbook vs current revenue by job type and month (YYYYMM) for a batch. */
export async function transportTotals(client: Q, batchId: string | number) {
  const r = await client.query<{
    jobType: string;
    month: number;
    workbook: string;
    current: string;
  }>(
    `SELECT job_type AS "jobType", (year * 100 + month_no)::int AS month,
            SUM(COALESCE(workbook_revenue, revenue))::text AS workbook, SUM(revenue)::text AS current
       FROM revenue_lines WHERE batch_id = $1 AND year IS NOT NULL AND month_no IS NOT NULL
      GROUP BY job_type, year, month_no`,
    [batchId],
  );
  return r.rows.map((x) => ({ ...x, workbook: Number(x.workbook), current: Number(x.current) }));
}
