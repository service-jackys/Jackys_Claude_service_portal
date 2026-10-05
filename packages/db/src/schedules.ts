import type { PoolClient } from 'pg';

export type DraftScheduleRecord = {
  id: string;
  idempotencyKey: string;
  status: 'Draft' | 'Promoted' | 'Cancelled';
  createdBy: string | null;
  promotedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DraftScheduleItemRecord = {
  id: string;
  draftScheduleId: string;
  complaintId: string;
  technicianId: string | null;
  appointmentDate: string;
  appointmentTime: string;
  appointmentId: string | null;
};

const scheduleColumns = `id, idempotency_key AS "idempotencyKey", status, created_by AS "createdBy", promoted_at AS "promotedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
const itemColumns = `id, draft_schedule_id AS "draftScheduleId", complaint_id AS "complaintId", technician_id AS "technicianId", appointment_date::text AS "appointmentDate", appointment_time::text AS "appointmentTime", appointment_id AS "appointmentId"`;

export async function insertDraftSchedule(
  client: PoolClient,
  idempotencyKey: string,
  createdBy: string,
): Promise<DraftScheduleRecord> {
  const result = await client.query<DraftScheduleRecord>(
    `INSERT INTO draft_schedules (idempotency_key, created_by) VALUES ($1, $2) ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${scheduleColumns}`,
    [idempotencyKey, createdBy],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await findDraftByIdempotencyKey(client, idempotencyKey);
  if (!existing)
    throw new Error(
      'Draft schedule idempotency record was not available after conflict resolution.',
    );
  return existing;
}

export async function findDraftByIdempotencyKey(
  client: PoolClient,
  key: string,
): Promise<DraftScheduleRecord | null> {
  const result = await client.query<DraftScheduleRecord>(
    `SELECT ${scheduleColumns} FROM draft_schedules WHERE idempotency_key = $1`,
    [key],
  );
  return result.rows[0] ?? null;
}

export async function findDraftById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<DraftScheduleRecord | null> {
  const result = await client.query<DraftScheduleRecord>(
    `SELECT ${scheduleColumns} FROM draft_schedules WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function replaceDraftItems(
  client: PoolClient,
  draftId: string,
  items: Array<Record<string, unknown>>,
): Promise<DraftScheduleItemRecord[]> {
  await client.query('DELETE FROM draft_schedule_items WHERE draft_schedule_id = $1', [draftId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO draft_schedule_items (draft_schedule_id, complaint_id, technician_id, appointment_date, appointment_time) VALUES ($1, $2, $3, $4, $5)`,
      [
        draftId,
        item.complaintId,
        item.technicianId ?? null,
        item.appointmentDate,
        item.appointmentTime,
      ],
    );
  }
  return listDraftItems(client, draftId);
}

export async function listDraftItems(
  client: PoolClient,
  draftId: string,
  forUpdate = false,
): Promise<DraftScheduleItemRecord[]> {
  const result = await client.query<DraftScheduleItemRecord>(
    `SELECT ${itemColumns} FROM draft_schedule_items WHERE draft_schedule_id = $1 ORDER BY id ${forUpdate ? 'FOR UPDATE' : ''}`,
    [draftId],
  );
  return result.rows;
}

export async function updateDraftStatus(
  client: PoolClient,
  id: string,
  status: 'Promoted' | 'Cancelled',
): Promise<DraftScheduleRecord | null> {
  const result = await client.query<DraftScheduleRecord>(
    `UPDATE draft_schedules SET status = $2, promoted_at = CASE WHEN $2 = 'Promoted' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1 RETURNING ${scheduleColumns}`,
    [id, status],
  );
  return result.rows[0] ?? null;
}

export async function linkDraftItemAppointment(
  client: PoolClient,
  itemId: string,
  appointmentId: string,
): Promise<void> {
  await client.query(`UPDATE draft_schedule_items SET appointment_id = $2 WHERE id = $1`, [
    itemId,
    appointmentId,
  ]);
}

export async function listDrafts(client: PoolClient, page: number, pageSize: number) {
  const count = await client.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM draft_schedules',
  );
  const result = await client.query<DraftScheduleRecord>(
    `SELECT ${scheduleColumns} FROM draft_schedules ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [pageSize, (page - 1) * pageSize],
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export type AwaitingDraft = {
  id: string;
  createdAt: Date;
  createdByName: string | null;
  items: {
    complaintReference: string;
    customerName: string;
    region: string | null;
    complaintStatus: string;
    technicianName: string | null;
    appointmentDate: string;
    appointmentTime: string;
  }[];
};

// Every draft schedule still waiting to be promoted or cancelled, oldest
// first, with the jobs inside each one (modification.md #56).
export async function listAwaitingDrafts(client: PoolClient): Promise<AwaitingDraft[]> {
  const drafts = await client.query<{
    id: string;
    createdAt: Date;
    createdByName: string | null;
  }>(
    `SELECT d.id::text AS id, d.created_at AS "createdAt", p.display_name AS "createdByName"
     FROM draft_schedules d
     LEFT JOIN profiles p ON p.id = d.created_by
     WHERE d.status = 'Draft'
     ORDER BY d.created_at ASC, d.id ASC`,
  );
  if (!drafts.rows.length) return [];
  const items = await client.query<{
    draftId: string;
    complaintReference: string;
    customerName: string;
    region: string | null;
    complaintStatus: string;
    technicianName: string | null;
    appointmentDate: string;
    appointmentTime: string;
  }>(
    `SELECT i.draft_schedule_id::text AS "draftId",
            c.complaint_reference AS "complaintReference",
            c.customer_name AS "customerName",
            c.region,
            c.status AS "complaintStatus",
            t.name AS "technicianName",
            i.appointment_date::text AS "appointmentDate",
            to_char(i.appointment_time, 'HH24:MI') AS "appointmentTime"
     FROM draft_schedule_items i
     JOIN complaints c ON c.id = i.complaint_id
     LEFT JOIN technicians t ON t.id = i.technician_id
     WHERE i.draft_schedule_id = ANY($1::bigint[])
     ORDER BY i.appointment_date, i.appointment_time, i.id`,
    [drafts.rows.map((row) => row.id)],
  );
  return drafts.rows.map((draft) => ({
    ...draft,
    items: items.rows
      .filter((item) => item.draftId === draft.id)
      .map(({ draftId: _draftId, ...rest }) => rest),
  }));
}
