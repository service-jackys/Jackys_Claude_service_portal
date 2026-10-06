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
  // Exactly one of appointmentId / quotationId is set -- see
  // migrations/014_job_card_quotation_source.sql and modification.md #18.
  appointmentId: string | null;
  appointmentReference: string | null;
  quotationId: string | null;
  quotationReference: string | null;
  // The complaint that led to this job card's appointment, if any -- an
  // appointment can be created without a complaint, so both can be null.
  // Carried through for the workflow link (see modification.md #5).
  complaintId: string | null;
  complaintReference: string | null;
  appointmentDate: string | null;
  faultDescription: string | null;
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
  salesman: string | null;
  salesChannel: string | null;
  jobFinalStatus: JobFinalStatus;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  customerType: string | null;
  customerEmail: string | null;
  region: string | null;
  b2bBranchSchool: string | null;
  salesOrderNumber: string | null;
  legacyReference: string | null;
  itemCode: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  itemInMaster: boolean | null;
  serialNo: string | null;
  purchaseDate: string | null;
  accessoriesReceived: string | null;
  conditionNotes: string | null;
  intakeAt: Date | null;
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
  salesman: string | null;
  salesChannel: string | null;
  jobFinalStatus: JobFinalStatus;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  customerType: string | null;
  customerEmail: string | null;
  region: string | null;
  b2bBranchSchool: string | null;
  salesOrderNumber: string | null;
  legacyReference: string | null;
  itemCode: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  itemInMaster: boolean | null;
  serialNo: string | null;
  purchaseDate: string | null;
  accessoriesReceived: string | null;
  conditionNotes: string | null;
};

const columns = `
  service_job_cards.id,
  service_job_cards.job_card_reference AS "jobCardReference",
  service_job_cards.appointment_id AS "appointmentId",
  appointments.appointment_reference AS "appointmentReference",
  service_job_cards.quotation_id AS "quotationId",
  quotations.quotation_reference AS "quotationReference",
  appointments.complaint_id AS "complaintId",
  complaints.complaint_reference AS "complaintReference",
  appointments.appointment_date::text AS "appointmentDate",
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
  service_job_cards.salesman,
  service_job_cards.sales_channel AS "salesChannel",
  service_job_cards.job_final_status AS "jobFinalStatus",
  service_job_cards.school_contact_person AS "schoolContactPerson",
  service_job_cards.school_contact_number AS "schoolContactNumber",
  service_job_cards.customer_number AS "customerNumber",
  COALESCE(service_job_cards.customer_type, appointments.customer_type) AS "customerType",
  COALESCE(service_job_cards.customer_email, appointments.customer_email) AS "customerEmail",
  COALESCE(service_job_cards.region, appointments.region) AS "region",
  COALESCE(service_job_cards.b2b_branch_school, appointments.b2b_branch_school) AS "b2bBranchSchool",
  COALESCE(service_job_cards.sales_order_number, appointments.sales_order_number) AS "salesOrderNumber",
  service_job_cards.legacy_reference AS "legacyReference",
  service_job_cards.item_code AS "itemCode",
  service_job_cards.main_group AS "mainGroup",
  service_job_cards.group_name AS "groupName",
  service_job_cards.sub_group AS "subGroup",
  service_job_cards.item_in_master AS "itemInMaster",
  service_job_cards.serial_no AS "serialNo",
  service_job_cards.purchase_date::text AS "purchaseDate",
  service_job_cards.accessories_received AS "accessoriesReceived",
  service_job_cards.condition_notes AS "conditionNotes",
  service_job_cards.intake_at AS "intakeAt",
  service_job_cards.created_at AS "createdAt",
  service_job_cards.updated_at AS "updatedAt",
  service_job_cards.created_by AS "createdBy",
  service_job_cards.updated_by AS "updatedBy"
`;

