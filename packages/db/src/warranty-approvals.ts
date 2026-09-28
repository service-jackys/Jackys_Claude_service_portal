import type { PoolClient } from 'pg';
import type { WarrantyApprovalStatus } from '../../contracts/src/index.js';

export type WarrantyApprovalRecord = {
  id: string;
  approvalReference: string;
  jobCardId: string | null;
  jobCardReference: string | null;
  inspectionId: string | null;
  inspectionReference: string | null;
  customerName: string | null;
  contactNumber: string | null;
  itemDescription: string | null;
  warrantyStatus: string | null;
  estimatedCost: string | null;
  notes: string | null;
  status: WarrantyApprovalStatus;
  accessToken: string;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

const columns = `
  warranty_approvals.id,
  warranty_approvals.approval_reference AS "approvalReference",
  warranty_approvals.job_card_id AS "jobCardId",
  service_job_cards.job_card_reference AS "jobCardReference",
  warranty_approvals.inspection_id AS "inspectionId",
  inspections.inspection_reference AS "inspectionReference",
  warranty_approvals.customer_name AS "customerName",
  warranty_approvals.contact_number AS "contactNumber",
  warranty_approvals.item_description AS "itemDescription",
  warranty_approvals.warranty_status AS "warrantyStatus",
  warranty_approvals.estimated_cost AS "estimatedCost",
  warranty_approvals.notes,
  warranty_approvals.status,
  warranty_approvals.access_token AS "accessToken",
  warranty_approvals.decided_at AS "decidedAt",
  warranty_approvals.decided_by_name AS "decidedByName",
  warranty_approvals.decision_notes AS "decisionNotes",
  warranty_approvals.created_at AS "createdAt",
  warranty_approvals.updated_at AS "updatedAt",
  warranty_approvals.created_by AS "createdBy",
  warranty_approvals.updated_by AS "updatedBy"
`;

const from = `
  FROM warranty_approvals
  LEFT JOIN service_job_cards ON service_job_cards.id = warranty_approvals.job_card_id
  LEFT JOIN inspections ON inspections.id = warranty_approvals.inspection_id
`;

export async function insertWarrantyApproval(
  client: PoolClient,
  input: {
    approvalReference: string;
    jobCardId: string | null;
    inspectionId: string | null;
    customerName: string | null;
    contactNumber: string | null;
    itemDescription: string | null;
    warrantyStatus: string | null;
    estimatedCost: number | null;
    notes: string | null;
    accessToken: string;
    createdBy: string;
  },
): Promise<WarrantyApprovalRecord> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO warranty_approvals (
       approval_reference, job_card_id, inspection_id, customer_name, contact_number,
       item_description, warranty_status, estimated_cost, notes, access_token,
       created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     RETURNING id`,
    [
      input.approvalReference,
      input.jobCardId,
      input.inspectionId,
      input.customerName,
      input.contactNumber,
      input.itemDescription,
      input.warrantyStatus,
      input.estimatedCost,
      input.notes,
      input.accessToken,
      input.createdBy,
    ],
  );
  const approval = await findWarrantyApprovalById(client, result.rows[0].id);
  if (!approval) throw new Error('The created warranty approval could not be loaded.');
  return approval;
}

export async function findWarrantyApprovalById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<WarrantyApprovalRecord | null> {
  const result = await client.query<WarrantyApprovalRecord>(
    `SELECT ${columns} ${from} WHERE warranty_approvals.id = $1 ${forUpdate ? 'FOR UPDATE OF warranty_approvals' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findWarrantyApprovalByToken(
  client: PoolClient,
  accessToken: string,
  forUpdate = false,
): Promise<WarrantyApprovalRecord | null> {
  const result = await client.query<WarrantyApprovalRecord>(
    `SELECT ${columns} ${from} WHERE warranty_approvals.access_token = $1 ${forUpdate ? 'FOR UPDATE OF warranty_approvals' : ''}`,
    [accessToken],
  );
  return result.rows[0] ?? null;
}

export async function recordWarrantyApprovalDecision(
  client: PoolClient,
  id: string,
  decision: {
    status: 'Approved' | 'Declined';
    decidedByName: string;
    decisionNotes: string | null;
  },
): Promise<WarrantyApprovalRecord | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE warranty_approvals
     SET status = $2, decided_at = now(), decided_by_name = $3, decision_notes = $4, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, decision.status, decision.decidedByName, decision.decisionNotes],
  );
  if (!result.rows[0]) return null;
  return findWarrantyApprovalById(client, result.rows[0].id);
}

export async function listWarrantyApprovals(
  client: PoolClient,
  query: { status?: string; search?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.status) filters.push(`warranty_approvals.status = ${add(query.status)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(warranty_approvals.approval_reference ILIKE ${parameter} OR warranty_approvals.customer_name ILIKE ${parameter} OR warranty_approvals.contact_number ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total ${from} ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<WarrantyApprovalRecord>(
    `SELECT ${columns} ${from} ${where}
     ORDER BY warranty_approvals.updated_at DESC, warranty_approvals.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
