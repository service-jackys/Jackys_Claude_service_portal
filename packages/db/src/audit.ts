import type { PoolClient } from 'pg';

export type AuditEventInput = {
  actorProfileId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
};

export async function insertAuditEvent(client: PoolClient, event: AuditEventInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       actor_profile_id, action, target_type, target_id, metadata, request_id
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      event.actorProfileId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      JSON.stringify(event.metadata ?? {}),
      event.requestId ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Reading the audit trail (modification.md #53 -- the Activity log screen).
// ---------------------------------------------------------------------------

export type AuditEventFilters = {
  from?: string;
  to?: string;
  actorId?: string;
  module?: string;
  action?: string;
  search?: string;
};

export type AuditEventRow = {
  id: string;
  occurredAt: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

// Dates are compared as Dubai calendar days -- the business timezone -- so
// "today" in the Activity log means today in Dubai, not in UTC.
const dubaiDay = `(audit_events.occurred_at AT TIME ZONE 'Asia/Dubai')::date`;

export async function listAuditEvents(
  client: PoolClient,
  filters: AuditEventFilters,
  paging: { limit: number; offset: number },
): Promise<{ items: AuditEventRow[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.from) where.push(`${dubaiDay} >= ${add(filters.from)}::date`);
  if (filters.to) where.push(`${dubaiDay} <= ${add(filters.to)}::date`);
  if (filters.actorId === 'none') where.push('audit_events.actor_profile_id IS NULL');
  else if (filters.actorId)
    where.push(`audit_events.actor_profile_id = ${add(filters.actorId)}::bigint`);
  if (filters.module)
    where.push(`split_part(audit_events.action, '.', 1) = ${add(filters.module)}`);
  if (filters.action) where.push(`audit_events.action = ${add(filters.action)}`);
  if (filters.search) {
    const parameter = add(`%${filters.search}%`);
    where.push(
      `(audit_events.action ILIKE ${parameter}
        OR profiles.display_name ILIKE ${parameter}
        OR profiles.email ILIKE ${parameter}
        OR audit_events.metadata::text ILIKE ${parameter})`,
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM audit_events LEFT JOIN profiles ON profiles.id = audit_events.actor_profile_id`;
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total ${from} ${whereSql}`,
    values,
  );
  const limit = add(paging.limit);
  const offset = add(paging.offset);
  const result = await client.query<AuditEventRow>(
    `SELECT audit_events.id::text AS id,
            to_char(audit_events.occurred_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD HH24:MI:SS') AS "occurredAt",
            audit_events.action,
            audit_events.target_type AS "targetType",
            audit_events.target_id::text AS "targetId",
            audit_events.metadata,
            audit_events.request_id AS "requestId",
            profiles.id::text AS "actorId",
            profiles.display_name AS "actorName",
            profiles.email AS "actorEmail"
     ${from} ${whereSql}
     ORDER BY audit_events.occurred_at DESC, audit_events.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export async function auditFilterOptions(client: PoolClient): Promise<{
  modules: string[];
  actions: string[];
  actors: { id: string; name: string; email: string }[];
}> {
  const actions = await client.query<{ action: string }>(
    `SELECT DISTINCT action FROM audit_events ORDER BY action`,
  );
  const actors = await client.query<{ id: string; name: string; email: string }>(
    `SELECT DISTINCT profiles.id::text AS id, profiles.display_name AS name, profiles.email
     FROM audit_events JOIN profiles ON profiles.id = audit_events.actor_profile_id
     ORDER BY profiles.display_name`,
  );
  const modules = [...new Set(actions.rows.map((row) => row.action.split('.')[0]))].sort();
  return { modules, actions: actions.rows.map((row) => row.action), actors: actors.rows };
}
