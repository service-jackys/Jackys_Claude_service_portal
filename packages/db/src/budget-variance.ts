import type { PoolClient } from 'pg';

export type RevenueStream = {
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
};

export type StreamMapping = {
  id: string;
  sourceKind: string;
  matchValue: string;
  streamCode: string;
  notes: string | null;
};

export type BudgetVersion = {
  id: string;
  name: string;
  kind: string;
  fiscalYear: number;
  status: string;
  isActive: boolean;
  phasing: number[];
  notes: string | null;
  approvedAt: Date | null;
  createdAt: Date;
};

export type VersionStream = {
  streamCode: string;
  annualRevenue: string;
  annualVolume: string;
  vatInclusive: boolean;
};

const versionColumns = `
  id, name, kind, fiscal_year AS "fiscalYear", status, is_active AS "isActive", phasing, notes,
  approved_at AS "approvedAt", created_at AS "createdAt"
`;

export async function listStreams(client: PoolClient) {
  const result = await client.query<RevenueStream>(
    `SELECT code, name, sort_order AS "sortOrder", is_active AS "isActive", notes
     FROM revenue_streams ORDER BY sort_order, code`,
  );
  return result.rows;
}

export async function listMappings(client: PoolClient) {
  const result = await client.query<StreamMapping>(
    `SELECT id, source_kind AS "sourceKind", match_value AS "matchValue",
            stream_code AS "streamCode", notes
     FROM stream_mappings ORDER BY source_kind, match_value`,
  );
  return result.rows;
}

export async function getSettings(client: PoolClient) {
  const result = await client.query<{ key: string; value: unknown; description: string | null }>(
    `SELECT key, value, description FROM revenue_settings ORDER BY key`,
  );
  return result.rows;
}