export async function insertServiceJobCard(
  client: PoolClient,
  input: {
    jobCardReference: string;
    // Exactly one of these is set -- see migrations/014_job_card_quotation_source.sql.
    appointmentId: string | null;
    quotationId: string | null;
    sourceType: string;
    createdBy: string;
    content: ServiceJobCardContent;
    intakeAt?: Date | null;
  },
): Promise<ServiceJobCardRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO service_job_cards (
       job_card_reference, appointment_id, quotation_id, created_by, updated_by,
       source_type, job_card_date, customer_name, customer_contact, customer_address,
       item_description, model_no, warranty_status, complaint, service_rendered,
       period_from, period_to, time_consumed_hours, parts,
       total_cost, service_charge, grand_total, amount_chargeable,
       invoice_no, delivery_date, technician_name, brand, salesman, sales_channel, job_final_status,
       school_contact_person, school_contact_number, customer_number, legacy_reference,
       item_code, main_group, group_name, sub_group, item_in_master, serial_no, purchase_date,
       accessories_received, condition_notes, intake_at,
       customer_type, customer_email, region, b2b_branch_school, sales_order_number
     ) VALUES (
       $1, $2, $3, $4, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16, $17, $18,
       $19, $20, $21, $22,
       $23, $24, $25, $26, $27, $28, $29,
       $30, $31, $32, $33,
       $34, $35, $36, $37, $38, $39, $40,
       $41, $42, $43,
       $44, $45, $46, $47, $48
     )
     RETURNING id`,
    [
      input.jobCardReference,
      input.appointmentId,
      input.quotationId,
      input.createdBy,
      input.sourceType,
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
      c.salesman,
      c.salesChannel,
      c.jobFinalStatus,
      c.schoolContactPerson,
      c.schoolContactNumber,
      c.customerNumber,
      c.legacyReference,
      c.itemCode,
      c.mainGroup,
      c.groupName,
      c.subGroup,
      c.itemInMaster,
      c.serialNo,
      c.purchaseDate,
      c.accessoriesReceived,
      c.conditionNotes,
      input.intakeAt ?? null,
      c.customerType,
      c.customerEmail,
      c.region,
      c.b2bBranchSchool,
      c.salesOrderNumber,
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
         brand = $22, salesman = $23, sales_channel = $24, job_final_status = $25,
         school_contact_person = $26, school_contact_number = $27, customer_number = $28,
         legacy_reference = $29, updated_by = $30,
         item_code = $31, main_group = $32, group_name = $33, sub_group = $34,
         item_in_master = $35, serial_no = $36, purchase_date = $37,
         accessories_received = $38, condition_notes = $39,
         customer_type = $40, customer_email = $41, region = $42, b2b_branch_school = $43,
         sales_order_number = $44, updated_at = now()
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
      content.salesman,
      content.salesChannel,
      content.jobFinalStatus,
      content.schoolContactPerson,
      content.schoolContactNumber,
      content.customerNumber,
      content.legacyReference,
      profileId,
      content.itemCode,
      content.mainGroup,
      content.groupName,
      content.subGroup,
      content.itemInMaster,
      content.serialNo,
      content.purchaseDate,
      content.accessoriesReceived,
      content.conditionNotes,
      content.customerType,
      content.customerEmail,
      content.region,
      content.b2bBranchSchool,
      content.salesOrderNumber,
    ],
  );
  if (!result.rows[0]) return null;
  return findServiceJobCardById(client, result.rows[0].id);
}

const joins = `
     LEFT JOIN appointments ON appointments.id = service_job_cards.appointment_id
     LEFT JOIN quotations ON quotations.id = service_job_cards.quotation_id
     LEFT JOIN complaints ON complaints.id = appointments.complaint_id
