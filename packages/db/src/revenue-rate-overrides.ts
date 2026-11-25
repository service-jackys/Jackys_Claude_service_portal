import type { PoolClient } from 'pg';

// Custom rates for the Service Revenue Dashboard (modification #290). Storage only: the maths is in
// apps/api/src/revenue-dashboard/rate-overrides.ts.

type Q = Pick<PoolClient, 'query'>;

export interface StoredRateOverrides {
  payload: unknown | null;
  lockedAt: string | null;
  appliedBatchId: string | null;
  appliedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export async function getRateOverrides(client: Q): Promise<StoredRateOverrides> {
  const r = await client.query<StoredRateOverrides>(
    `SELECT o.payload, o.locked_at AS "lockedAt", o.applied_batch_id::text AS "appliedBatchId",
            o.applied_at AS "appliedAt", o.updated_at AS "updatedAt", p.display_name AS "updatedByName"
       FROM revenue_rate_overrides o LEFT JOIN profiles p ON p.id = o.updated_by
      WHERE o.id = 1`,
  );
  return (
    r.rows[0] ?? {
      payload: null,
      lockedAt: null,
      appliedBatchId: null,
      appliedAt: null,
      updatedAt: new Date(0).toISOString(),
      updatedByName: null,
    }
  );
}

export async function saveRateOverrides(
  client: Q,
  payload: unknown | null,
  profileId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO revenue_rate_overrides (id, payload, locked_at, updated_by, updated_at)
     VALUES (1, $1::jsonb, CASE WHEN $1::jsonb IS NULL THEN NULL ELSE now() END, $2, now())
     ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb,
       locked_at = CASE WHEN $1::jsonb IS NULL THEN NULL ELSE now() END,
       updated_by = $2, updated_at = now()`,
    [payload === null ? null : JSON.stringify(payload), profileId],
  );
}

export async function markRateOverridesApplied(client: Q, batchId: string | number) {
  await client.query(
    `UPDATE revenue_rate_overrides SET applied_batch_id = $1, applied_at = now() WHERE id = 1`,
    [batchId],
  );
}

export interface RateLine {
  id: string;
  jobType: string;
  invDelNo: string | null;
  qty: number;
  unitPrice: number;
  workbookRevenue: number;
  remarks: string | null;
  billingCode: string | null;
  originalJobValue: number;
  year: number | null;
  monthNo: number | null;
  pricing: Record<string, unknown> | null;
  salesPerson?: string | null;
  customer?: string | null;
  orderDate?: string | null;
}

/** Every revenue line of a batch with the fields needed to re-price it, in workbook order. */
export async function listRateLines(client: Q, batchId: string | number): Promise<RateLine[]> {
  await client.query(
    `UPDATE revenue_lines SET workbook_revenue = revenue WHERE batch_id = $1 AND workbook_revenue IS NULL`,
    [batchId],
  );
  const r = await client.query(
    `SELECT id::text AS id, job_type AS "jobType", inv_del_no AS "invDelNo", qty::float8 AS qty,
            unit_price::float8 AS "unitPrice", workbook_revenue::float8 AS "workbookRevenue",
            remarks, billing_code AS "billingCode", original_job_value::float8 AS "originalJobValue",
            year, month_no AS "monthNo", pricing,
            sales_person AS "salesPerson", customer, order_date::text AS "orderDate"
       FROM revenue_lines WHERE batch_id = $1 ORDER BY source_row NULLS LAST, id`,
    [batchId],
  );
  return r.rows as RateLine[];
}

export async function batchSummary(client: Q, batchId: string | number) {
  const r = await client.query<{ summary: Record<string, unknown> }>(
    `SELECT summary FROM revenue_import_batches WHERE id = $1`,
    [batchId],
  );
  return r.rows[0]?.summary ?? {};
}

// New fridge logic settings (modification #306). One row; see migration 109.
export interface StoredFridgeLogic {
  enabled: boolean;
  smallBase: number;
  smallOver10: number;
  smallMinimum: number;
  optionB: boolean;
  plugAmount: number;
  /** Installation-only discount tiers: 'invoice' = invoice total (portal rule), 'line' = each line (workbook). */
  installTierBasis: 'invoice' | 'line';
  updatedAt: string | null;
  updatedByName: string | null;
}

export async function getFridgeLogic(client: Q): Promise<StoredFridgeLogic> {
  const r = await client.query<StoredFridgeLogic>(
    `SELECT f.enabled, f.small_base::float8 AS "smallBase", f.small_over10::float8 AS "smallOver10",
            f.small_minimum::float8 AS "smallMinimum", f.option_b AS "optionB",
            f.plug_amount::float8 AS "plugAmount", f.install_tier_basis AS "installTierBasis", f.updated_at AS "updatedAt",
            p.display_name AS "updatedByName"
       FROM revenue_fridge_logic f LEFT JOIN profiles p ON p.id = f.updated_by WHERE f.id = 1`,
  );
  return (
    r.rows[0] ?? {
      enabled: true,
      smallBase: 30,
      smallOver10: 20,
      smallMinimum: 20,
      optionB: true,
      plugAmount: 15,
      installTierBasis: 'invoice',
      updatedAt: null,
      updatedByName: null,
    }
  );
}

export async function saveFridgeLogic(
  client: Q,
  v: Omit<StoredFridgeLogic, 'updatedAt' | 'updatedByName'>,
  profileId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO revenue_fridge_logic (id, enabled, small_base, small_over10, small_minimum, option_b, plug_amount, install_tier_basis, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET enabled = $1, small_base = $2, small_over10 = $3,
       small_minimum = $4, option_b = $5, plug_amount = $6, install_tier_basis = $7, updated_by = $8, updated_at = now()`,
    [
      v.enabled,
      v.smallBase,
      v.smallOver10,
      v.smallMinimum,
      v.optionB,
      v.plugAmount,
      v.installTierBasis,
      profileId,
    ],
  );
}