export async function settingsMap(client: PoolClient) {
  const rows = await getSettings(client);
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function listVersions(client: PoolClient) {
  const result = await client.query<BudgetVersion>(
    `SELECT ${versionColumns} FROM budget_versions ORDER BY fiscal_year DESC, id DESC`,
  );
  return result.rows;
}

export async function getVersion(client: PoolClient, id: string) {
  const result = await client.query<BudgetVersion>(
    `SELECT ${versionColumns} FROM budget_versions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function activeVersion(client: PoolClient, fiscalYear?: number) {
  const result = await client.query<BudgetVersion>(
    `SELECT ${versionColumns} FROM budget_versions
     WHERE is_active ${fiscalYear ? 'AND fiscal_year = $1' : ''}
     ORDER BY fiscal_year DESC LIMIT 1`,
    fiscalYear ? [fiscalYear] : [],
  );
  return result.rows[0] ?? null;
}

export async function versionStreams(client: PoolClient, versionId: string) {
  const result = await client.query<VersionStream>(
    `SELECT stream_code AS "streamCode", annual_revenue AS "annualRevenue",
            annual_volume AS "annualVolume", vat_inclusive AS "vatInclusive"
     FROM budget_version_streams WHERE version_id = $1`,
    [versionId],
  );
  return result.rows;
}

export async function insertVersion(
  client: PoolClient,
  input: {
    name: string;
    kind: string;
    fiscalYear: number;
    phasing: number[];
    notes: string | null;
    createdBy: string;
  },
) {
  const result = await client.query<BudgetVersion>(
    `INSERT INTO budget_versions (name, kind, fiscal_year, phasing, notes, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING ${versionColumns}`,
    [
      input.name,
      input.kind,
      input.fiscalYear,
      JSON.stringify(input.phasing),
      input.notes,
      input.createdBy,
    ],
  );
  return result.rows[0]!;
}

export async function copyVersionStreams(client: PoolClient, fromId: string, toId: string) {
  await client.query(
    `INSERT INTO budget_version_streams (version_id, stream_code, annual_revenue, annual_volume, vat_inclusive)
     SELECT $2, stream_code, annual_revenue, annual_volume, vat_inclusive
     FROM budget_version_streams WHERE version_id = $1`,
    [fromId, toId],
  );
}

export async function upsertVersionStream(
  client: PoolClient,
  versionId: string,
  s: { streamCode: string; annualRevenue: number; annualVolume: number; vatInclusive: boolean },
) {
  await client.query(
    `INSERT INTO budget_version_streams (version_id, stream_code, annual_revenue, annual_volume, vat_inclusive)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (version_id, stream_code) DO UPDATE
       SET annual_revenue = EXCLUDED.annual_revenue,
           annual_volume = EXCLUDED.annual_volume,
           vat_inclusive = EXCLUDED.vat_inclusive`,
    [versionId, s.streamCode, s.annualRevenue, s.annualVolume, s.vatInclusive],
  );
}

export async function updateVersionFields(
  client: PoolClient,
  id: string,
  f: { name?: string; notes?: string | null; phasing?: number[]; status?: string },
  profileId: string,
) {
  await client.query(
    `UPDATE budget_versions SET
       name = COALESCE($2, name),
       notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
       phasing = COALESCE($5::jsonb, phasing),
       status = COALESCE($6, status),
       approved_by = CASE WHEN $6 = 'approved' THEN $7::bigint ELSE approved_by END,
       approved_at = CASE WHEN $6 = 'approved' THEN now() ELSE approved_at END,
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      f.name ?? null,
      f.notes !== undefined,
      f.notes ?? null,
      f.phasing ? JSON.stringify(f.phasing) : null,
      f.status ?? null,
      profileId,
    ],
  );
}

export async function makeVersionActive(client: PoolClient, id: string, fiscalYear: number) {
  await client.query(`UPDATE budget_versions SET is_active = false WHERE fiscal_year = $1`, [
    fiscalYear,
  ]);
  await client.query(
    `UPDATE budget_versions SET is_active = true, updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function upsertStream(
  client: PoolClient,
  s: { code: string; name: string; sortOrder: number; isActive: boolean; notes: string | null },
) {
  await client.query(
    `INSERT INTO revenue_streams (code, name, sort_order, is_active, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order,
           is_active = EXCLUDED.is_active, notes = EXCLUDED.notes`,
    [s.code, s.name, s.sortOrder, s.isActive, s.notes],
  );
}

export async function replaceMappings(
  client: PoolClient,
  rows: { sourceKind: string; matchValue: string; streamCode: string; notes: string | null }[],
) {
  await client.query(`DELETE FROM stream_mappings`);
  for (const r of rows) {
    await client.query(
      `INSERT INTO stream_mappings (source_kind, match_value, stream_code, notes)
       VALUES ($1, $2, $3, $4)`,
      [r.sourceKind, r.matchValue, r.streamCode, r.notes],
    );
  }
}

export async function setSetting(
  client: PoolClient,
  key: string,
  value: unknown,
  profileId: string,
) {
  await client.query(
    `UPDATE revenue_settings SET value = $2::jsonb, updated_at = now(), updated_by = $3 WHERE key = $1`,
    [key, JSON.stringify(value), profileId],
  );
}

export type ActualRow = {
  kind: string;
  matchValue: string;
  period: string;
  revenue: string;
  qty: string;
};

/**
 * Actual revenue grouped by source, matching value and calendar month, from
 * (a) the active master-workbook upload and (b) records issued in the portal
 * that carry a sold price (VAS, rate card, Thomson). AMC contracts are not
 * included yet: the saved contract keeps the appliance schedule value and three
 * plan prices but not which plan was sold (see modification #11).
 * Mapping to streams is done by the caller so mappings stay plain data.
 */
export async function actualRevenue(
  client: PoolClient,
  revenueBatchId: string | null,
  fromDate: string,
  toDate: string,
  options: { portalJobCards?: boolean } = {},
) {
  const rows: ActualRow[] = [];
  if (revenueBatchId) {
    const r = await client.query<ActualRow>(
      `SELECT 'excel_job_type' AS kind, upper(job_type) AS "matchValue",
              to_char(make_date(year, month_no, 1), 'YYYY-MM') AS period,
              SUM(revenue) AS revenue, SUM(qty) AS qty
       FROM revenue_lines
       WHERE batch_id = $1 AND year IS NOT NULL AND month_no BETWEEN 1 AND 12
         AND make_date(year, month_no, 1) >= $2::date AND make_date(year, month_no, 1) < $3::date
         ${options.portalJobCards ? `AND upper(job_type) NOT IN ('CSIJW', 'CSIJO')` : ''}
       GROUP BY 1, 2, 3`,
      [revenueBatchId, fromDate, toDate],
    );
    rows.push(...r.rows);
  }
  const day = (col: string, created = 'created_at') =>
    `COALESCE(${col}, timezone('Asia/Dubai', ${created})::date)`;
  const portal = await client.query<ActualRow>(
    `SELECT kind, '*' AS "matchValue", to_char(d, 'YYYY-MM') AS period,
            SUM(amount) AS revenue, SUM(qty) AS qty
     FROM (
       SELECT 'portal_vas' AS kind, ${day('sale_date')} AS d, plan_fee AS amount, 1 AS qty FROM vas_sales
       UNION ALL
       SELECT 'portal_rate_card', ${day('sale_date')}, total_value, 1 FROM rate_card_sales
       UNION ALL
       SELECT 'portal_thomson', ${day('sale_date')}, total_price, 1 FROM thomson_sales
       UNION ALL
       -- AMC: counted at the contract start month (commencement date), ex-VAT,
       -- using the price of the plan that was sold.
       SELECT 'portal_amc', COALESCE(commencement_date, sold_date), sold_price_excl_vat, 1
       FROM amc_contracts WHERE status = 'Sold'
       ${
         options.portalJobCards
           ? `UNION ALL
       -- Job cards: billed amount (ex-VAT) when invoiced or delivered, on the invoice date.
       SELECT CASE billing_job_type WHEN 'CSIJW' THEN 'portal_job_csijw' ELSE 'portal_job_csijo' END,
              COALESCE(invoice_date, delivery_date, job_card_date,
                       timezone('Asia/Dubai', created_at)::date),
              COALESCE(amount_chargeable, grand_total), 1
       FROM service_job_cards
       WHERE COALESCE(amount_chargeable, grand_total) > 0
         AND job_final_status <> 'Cancelled'
         AND billing_job_type IN ('CSIJW', 'CSIJO')
         AND (invoice_no IS NOT NULL OR job_final_status = 'Delivered')`
           : ''
       }
     ) x
     WHERE d >= $1::date AND d < $2::date
     GROUP BY 1, 3`,
    [fromDate, toDate],
  );
  rows.push(...portal.rows);
  return rows;
}

/** Job types in the active upload that no mapping covers, with revenue at stake. */
export async function jobTypeTotals(client: PoolClient, revenueBatchId: string) {
  const r = await client.query<{ jobType: string; revenue: string; lines: string }>(
    `SELECT upper(job_type) AS "jobType", SUM(revenue) AS revenue, COUNT(*) AS lines
     FROM revenue_lines WHERE batch_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
    [revenueBatchId],
  );
  return r.rows;
}
