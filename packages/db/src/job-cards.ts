import type { PoolClient } from 'pg';
import type {
  JobFinalStatus,
  JobCardPart,
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
  faultDescription: string;
  status: ServiceJobCardStatus;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  sourceType: string;
  jobCardDate: string | null;
  customerName: string | null;
  customerContact: string | null;
  customerAddress: string | null;
  itemDescription: string | null;
  modelNo: string | null;
  warrantyStatus: string | null;
  complaint: string | null;
  serviceRendered: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  timeConsumedHours: string | null;
  parts: JobCardPart[];
  totalCost: string;
  serviceCharge: string;
  grandTotal: string;
  amountChargeable: string | null;
  invoiceNo: string | null;
  deliveryDate: string | null;
  technicianName: string | null;
  brand: string | null;
  jobFinalStatus: JobFinalStatus;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
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

// Content fields carried by a job card, matching the live system's
// HEADERS_BY_TYPE['service-job-card'] (docs/code.gs) -- everything except the
// identity columns (id, reference, appointment link) and this project's own
// workflow-lock state (status/finalizedAt/finalizedBy).
export type ServiceJobCardContent = {
  jobCardDate: string | null;
  customerName: string | null;
  customerContact: string | null;
  customerAddress: string | null;
  itemDescription: string | null;
  modelNo: string | null;
  warrantyStatus: string | null;
  complaint: string | null;
  serviceRendered: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  timeConsumedHours: number | null;
  parts: JobCardPart[];
  totalCost: number;
  serviceCharge: number;
  grandTotal: number;
  amountChargeable: number | null;
  invoiceNo: string | null;
  deliveryDate: string | null;
  technicianName: string | null;
  brand: string | null;
  jobFinalStatus: JobFinalStatus;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
};

const columns = `
  service_job_cards.id,
  service_job_cards.job_card_reference AS "jobCardReference",
  service_job_cards.appointment_id AS "appointmentId",
  appointments.appointment_reference AS "appointmentReference",
  appointments.appointment_date::text AS "appointmentDate",
  to_char(appointments.appointment_time, 'HH24:MI') AS "appointmentTime",
  appointments.fault_description AS "faultDescription",
  service_job_cards.status,
  service_job_cards.finalized_at AS "finalizedAt",
  service_job_cards.finalized_by AS "finalizedBy",
  service_job_cards.source_type AS "sourceType",
  service_job_cards.job_card_date::text AS "jobCardDate",
  service_job_cards.customer_name AS "customerName",
  service_job_cards.customer_contact AS "customerContact",
  service_job_cards.customer_address AS "customerAddress",
  service_job_cards.item_description AS "itemDescription",
  service_job_cards.model_no AS "modelNo",
  service_job_cards.warranty_status AS "warrantyStatus",
  service_job_cards.complaint,
  service_job_cards.service_rendered AS "serviceRendered",
  service_job_cards.period_from AS "periodFrom",
  service_job_cards.period_to AS "periodTo",
  service_job_cards.time_consumed_hours AS "timeConsumedHours",
  service_job_cards.parts,
  service_job_cards.total_cost AS "totalCost",
  service_job_cards.service_charge AS "serviceCharge",
  service_job_cards.grand_total AS "grandTotal",
  service_job_cards.amount_chargeable AS "amountChargeable",
  service_job_cards.invoice_no AS "invoiceNo",
  service_job_cards.delivery_date::text AS "deliveryDate",
  service_job_cards.technician_name AS "technicianName",
  service_job_cards.brand,
  service_job_cards.job_final_status AS "jobFinalStatus",
  service_job_cards.school_contact_person AS "schoolContactPerson",
  service_job_cards.school_contact_number AS "schoolContactNumber",
  service_job_cards.customer_number AS "customerNumber",
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
    content: ServiceJobCardContent;
  },
): Promise<ServiceJobCardRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO service_job_cards (
       job_card_reference, appointment_id, created_by, updated_by,
       source_type, job_card_date, customer_name, customer_contact, customer_address,
       item_description, model_no, warranty_status, complaint, service_rendered,
       period_from, period_to, time_consumed_hours, parts,
       total_cost, service_charge, grand_total, amount_chargeable,
       invoice_no, delivery_date, technician_name, brand, job_final_status,
       school_contact_person, school_contact_number, customer_number
     ) VALUES (
       $1, $2, $3, $3,
       'Scheduler', $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15, $16,
       $17, $18, $19, $20,
       $21, $22, $23, $24, $25,
       $26, $27, $28
     )
     RETURNING id`,
    [
      input.jobCardReference,
      input.appointmentId,
      input.createdBy,
      c.jobCardDate,
      c.customerName,
      c.customerContact,
      c.customerAddress,
      c.itemDescription,
      c.modelNo,
      c.warrantyStatus,
      c.complaint,
      c.serviceRendered,
      c.periodFrom,
      c.periodTo,
      c.timeConsumedHours,
      JSON.stringify(c.parts),
      c.totalCost,
      c.serviceCharge,
      c.grandTotal,
      c.amountChargeable,
      c.invoiceNo,
      c.deliveryDate,
      c.technicianName,
      c.brand,
      c.jobFinalStatus,
      c.schoolContactPerson,
      c.schoolContactNumber,
      c.customerNumber,
    ],
  );
  const jobCard = await findServiceJobCardById(client, result.rows[0].id);
  if (!jobCard) throw new Error('The created job card could not be loaded.');
  return jobCard;
}

export async function updateServiceJobCardContent(
  client: PoolClient,
  id: string,
  content: ServiceJobCardContent,
  profileId: string,
): Promise<ServiceJobCardRecord | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE service_job_cards
     SET job_card_date = $2, customer_name = $3, customer_contact = $4, customer_address = $5,
         item_description = $6, model_no = $7, warranty_status = $8, complaint = $9,
         service_rendered = $10, period_from = $11, period_to = $12, time_consumed_hours = $13,
         parts = $14, total_cost = $15, service_charge = $16, grand_total = $17,
         amount_chargeable = $18, invoice_no = $19, delivery_date = $20, technician_name = $21,
         brand = $22, job_final_status = $23, school_contact_person = $24,
         school_contact_number = $25, customer_number = $26,
         updated_by = $27, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      content.jobCardDate,
      content.customerName,
      content.customerContact,
      content.customerAddress,
      content.itemDescription,
      content.modelNo,
      content.warrantyStatus,
      content.complaint,
      content.serviceRendered,
      content.periodFrom,
      content.periodTo,
      content.timeConsumedHours,
      JSON.stringify(content.parts),
      content.totalCost,
      content.serviceCharge,
      content.grandTotal,
      content.amountChargeable,
      content.invoiceNo,
      content.deliveryDate,
      content.technicianName,
      content.brand,
      content.jobFinalStatus,
      content.schoolContactPerson,
      content.schoolContactNumber,
      content.customerNumber,
      profileId,
    ],
  );
  if (!result.rows[0]) return null;
  return findServiceJobCardById(client, result.rows[0].id);
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
      `(service_job_cards.job_card_reference ILIKE ${parameter} OR appointments.appointment_reference ILIKE ${parameter} OR service_job_cards.customer_name ILIKE ${parameter} OR service_job_cards.customer_contact ILIKE ${parameter})`,
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