`;

export async function findServiceJobCardById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<ServiceJobCardRecord | null> {
  const result = await client.query<ServiceJobCardRecord>(
    `SELECT ${columns}
     FROM service_job_cards
     ${joins}
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
     ${joins}
     WHERE service_job_cards.appointment_id = $1
     ${forUpdate ? 'FOR UPDATE OF service_job_cards' : ''}`,
    [appointmentId],
  );
  return result.rows[0] ?? null;
}

// Mirrors findServiceJobCardByAppointmentId, for the quotation-sourced path
// (see modification.md #18) -- used both to enforce "one job card per
// quotation" on create and to let the UI show whether a given quotation
// already has a job card.
export async function findServiceJobCardByQuotationId(
  client: PoolClient,
  quotationId: string,
  forUpdate = false,
): Promise<ServiceJobCardRecord | null> {
  const result = await client.query<ServiceJobCardRecord>(
    `SELECT ${columns}
     FROM service_job_cards
     ${joins}
     WHERE service_job_cards.quotation_id = $1
     ${forUpdate ? 'FOR UPDATE OF service_job_cards' : ''}`,
    [quotationId],
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
      `(service_job_cards.job_card_reference ILIKE ${parameter} OR appointments.appointment_reference ILIKE ${parameter} OR quotations.quotation_reference ILIKE ${parameter} OR service_job_cards.customer_name ILIKE ${parameter} OR service_job_cards.customer_contact ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const from = `FROM service_job_cards ${joins}`;
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

export type OpenRecordsForContact = {
  complaints: {
    id: string;
    reference: string;
    status: string;
    submittedAt: Date;
    summary: string;
  }[];
  appointments: { id: string; reference: string; status: string; appointmentDate: string }[];
  walkIns: {
    id: string;
    reference: string;
    status: string;
    createdAt: Date;
    item: string | null;
  }[];
};

/**
 * Open records for the same phone number, so the counter staff can see that a
 * walk-in customer already has a complaint, appointment or walk-in card before
 * a second record is opened for the same repair. Numbers are matched on their
 * last nine digits so +971 / 05x / spaces do not matter.
 */
export async function findOpenRecordsForContact(
  client: PoolClient,
  contact: string,
): Promise<OpenRecordsForContact> {
  const digits = contact.replace(/\D/g, '');
  if (digits.length < 7) return { complaints: [], appointments: [], walkIns: [] };
  const key = digits.slice(-9);
  const norm = (column: string) => `right(regexp_replace(${column}, '[^0-9]', '', 'g'), 9) = $1`;
  const complaints = await client.query(
    `SELECT id::text, complaint_reference AS reference, status, submitted_at AS "submittedAt",
            left(description, 120) AS summary
       FROM complaints
      WHERE ${norm('contact_number')} AND status NOT IN ('Closed', 'Cancelled')
      ORDER BY submitted_at DESC LIMIT 5`,
    [key],
  );
  const appointments = await client.query(
    `SELECT id::text, appointment_reference AS reference, status,
            appointment_date::text AS "appointmentDate"
       FROM appointments
      WHERE ${norm('contact_number')} AND status NOT IN ('Completed', 'Cancelled')
      ORDER BY appointment_date DESC LIMIT 5`,
    [key],
  );
  const walkIns = await client.query(
    `SELECT id::text, job_card_reference AS reference, status, created_at AS "createdAt",
            COALESCE(NULLIF(trim(concat_ws(' ', brand, model_no)), ''), item_description) AS item
       FROM service_job_cards
      WHERE ${norm('customer_contact')} AND status NOT IN ('Completed', 'Cancelled')
      ORDER BY created_at DESC LIMIT 5`,
    [key],
  );
  return {
    complaints: complaints.rows,
    appointments: appointments.rows,
    walkIns: walkIns.rows,
  };
}

const AWAITING_JOB_CARD_WHERE = `appointments.status = 'Completed'
  AND NOT EXISTS (
    SELECT 1 FROM service_job_cards WHERE service_job_cards.appointment_id = appointments.id
  )`;

export type AwaitingJobCardAppointment = {
  appointmentId: string;
  appointmentReference: string;
  complaintId: string | null;
  complaintReference: string | null;
  customerName: string;
  contactNumber: string | null;
  brand: string | null;
  model: string | null;
  faultDescription: string;
  appointmentDate: string;
  completedAt: string | null;
  technicianName: string | null;
};

/** Completed appointments that have no service job card yet, oldest first. */
export async function listAppointmentsAwaitingJobCard(
  client: PoolClient,
  query: { search?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  let search = '';
  if (query.search) {
    values.push(`%${query.search}%`);
    search = ` AND (appointments.appointment_reference ILIKE $1 OR appointments.customer_name ILIKE $1 OR appointments.contact_number ILIKE $1 OR complaints.complaint_reference ILIKE $1)`;
  }
  const from = `FROM appointments
    LEFT JOIN complaints ON complaints.id = appointments.complaint_id
    LEFT JOIN technicians ON technicians.id = appointments.technician_id`;
  const where = `WHERE ${AWAITING_JOB_CARD_WHERE}${search}`;
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total ${from} ${where}`,
    values,
  );
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const result = await client.query<AwaitingJobCardAppointment>(
    `SELECT appointments.id::text AS "appointmentId",
            appointments.appointment_reference AS "appointmentReference",
            appointments.complaint_id::text AS "complaintId",
            complaints.complaint_reference AS "complaintReference",
            appointments.customer_name AS "customerName",
            appointments.contact_number AS "contactNumber",
            appointments.brand AS brand,
            appointments.model AS model,
            appointments.fault_description AS "faultDescription",
            appointments.appointment_date::text AS "appointmentDate",
            appointments.closed_at AS "completedAt",
            technicians.name AS "technicianName"
     ${from} ${where}
     ORDER BY appointments.closed_at ASC NULLS LAST, appointments.id ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
