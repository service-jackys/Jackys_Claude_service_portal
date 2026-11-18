import type { PoolClient } from 'pg';

export interface VisitDraftRecord {
  id: string;
  payload: Record<string, unknown>;
  customerName: string;
  itemCount: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
}

const columns = `d.id, d.payload, d.customer_name AS "customerName", d.item_count AS "itemCount",
  d.created_by AS "createdBy", p.display_name AS "createdByName",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt",
  floor(extract(epoch FROM (now() - d.created_at)) / 86400)::int AS "ageDays"`;

const from = 'FROM visit_drafts d LEFT JOIN profiles p ON p.id = d.created_by';

export async function listVisitDrafts(client: PoolClient): Promise<VisitDraftRecord[]> {
  const result = await client.query<VisitDraftRecord>(
    `SELECT ${columns} ${from} ORDER BY d.created_at ASC, d.id ASC`,
  );
  return result.rows;
}

export async function findVisitDraft(client: PoolClient, id: string, lock = false) {
  const result = await client.query<VisitDraftRecord>(
    `SELECT ${columns} ${from} WHERE d.id = $1 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function insertVisitDraft(
  client: PoolClient,
  payload: Record<string, unknown>,
  customerName: string,
  itemCount: number,
  createdBy: string | null,
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO visit_drafts (payload, customer_name, item_count, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [JSON.stringify(payload), customerName, itemCount, createdBy],
  );
  return result.rows[0]!.id;
}

export async function updateVisitDraft(
  client: PoolClient,
  id: string,
  payload: Record<string, unknown>,
  customerName: string,
  itemCount: number,
) {
  const result = await client.query(
    `UPDATE visit_drafts SET payload = $2, customer_name = $3, item_count = $4, updated_at = now()
     WHERE id = $1`,
    [id, JSON.stringify(payload), customerName, itemCount],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteVisitDraft(client: PoolClient, id: string) {
  const result = await client.query('DELETE FROM visit_drafts WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
