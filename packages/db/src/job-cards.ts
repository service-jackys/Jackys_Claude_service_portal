import type { PoolClient } from 'pg';
import type {
  ServiceJobCardStatus,
  ServiceJobCardStatusUpdateInput,
} from '../../contracts/src/index.js';

export type ServiceJobCardRecord = {
  id: string;
  jobCardReference: string;
  appointmentId: string;
  appointmentReference: string;
  appointmentDate: string;
  appointmentTime: string;
  customerName: string;
  contactNumber: string;
  faultDescription: string;
  status: ServiceJobCardStatus;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type ServiceJobCardStatusHistoryRecord = {
  id: string;
  fromStatus: ServiceJobCardStatus | null;
  toStatus: ServiceJobCardStatus;
  changedBy: string | null;
  reason: string | null;
  requestId: string | null;
  changedAt: Date;
};

const columns = `
  service_job_cards.id,
  service_job_cards.job_card_reference AS "jobCardReference",
  service_job_cards.appointment_id AS "appointmentId",
  appointments.appointment_reference AS "appointmentReference",
  appointments.appointment_date::text AS "appointmentDate",
  to_char(appointments.appointment_time, 'HH24:MI') AS "appointmentTime",
  appointments.customer_name AS "customerName",
  appointments.contact_number AS "contactNumber",
  appointments.fault_description AS "faultDescription",
  service_job_cards.status,
  service_job_cards.finalized_at AS "finalizedAt",
  service_job_cards.finalized_by AS "finalizedBy",
  service_job_cards.created_at AS "createdAt",
  service_job_cards.updated_at AS "updatedAt",
  service_job_cards.created_by AS "createdBy",
  service_job_cards.updated_by AS "updatedBy"
`;

export async function insertServiceJobCard(
  client: PoolClient,
  input: {
    jobCardReference: string;
    appointmentId: string;
    createdBy: string;
  },
): Promise<ServiceJobCardRecord> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO service_job_cards (
       job_card_reference, appointment_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $3)
     RETURNING id`,
    [input.jobCardReference, input.appointmentId, input.createdBy],
  );
  const jobCard = await findServiceJobCardById(client, result.rows[0].id);
  if (!jobCard) throw new Error('The created job card could not be loaded.');
  return jobCard;
}

export async function findServiceJobCardById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<ServiceJobCardRecord | null> {
  const result = await client.query<ServiceJobCardRecord>(
    `SELECT ${columns}
     FROM service_job_cards
     JOIN appointments ON appointments.id = service_job_cards.appointment_id
     WHERE service_job_cards.id = $1
     ${forUpdate ? 'FOR UPDATE OF service_job_cards' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findServiceJobCardByAppointmentId(
  client: PoolClient,
  appointmentId: string,
  forUpdate = false,
): Promise<ServiceJobCardRecord | null> {
  const result = await client.query<ServiceJobCardRecord>(
    `SELECT ${columns}
     FROM service_job_cards
     JOIN appointments ON appointments.id = service_job_cards.appointment_id
     WHERE service_job_cards.appointment_id = $1
     ${forUpdate ? 'FOR UPDATE OF service_job_cards' : ''}`,
    [appointmentId],
  );
  return result.rows[0] ?? null;
}

export async function listServiceJobCards(
  client: PoolClient,
  query: { status?: string; search?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.status) filters.push(`service_job_cards.status = ${add(query.status)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(service_job_cards.job_card_reference ILIKE ${parameter} OR appointments.appointment_reference ILIKE ${parameter} OR appointments.customer_name ILIKE ${parameter} OR appointments.contact_number ILIKE ${parameter} OR appointments.fault_description ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const from = `FROM service_job_cards JOIN appointments ON appointments.id = service_job_cards.appointment_id`;
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total ${from} ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<ServiceJobCardRecord>(
    `SELECT ${columns} ${from} ${where}
     ORDER BY service_job_cards.updated_at DESC, service_job_cards.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export async function updateServiceJobCardStatus(
  client: PoolClient,
  id: string,
  input: ServiceJobCardStatusUpdateInput,
  profileId: string,
  finalized: boolean,
): Promise<{ jobCard: ServiceJobCardRecord; previousStatus: ServiceJobCardStatus } | null> {
  const current = await client.query<{ status: ServiceJobCardStatus }>(
    'SELECT status FROM service_job_cards WHERE id = $1 FOR UPDATE',
    [id],
  );
  const previousStatus = current.rows[0]?.status;
  if (!previousStatus) return null;
  const result = await client.query<{ id: string }>(
    `UPDATE service_job_cards
     SET status = $2,
         finalized_at = CASE WHEN $4 THEN now() ELSE NULL END,
         finalized_by = CASE WHEN $4 THEN $3::bigint ELSE NULL END,
         updated_by = $3::bigint,
         updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, input.status, profileId, finalized],
  );
  const jobCard = await findServiceJobCardById(client, result.rows[0].id);
  if (!jobCard) throw new Error('The updated job card could not be loaded.');
  return { jobCard, previousStatus };
}

export async function insertServiceJobCardHistory(
  client: PoolClient,
  jobCardId: string,
  fromStatus: ServiceJobCardStatus | null,
  toStatus: ServiceJobCardStatus,
  changedBy: string,
  reason: string | undefined,
  requestId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO service_job_card_status_history
       (job_card_id, from_status, to_status, changed_by, reason, request_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jobCardId, fromStatus, toStatus, changedBy, reason ?? null, requestId],
  );
}

export async function listServiceJobCardHistory(
  client: PoolClient,
  jobCardId: string,
): Promise<ServiceJobCardStatusHistoryRecord[]> {
  const result = await client.query<ServiceJobCardStatusHistoryRecord>(
    `SELECT id,
            from_status AS "fromStatus",
            to_status AS "toStatus",
            changed_by AS "changedBy",
            reason,
            request_id AS "requestId",
            changed_at AS "changedAt"
     FROM service_job_card_status_history
     WHERE job_card_id = $1
     ORDER BY changed_at ASC, id ASC`,
    [jobCardId],
  );
  return result.rows;
}
