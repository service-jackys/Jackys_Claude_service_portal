import type { PoolClient } from 'pg';
import type {
  ComplaintListQuery,
  ComplaintStatus,
  ComplaintStatusUpdateInput,
  ComplaintNotesInput,
  PublicComplaintInput,
} from '../../contracts/src/index.js';

export type ComplaintRecord = {
  id: string;
  complaintReference: string;
  customerId: string | null;
  branchId: string | null;
  customerType: string;
  customerName: string;
  contactNumber: string | null;
  customerEmail: string | null;
  address: string | null;
  region: string | null;
  brand: string | null;
  model: string | null;
  serialOrItemCode: string | null;
  description: string;
  salesOrderNumber: string | null;
  b2bBranchSchool: string | null;
  b2bBranchCustCode: string | null;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  warrantyClassification: string | null;
  status: ComplaintStatus;
  cceNotes: string | null;
  submittedAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type ComplaintHistoryRecord = {
  id: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  changedBy: string | null;
  reason: string | null;
  changedAt: Date;
};

export type ComplaintListResult = {
  items: ComplaintRecord[];
  total: number;
};

const complaintColumns = `
  complaints.id,
  complaints.complaint_reference AS "complaintReference",
  complaints.customer_id AS "customerId",
  complaints.branch_id AS "branchId",
  complaints.customer_type AS "customerType",
  complaints.customer_name AS "customerName",
  complaints.contact_number AS "contactNumber",
  complaints.customer_email AS "customerEmail",
  complaints.address,
  complaints.region,
  complaints.brand,
  complaints.model,
  complaints.serial_or_item_code AS "serialOrItemCode",
  complaints.description,
  complaints.sales_order_number AS "salesOrderNumber",
  complaints.b2b_branch_school AS "b2bBranchSchool",
  complaints.b2b_branch_cust_code AS "b2bBranchCustCode",
  complaints.school_contact_person AS "schoolContactPerson",
  complaints.school_contact_number AS "schoolContactNumber",
  complaints.customer_number AS "customerNumber",
  complaints.warranty_classification AS "warrantyClassification",
  complaints.status,
  complaints.cce_notes AS "cceNotes",
  complaints.submitted_at AS "submittedAt",
  complaints.updated_at AS "updatedAt",
  complaints.updated_by AS "updatedBy"
`;

export async function insertComplaint(
  client: PoolClient,
  reference: string,
  input: PublicComplaintInput,
): Promise<ComplaintRecord> {
  // b2b_branch_cust_code is deliberately not settable here -- it's only
  // ever written by staff via updateComplaintB2bBranchLink, after matching
  // the free text below against the master list (see modification.md #2).
  const result = await client.query<ComplaintRecord>(
    `INSERT INTO complaints (
       complaint_reference, customer_type, customer_name, contact_number,
       customer_email, address, region, brand, model, serial_or_item_code, description,
       sales_order_number, b2b_branch_school, school_contact_person,
       school_contact_number, customer_number
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING ${complaintColumns}`,
    [
      reference,
      input.customerType,
      input.customerName,
      input.contactNumber ?? null,
      input.customerEmail ?? null,
      input.address ?? null,
      input.region ?? null,
      input.brand ?? null,
      input.model ?? null,
      input.serialOrItemCode ?? null,
      input.description,
      input.salesOrderNumber ?? null,
      input.b2bBranchSchool ?? null,
      input.schoolContactPerson ?? null,
      input.schoolContactNumber ?? null,
      input.customerNumber ?? null,
    ],
  );
  return result.rows[0];
}

export async function findComplaintById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<ComplaintRecord | null> {
  const result = await client.query<ComplaintRecord>(
    `SELECT ${complaintColumns}
     FROM complaints
     WHERE complaints.id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listComplaints(
  client: PoolClient,
  query: ComplaintListQuery,
): Promise<ComplaintListResult> {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (query.status) filters.push(`complaints.status = ${add(query.status)}`);
  if (query.region) filters.push(`complaints.region = ${add(query.region)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(`(
      complaints.complaint_reference ILIKE ${parameter}
      OR complaints.customer_name ILIKE ${parameter}
      OR complaints.contact_number ILIKE ${parameter}
      OR complaints.description ILIKE ${parameter}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM complaints ${where}`,
    values,
  );
  const offset = (query.page - 1) * query.pageSize;
  const limitParameter = add(query.pageSize);
  const offsetParameter = add(offset);
  const result = await client.query<ComplaintRecord>(
    `SELECT ${complaintColumns}
     FROM complaints
     ${where}
     ORDER BY complaints.submitted_at DESC, complaints.id DESC
     LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export async function updateComplaintNotes(
  client: PoolClient,
  id: string,
  notes: ComplaintNotesInput,
  profileId: string,
): Promise<ComplaintRecord | null> {
  const result = await client.query<ComplaintRecord>(
    `UPDATE complaints
     SET cce_notes = CASE WHEN $2::boolean THEN $3 ELSE cce_notes END,
         warranty_classification = CASE WHEN $4::boolean THEN NULLIF($5, '') ELSE warranty_classification END,
         updated_by = $6, updated_at = now()
     WHERE id = $1
     RETURNING ${complaintColumns}`,
    [
      id,
      notes.notes !== undefined,
      notes.notes ?? null,
      notes.warrantyClassification !== undefined,
      notes.warrantyClassification ?? null,
      profileId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateComplaintB2bBranchLink(
  client: PoolClient,
  id: string,
  custCode: string | null,
  branchName: string | null,
  profileId: string,
): Promise<ComplaintRecord | null> {
  // Linking (custCode set) overwrites the free-text branch name with the
  // master list's canonical spelling; unlinking (custCode null) only clears
  // the link and leaves whatever text is already on the complaint alone.
  const result = await client.query<ComplaintRecord>(
    `UPDATE complaints
     SET b2b_branch_cust_code = $2,
         b2b_branch_school = COALESCE($3, b2b_branch_school),
         updated_by = $4,
         updated_at = now()
     WHERE id = $1
     RETURNING ${complaintColumns}`,
    [id, custCode, branchName, profileId],
  );
  return result.rows[0] ?? null;
}

export async function updateComplaintStatus(
  client: PoolClient,
  id: string,
  input: ComplaintStatusUpdateInput,
  profileId: string,
): Promise<{ complaint: ComplaintRecord; previousStatus: ComplaintStatus } | null> {
  const current = await client.query<{ status: ComplaintStatus }>(
    'SELECT status FROM complaints WHERE id = $1 FOR UPDATE',
    [id],
  );
  const previousStatus = current.rows[0]?.status;
  if (!previousStatus) return null;

  const result = await client.query<ComplaintRecord>(
    `UPDATE complaints
     SET status = $2, updated_by = $3, updated_at = now()
     WHERE id = $1
     RETURNING ${complaintColumns}`,
    [id, input.status, profileId],
  );
  return { complaint: result.rows[0], previousStatus };
}

export async function insertComplaintHistory(
  client: PoolClient,
  complaintId: string,
  fromStatus: ComplaintStatus | null,
  toStatus: ComplaintStatus,
  changedBy: string | null,
  reason?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO complaint_status_history (complaint_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [complaintId, fromStatus, toStatus, changedBy, reason ?? null],
  );
}

export async function listComplaintHistory(
  client: PoolClient,
  complaintId: string,
): Promise<ComplaintHistoryRecord[]> {
  const result = await client.query<ComplaintHistoryRecord>(
    `SELECT
       id,
       from_status AS "fromStatus",
       to_status AS "toStatus",
       changed_by AS "changedBy",
       reason,
       changed_at AS "changedAt"
     FROM complaint_status_history
     WHERE complaint_id = $1
     ORDER BY changed_at ASC, id ASC`,
    [complaintId],
  );
  return result.rows;
}
