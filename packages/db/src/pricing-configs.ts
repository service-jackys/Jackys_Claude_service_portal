import type { PoolClient } from 'pg';
import type { PricingConfigDomain } from '../../contracts/src/index.js';

// Phase 6 (see modification.md #26): one generic table holds the CURRENT
// value for each of the 7 admin pricing domains (VAS bands/params/split,
// rate card, D+I, AMC, Thomson). History/versioning deliberately reuses the
// existing audit_events table (see audit.ts) instead of a second table --
// every save/reset/restore below is expected to also call insertAuditEvent
// with target_type='pricing_config', target_id=<this row's id>, and the
// full payload snapshot in metadata (metadata.domain / metadata.payload /
// metadata.action), so a past entry is just an audit_events row and
// "restore" is re-applying its metadata.payload as a new current value.

export type PricingConfigRecord = {
  id: string;
  domain: PricingConfigDomain;
  payload: unknown;
  isOverride: boolean;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
};

const columns = `
  pricing_configs.id,
  pricing_configs.domain,
  pricing_configs.payload,
  pricing_configs.is_override AS "isOverride",
  pricing_configs.updated_by AS "updatedBy",
  pricing_configs.updated_at AS "updatedAt",
  pricing_configs.created_at AS "createdAt"
`;

export async function getPricingConfig(
  client: PoolClient,
  domain: PricingConfigDomain,
): Promise<PricingConfigRecord | null> {
  const result = await client.query<PricingConfigRecord>(
    `SELECT ${columns} FROM pricing_configs WHERE domain = $1 LIMIT 1`,
    [domain],
  );
  return result.rows[0] ?? null;
}

// Used by every domain's GET: if no row exists yet (first run, before any
// admin has ever saved or the table was just migrated in), the caller
// falls back to that domain's Excel-derived default constant rather than
// erroring -- "default values from excel and no dependency needed" only
// kicks in once an admin actually saves an override.
export async function listAllPricingConfigs(client: PoolClient): Promise<PricingConfigRecord[]> {
  const result = await client.query<PricingConfigRecord>(
    `SELECT ${columns} FROM pricing_configs ORDER BY domain ASC`,
  );
  return result.rows;
}

export async function upsertPricingConfig(
  client: PoolClient,
  domain: PricingConfigDomain,
  payload: unknown,
  isOverride: boolean,
  updatedBy: string | null,
): Promise<PricingConfigRecord> {
  const result = await client.query<PricingConfigRecord>(
    `INSERT INTO pricing_configs (domain, payload, is_override, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, now())
     ON CONFLICT (domain) DO UPDATE
       SET payload = EXCLUDED.payload,
           is_override = EXCLUDED.is_override,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING ${columns}`,
    [domain, JSON.stringify(payload), isOverride, updatedBy],
  );
  return result.rows[0];
}

export async function deletePricingConfig(
  client: PoolClient,
  domain: PricingConfigDomain,
): Promise<void> {
  await client.query('DELETE FROM pricing_configs WHERE domain = $1', [domain]);
}

export type PricingConfigHistoryEntry = {
  auditEventId: string;
  action: string;
  actorProfileId: string | null;
  payload: unknown;
  occurredAt: Date;
};

// History for one domain, newest first -- reads straight off audit_events
// (see audit.ts's insertAuditEvent), filtered by the domain recorded in
// each event's metadata rather than by target_id, so history survives even
// across a delete+recreate of the pricing_configs row.
export async function listPricingConfigHistory(
  client: PoolClient,
  domain: PricingConfigDomain,
  limit: number = 50,
): Promise<PricingConfigHistoryEntry[]> {
  const result = await client.query<{
    id: string;
    action: string;
    actor_profile_id: string | null;
    metadata: { domain: string; payload: unknown };
    occurred_at: Date;
  }>(
    `SELECT id, action, actor_profile_id, metadata, occurred_at
     FROM audit_events
     WHERE target_type = 'pricing_config' AND metadata->>'domain' = $1
     ORDER BY occurred_at DESC
     LIMIT $2`,
    [domain, limit],
  );
  return result.rows.map((row) => ({
    auditEventId: row.id,
    action: row.action,
    actorProfileId: row.actor_profile_id,
    payload: row.metadata?.payload,
    occurredAt: row.occurred_at,
  }));
}

export async function getPricingConfigHistoryEntry(
  client: PoolClient,
  domain: PricingConfigDomain,
  auditEventId: string,
): Promise<PricingConfigHistoryEntry | null> {
  const result = await client.query<{
    id: string;
    action: string;
    actor_profile_id: string | null;
    metadata: { domain: string; payload: unknown };
    occurred_at: Date;
  }>(
    `SELECT id, action, actor_profile_id, metadata, occurred_at
     FROM audit_events
     WHERE target_type = 'pricing_config' AND id = $1 AND metadata->>'domain' = $2
     LIMIT 1`,
    [auditEventId, domain],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    auditEventId: row.id,
    action: row.action,
    actorProfileId: row.actor_profile_id,
    payload: row.metadata?.payload,
    occurredAt: row.occurred_at,
  };
}
