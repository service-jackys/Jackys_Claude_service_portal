import type { PoolClient } from 'pg';
import type { JobCardPart } from '../../contracts/src/index.js';

export type QuotationRecord = {
  id: string;
  quotationReference: string;
  appointmentId: string | null;
  quotationDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  technicalDiagnosis: string | null;
  products: JobCardPart[];
  parts: JobCardPart[];
  labourAmount: string;
  grandTotal: string;
  preparedBy: string | null;
  preparedDate: string | null;
  approvedBy: string | null;
  approvedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type QuotationContent = {
  appointmentId: string | null;
  quotationDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  technicalDiagnosis: string | null;
  products: JobCardPart[];
  parts: JobCardPart[];
  labourAmount: number;
  grandTotal: number;
  preparedBy: string | null;
  preparedDate: string | null;
  approvedBy: string | null;
  approvedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
};

const columns = `
  id,
  quotation_reference AS "quotationReference",
  appointment_id AS "appointmentId",
  quotation_date::text AS "quotationDate",
  customer_name AS "customerName",
  contact_number AS "contactNumber",
  project_name AS "projectName",
  site_location AS "siteLocation",
  date_of_collection::text AS "dateOfCollection",
  technician_name AS "technicianName",
  customer_complaint AS "customerComplaint",
  technical_diagnosis AS "technicalDiagnosis",
  products,
  parts,
  labour_amount AS "labourAmount",
  grand_total AS "grandTotal",
  prepared_by AS "preparedBy",
  prepared_date::text AS "preparedDate",
  approved_by AS "approvedBy",
  approved_date::text AS "approvedDate",
  customer_signature AS "customerSignature",
  signature_date::text AS "signatureDate",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertQuotation(
  client: PoolClient,
  input: { quotationReference: string; createdBy: string; content: QuotationContent },
): Promise<QuotationRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO quotations (
       quotation_reference, appointment_id, quotation_date, customer_name, contact_number,
       project_name, site_location, date_of_collection, technician_name, customer_complaint,
       technical_diagnosis, products, parts, labour_amount, grand_total,
       prepared_by, prepared_date, approved_by, approved_date, customer_signature, signature_date,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21,
       $22, $22
     )
     RETURNING id`,
    [
      input.quotationReference,
      c.appointmentId,
      c.quotationDate,
      c.customerName,
      c.contactNumber,
      c.projectName,
      c.siteLocation,
      c.dateOfCollection,
      c.technicianName,
      c.customerComplaint,
      c.technicalDiagnosis,
      JSON.stringify(c.products),
      JSON.stringify(c.parts),
      c.labourAmount,
      c.grandTotal,
      c.preparedBy,
      c.preparedDate,
      c.approvedBy,
      c.approvedDate,
      c.customerSignature,
      c.signatureDate,
      input.createdBy,
    ],
  );
  const quotation = await findQuotationById(client, result.rows[0].id);
  if (!quotation) throw new Error('The created quotation could not be loaded.');
  return quotation;
}

export async function updateQuotation(
  client: PoolClient,
  id: string,
  content: QuotationContent,
  profileId: string,
): Promise<QuotationRecord | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE quotations
     SET appointment_id = $2, quotation_date = $3, customer_name = $4, contact_number = $5,
         project_name = $6, site_location = $7, date_of_collection = $8, technician_name = $9,
         customer_complaint = $10, technical_diagnosis = $11, products = $12, parts = $13,
         labour_amount = $14, grand_total = $15, prepared_by = $16, prepared_date = $17,
         approved_by = $18, approved_date = $19, customer_signature = $20, signature_date = $21,
         updated_by = $22, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      content.appointmentId,
      content.quotationDate,
      content.customerName,
      content.contactNumber,
      content.projectName,
      content.siteLocation,
      content.dateOfCollection,
      content.technicianName,
      content.customerComplaint,
      content.technicalDiagnosis,
      JSON.stringify(content.products),
      JSON.stringify(content.parts),
      content.labourAmount,
      content.grandTotal,
      content.preparedBy,
      content.preparedDate,
      content.approvedBy,
      content.approvedDate,
      content.customerSignature,
      content.signatureDate,
      profileId,
    ],
  );
  if (!result.rows[0]) return null;
  return findQuotationById(client, result.rows[0].id);
}

export async function findQuotationById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<QuotationRecord | null> {
  const result = await client.query<QuotationRecord>(
    `SELECT ${columns} FROM quotations WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listQuotations(
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
      `(quotation_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR project_name ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM quotations ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<QuotationRecord>(
    `SELECT ${columns} FROM quotations ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
