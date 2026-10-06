import type { PoolClient } from 'pg';
import type { AppointmentStatus, AppointmentStatusUpdateInput } from '../../contracts/src/index.js';

export type AppointmentRecord = {
  id: string;
  appointmentReference: string;
  complaintId: string | null;
  // The originating complaint's reference, if this appointment came from one
  // -- populated only by read paths that join complaints (findAppointmentById);
  // insert/update RETURNING paths set it to null since RETURNING can't join
  // (see modification.md #5). Re-fetch with findAppointmentById if you need it
  // right after a write.
  complaintReference: string | null;
  customerId: string | null;
  branchId: string | null;
  technicianId: string | null;
  technicianName?: string | null;
  customerType: string;
  customerName: string;
  contactNumber: string | null;
  customerEmail: string | null;
  address: string | null;
  region: string | null;
  brand: string | null;
  model: string | null;
  itemCode: string | null;
  faultDescription: string;
  jobWarranty: string | null;
  salesOrderNumber: string | null;
  b2bBranchSchool: string | null;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  subGroup: string | null;
  salesman: string | null;
  appointmentDate: string;
  status: AppointmentStatus;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type AppointmentHistoryRecord = {
  id: string;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus;
  changedBy: string | null;
  reason: string | null;
  changedAt: Date;
};

const columns = `
  appointments.id,
  appointments.appointment_reference AS "appointmentReference",
  appointments.complaint_id AS "complaintId",
  appointments.customer_id AS "customerId",
  appointments.branch_id AS "branchId",
  appointments.technician_id AS "technicianId",
  (SELECT t.name FROM technicians t WHERE t.id = appointments.technician_id) AS "technicianName",
  appointments.customer_type AS "customerType",
  appointments.customer_name AS "customerName",
  appointments.contact_number AS "contactNumber",
  appointments.customer_email AS "customerEmail",
  appointments.address,
  appointments.region,
  appointments.brand,
  appointments.model,
  appointments.item_code AS "itemCode",
  appointments.fault_description AS "faultDescription",
  appointments.job_warranty AS "jobWarranty",
  appointments.sales_order_number AS "salesOrderNumber",
  appointments.b2b_branch_school AS "b2bBranchSchool",
  appointments.school_contact_person AS "schoolContactPerson",
  appointments.school_contact_number AS "schoolContactNumber",
  appointments.customer_number AS "customerNumber",
  appointments.sub_group AS "subGroup",
  appointments.salesman,
  appointments.appointment_date::text AS "appointmentDate",
  appointments.status,
  appointments.closed_at AS "closedAt",
  appointments.created_at AS "createdAt",
  appointments.updated_at AS "updatedAt",
  appointments.created_by AS "createdBy",
  appointments.updated_by AS "updatedBy"
`;

// Adds the originating complaint's reference via a join -- only usable in a
// plain SELECT (not INSERT/UPDATE ... RETURNING, which can't join another
// table), and only where the query below actually joins complaints.
const columnsWithComplaint = `${columns},
  complaints.complaint_reference AS "complaintReference"`;

export async function insertAppointment(
  client: PoolClient,
  input: Record<string, unknown>,
): Promise<AppointmentRecord> {
  const result = await client.query<AppointmentRecord>(
    `INSERT INTO appointments (
      appointment_reference, complaint_id, customer_id, branch_id, technician_id,
      customer_type, customer_name, contact_number, customer_email, address, region,
      brand, model, item_code, fault_description, job_warranty, sales_order_number,
      b2b_branch_school, school_contact_person, school_contact_number, customer_number, sub_group,
      salesman, appointment_date, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    RETURNING ${columns}, NULL::text AS "complaintReference"`,
    [
      input.appointmentReference,
      input.complaintId ?? null,
      input.customerId ?? null,
      input.branchId ?? null,
      input.technicianId ?? null,
      input.customerType,
      input.customerName,
      input.contactNumber ?? null,
      input.customerEmail ?? null,
      input.address ?? null,
      input.region ?? null,
      input.brand ?? null,
      input.model ?? null,
      input.itemCode ?? null,
      input.faultDescription,
      input.jobWarranty ?? null,
      input.salesOrderNumber ?? null,
      input.b2bBranchSchool ?? null,
      input.schoolContactPerson ?? null,
      input.schoolContactNumber ?? null,
      input.customerNumber ?? null,
      input.subGroup ?? null,
      input.salesman ?? null,
      input.appointmentDate,
      input.createdBy ?? null,
    ],
  );
  return result.rows[0];
}

export async function findAppointmentById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<AppointmentRecord | null> {
  const result = await client.query<AppointmentRecord>(
    `SELECT ${columnsWithComplaint}
     FROM appointments
     LEFT JOIN complaints ON complaints.id = appointments.complaint_id
     WHERE appointments.id = $1 ${forUpdate ? 'FOR UPDATE OF appointments' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findActiveAppointmentForComplaint(
  client: PoolClient,
  complaintId: string,
  forUpdate = false,
): Promise<AppointmentRecord | null> {
  const result = await client.query<AppointmentRecord>(
    `SELECT ${columns} FROM appointments WHERE complaint_id = $1 AND status <> 'Cancelled' ${forUpdate ? 'FOR UPDATE' : ''}`,
    [complaintId],
  );
  return result.rows[0] ?? null;
}

export async function updateAppointmentAssignment(
  client: PoolClient,
  id: string,
  technicianId: string | null,
  profileId: string,
): Promise<AppointmentRecord | null> {
  const result = await client.query<AppointmentRecord>(
    `UPDATE appointments SET technician_id = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING ${columns}, NULL::text AS "complaintReference"`,
    [id, technicianId, profileId],
  );
  return result.rows[0] ?? null;
}

export async function updateAppointmentSchedule(
  client: PoolClient,
  id: string,
  appointmentDate: string,
  profileId: string,
): Promise<AppointmentRecord | null> {
  const result = await client.query<AppointmentRecord>(
    `UPDATE appointments SET appointment_date = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING ${columns}, NULL::text AS "complaintReference"`,
    [id, appointmentDate, profileId],
  );
  return result.rows[0] ?? null;
}

export async function updateAppointmentStatus(
  client: PoolClient,
  id: string,
  input: AppointmentStatusUpdateInput,
  profileId: string,
): Promise<{ appointment: AppointmentRecord; previousStatus: AppointmentStatus } | null> {
  const current = await client.query<{ status: AppointmentStatus }>(
    'SELECT status FROM appointments WHERE id = $1 FOR UPDATE',
    [id],
  );
  const previousStatus = current.rows[0]?.status;
  if (!previousStatus) return null;
  const closedAt = input.status === 'Completed' || input.status === 'Cancelled' ? new Date() : null;
  const result = await client.query<AppointmentRecord>(
    `UPDATE appointments SET status = $2, closed_at = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING ${columns}, NULL::text AS "complaintReference"`,
    [id, input.status, closedAt, profileId],
  );
  return { appointment: result.rows[0], previousStatus };
}

export async function insertAppointmentHistory(
  client: PoolClient,
  appointmentId: string,
  fromStatus: AppointmentStatus | null,
  toStatus: AppointmentStatus,
  changedBy: string | null,
  reason?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by, reason) VALUES ($1, $2, $3, $4, $5)`,
    [appointmentId, fromStatus, toStatus, changedBy, reason ?? null],
  );
}

export async function listAppointmentHistory(
  client: PoolClient,
  appointmentId: string,
): Promise<AppointmentHistoryRecord[]> {
  const result = await client.query<AppointmentHistoryRecord>(
    `SELECT id, from_status AS "fromStatus", to_status AS "toStatus", changed_by AS "changedBy", reason, changed_at AS "changedAt" FROM appointment_status_history WHERE appointment_id = $1 ORDER BY changed_at ASC, id ASC`,
    [appointmentId],
  );
  return result.rows;
}

export async function listAppointments(client: PoolClient, query: Record<string, unknown>) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.from) filters.push(`appointment_date >= ${add(query.from)}`);
  if (query.to) filters.push(`appointment_date <= ${add(query.to)}`);
  if (query.technicianId) filters.push(`technician_id = ${add(query.technicianId)}`);
  if (query.branchId) filters.push(`branch_id = ${add(query.branchId)}`);
  if (query.complaintId) filters.push(`complaint_id = ${add(query.complaintId)}`);
  if (query.status) filters.push(`status = ${add(query.status)}`);
  if (query.region) filters.push(`region = ${add(query.region)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(appointment_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR fault_description ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM appointments ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((Number(query.page) - 1) * Number(query.pageSize));
  const result = await client.query<AppointmentRecord>(
    `SELECT ${columns} FROM appointments ${where} ORDER BY appointment_date ASC, id ASC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
