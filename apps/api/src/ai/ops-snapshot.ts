import type { Pool, PoolClient } from 'pg';

// Ask AI beyond the screen for the operational sections (modification #232+):
// counts and statuses only, built by the API from the database. Never names,
// contact details, addresses or free text.
type Rows = Record<string, unknown>[];

async function counts(client: PoolClient, sql: string): Promise<Rows> {
  const result = await client.query(sql);
  return result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = key === 'n' ? Number(value) : value;
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

export const OPS_SECTIONS: Record<
  string,
  { read: string; build: (c: PoolClient) => Promise<unknown> }
> = {
  complaints: { read: 'complaints.read', build: complaints },
  appointments: { read: 'appointments.read', build: appointments },
  job_cards: { read: 'service_job_card.read', build: jobCards },
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
