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

export const OPS_SECTIONS: Record<
  string,
  { read: string; build: (c: PoolClient) => Promise<unknown> }
> = {
  complaints: { read: 'complaints.read', build: complaints },
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
