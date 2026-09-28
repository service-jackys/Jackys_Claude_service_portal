import type { PoolClient } from 'pg';
import type { JobCardPart } from '../../contracts/src/index.js';

export type InspectionRecord = {
  id: string;
  inspectionReference: string;
  appointmentId: string | null;
  inspectionDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  visualFindings: string | null;
  technicalDiagnosis: string | null;
  products: JobCardPart[];
  faultyParts: JobCardPart[];
  recommendedAction: string | null;
  refQuotationNo: string | null;
  warrantyStatus: string | null;
  estRepairCost: string | null;
  inspectedBy: string | null;
  inspectedDate: string | null;
  reviewedBy: string | null;
  reviewedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
  legacyReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type InspectionContent = {
  appointmentId: string | null;
  inspectionDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  visualFindings: string | null;
  technicalDiagnosis: string | null;
  products: JobCardPart[];
  faultyParts: JobCardPart[];
  recommendedAction: string | null;
  refQuotationNo: string | null;
  warrantyStatus: string | null;
  estRepairCost: number | null;
  inspectedBy: string | null;
  inspectedDate: string | null;
  reviewedBy: string | null;
  reviewedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
  legacyReference: string | null;
};

const columns = `
  id,
  inspection_reference AS "inspectionReference",
  appointment_id AS "appointmentId",
  inspection_date::text AS "inspectionDate",
  customer_name AS "customerName",
  contact_number AS "contactNumber",
  project_name AS "projectName",
  site_location AS "siteLocation",
  date_of_collection::text AS "dateOfCollection",
  technician_name AS "technicianName",
  customer_complaint AS "customerComplaint",
  visual_findings AS "visualFindings",
  technical_diagnosis AS "technicalDiagnosis",
  products,
  faulty_parts AS "faultyParts",
  recommended_action AS "recommendedAction",
  ref_quotation_no AS "refQuotationNo",
  warranty_status AS "warrantyStatus",
  est_repair_cost AS "estRepairCost",
  inspected_by AS "inspectedBy",
  inspected_date::text AS "inspectedDate",
  reviewed_by AS "reviewedBy",
  reviewed_date::text AS "reviewedDate",
  customer_signature AS "customerSignature",
  signature_date::text AS "signatureDate",
  legacy_reference AS "legacyReference",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertInspection(
  client: PoolClient,
  input: { inspectionReference: string; createdBy: string; content: InspectionContent },
): Promise<InspectionRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO inspections (
       inspection_reference, appointment_id, inspection_date, customer_name, contact_number,
       project_name, site_location, date_of_collection, technician_name, customer_complaint,
       visual_findings, technical_diagnosis, products, faulty_parts, recommended_action,
       ref_quotation_no, warranty_status, est_repair_cost,
       inspected_by, inspected_date, reviewed_by, reviewed_date,
       customer_signature, signature_date, legacy_reference, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17, $18,
       $19, $20, $21, $22,
       $23, $24, $25, $26, $26
     )
     RETURNING id`,
    [
      input.inspectionReference,
      c.appointmentId,
      c.inspectionDate,
      c.customerName,
      c.contactNumber,
      c.projectName,
      c.siteLocation,
      c.dateOfCollection,
      c.technicianName,
      c.customerComplaint,
      c.visualFindings,
      c.technicalDiagnosis,
      JSON.stringify(c.products),
      JSON.stringify(c.faultyParts),
      c.recommendedAction,
      c.refQuotationNo,
      c.warrantyStatus,
      c.estRepairCost,
      c.inspectedBy,
      c.inspectedDate,
      c.reviewedBy,
      c.reviewedDate,
      c.customerSignature,
      c.signatureDate,
      c.legacyReference,
      input.createdBy,
    ],
  );
  const inspection = await findInspectionById(client, result.rows[0].id);
  if (!inspection) throw new Error('The created inspection could not be loaded.');
  return inspection;
}

export async function updateInspection(
  client: PoolClient,
  id: string,
  content: InspectionContent,
  profileId: string,
): Promise<InspectionRecord | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE inspections
     SET appointment_id = $2, inspection_date = $3, customer_name = $4, contact_number = $5,
         project_name = $6, site_location = $7, date_of_collection = $8, technician_name = $9,
         customer_complaint = $10, visual_findings = $11, technical_diagnosis = $12,
         products = $13, faulty_parts = $14, recommended_action = $15, ref_quotation_no = $16,
         warranty_status = $17, est_repair_cost = $18, inspected_by = $19, inspected_date = $20,
         reviewed_by = $21, reviewed_date = $22, customer_signature = $23, signature_date = $24,
         legacy_reference = $25, updated_by = $26, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      content.appointmentId,
      content.inspectionDate,
      content.customerName,
      content.contactNumber,
      content.projectName,
      content.siteLocation,
      content.dateOfCollection,
      content.technicianName,
      content.customerComplaint,
      content.visualFindings,
      content.technicalDiagnosis,
      JSON.stringify(content.products),
      JSON.stringify(content.faultyParts),
      content.recommendedAction,
      content.refQuotationNo,
      content.warrantyStatus,
      content.estRepairCost,
      content.inspectedBy,
      content.inspectedDate,
      content.reviewedBy,
      content.reviewedDate,
      content.customerSignature,
      content.signatureDate,
      content.legacyReference,
      profileId,
    ],
  );
  if (!result.rows[0]) return null;
  return findInspectionById(client, result.rows[0].id);
}

export async function findInspectionById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<InspectionRecord | null> {
  const result = await client.query<InspectionRecord>(
    `SELECT ${columns} FROM inspections WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listInspections(
  client: PoolClient,
  query: { search?: string; appointmentId?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.appointmentId) filters.push(`appointment_id = ${add(query.appointmentId)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(inspection_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR project_name ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM inspections ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<InspectionRecord>(
    `SELECT ${columns} FROM inspections ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
