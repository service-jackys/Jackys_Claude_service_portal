import type { PoolClient } from 'pg';
import type { QuotationCharge, QuotationUnit } from '../../contracts/src/index.js';

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
  warrantyStatus: string | null;
  customerType: string | null;
  b2bBranchSchool: string | null;
  quotationStatus: string;
  // Units on the quotation, and how many of them already have a service job card.
  unitCount: number;
  jobCardCount: number;
  products: QuotationUnit[];
  parts: QuotationCharge[];
  labourAmount: string;
  vatRate: string;
  subtotalAmount: string;
  vatAmount: string;
  grandTotal: string;
  preparedBy: string | null;
  preparedDate: string | null;
  approvedBy: string | null;
  approvedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
  legacyReference: string | null;
  // Newest out-of-warranty approval request raised against this quotation.
  approvalId: string | null;
  approvalReference: string | null;
  approvalStatus: string | null;
  approvalMethod: string | null;
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
  warrantyStatus: string | null;
  customerType: string | null;
  b2bBranchSchool: string | null;
  quotationStatus: string;
  products: QuotationUnit[];
  parts: QuotationCharge[];
  labourAmount: number;
  vatRate: number;
  subtotalAmount: number;
  vatAmount: number;
  grandTotal: number;
  preparedBy: string | null;
  preparedDate: string | null;
  approvedBy: string | null;
  approvedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
  legacyReference: string | null;
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
  warranty_status AS "warrantyStatus",
  customer_type AS "customerType",
  b2b_branch_school AS "b2bBranchSchool",
  quotation_status AS "quotationStatus",
  jsonb_array_length(products)::int AS "unitCount",
  (CASE
     WHEN EXISTS (SELECT 1 FROM service_job_cards sjc
                  WHERE sjc.quotation_id = quotations.id AND sjc.quotation_unit_key = '')
       THEN GREATEST(jsonb_array_length(products), 1)
     ELSE (SELECT count(*) FROM service_job_cards sjc WHERE sjc.quotation_id = quotations.id)
   END)::int AS "jobCardCount",
  (SELECT wa.id FROM warranty_approvals wa WHERE wa.quotation_id = quotations.id
    ORDER BY wa.created_at DESC, wa.id DESC LIMIT 1) AS "approvalId",
  (SELECT wa.approval_reference FROM warranty_approvals wa WHERE wa.quotation_id = quotations.id
    ORDER BY wa.created_at DESC, wa.id DESC LIMIT 1) AS "approvalReference",
  (SELECT wa.status FROM warranty_approvals wa WHERE wa.quotation_id = quotations.id
    ORDER BY wa.created_at DESC, wa.id DESC LIMIT 1) AS "approvalStatus",
  (SELECT wa.decision_method FROM warranty_approvals wa WHERE wa.quotation_id = quotations.id
    ORDER BY wa.created_at DESC, wa.id DESC LIMIT 1) AS "approvalMethod",
  products,
  parts,
  labour_amount AS "labourAmount",
  vat_rate AS "vatRate",
  subtotal_amount AS "subtotalAmount",
  vat_amount AS "vatAmount",
  grand_total AS "grandTotal",
  prepared_by AS "preparedBy",
  prepared_date::text AS "preparedDate",
  approved_by AS "approvedBy",
  approved_date::text AS "approvedDate",
  customer_signature AS "customerSignature",
  signature_date::text AS "signatureDate",
  legacy_reference AS "legacyReference",
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
       legacy_reference, warranty_status, created_by, updated_by, vat_rate, subtotal_amount, vat_amount,
       customer_type, b2b_branch_school, quotation_status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21,
       $22, $23, $24, $24, $25, $26, $27, $28, $29, $30
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
      c.legacyReference,
      c.warrantyStatus,
      input.createdBy,
      c.vatRate,
      c.subtotalAmount,
      c.vatAmount,
      c.customerType,
      c.b2bBranchSchool,
      c.quotationStatus,
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
         legacy_reference = $22, warranty_status = $23, updated_by = $24, updated_at = now(),
         vat_rate = $25, subtotal_amount = $26, vat_amount = $27,
         customer_type = $28, b2b_branch_school = $29, quotation_status = $30
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
      content.legacyReference,
      content.warrantyStatus,
      profileId,
      content.vatRate,
      content.subtotalAmount,
      content.vatAmount,
      content.customerType,
      content.b2bBranchSchool,
      content.quotationStatus,
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
  query: {
    search?: string;
    appointmentId?: string;
    // "Unused" = no service job card has been created from this quotation
    // yet -- see migrations/014_job_card_quotation_source.sql and
    // modification.md #18. Used by the "create job card from Quotation"
    // picker to exclude quotations already converted.
    unused?: boolean;
    quotationStatus?: string;
    customerType?: string;
    page: number;
    pageSize: number;
  },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.appointmentId) filters.push(`appointment_id = ${add(query.appointmentId)}`);
  if (query.unused) {
    filters.push(
      `(CASE WHEN EXISTS (SELECT 1 FROM service_job_cards sjc WHERE sjc.quotation_id = quotations.id AND sjc.quotation_unit_key = '') THEN GREATEST(jsonb_array_length(products), 1) ELSE (SELECT count(*) FROM service_job_cards sjc WHERE sjc.quotation_id = quotations.id) END) < GREATEST(jsonb_array_length(products), 1)`,
    );
  }
  if (query.quotationStatus) filters.push(`quotation_status = ${add(query.quotationStatus)}`);
  if (query.customerType) filters.push(`customer_type = ${add(query.customerType)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(quotation_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR project_name ILIKE ${parameter} OR b2b_branch_school ILIKE ${parameter})`,
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

// LPO pending: quotations still Pending or Approved that have no service job card yet, by quotation
// date. Value is the subtotal excluding VAT, so it can sit beside revenue. It is shown to management
// as visibility only and is never added to revenue.
export async function quotationsLpoPending(
  client: PoolClient,
  filter: { year?: string; month?: string },
) {
  const values: unknown[] = [];
  const where = [
    `quotation_status IN ('Pending', 'Approved')`,
    `NOT EXISTS (SELECT 1 FROM service_job_cards sjc WHERE sjc.quotation_id = quotations.id)`,
  ];
  if (filter.year) {
    values.push(Number(filter.year));
    where.push(`EXTRACT(YEAR FROM quotation_date) = $${values.length}`);
  }
  if (filter.month) {
    values.push(Number(filter.month));
    where.push(`EXTRACT(MONTH FROM quotation_date) = $${values.length}`);
  }
  const result = await client.query(
    `SELECT quotation_status AS "status", count(*)::int AS "count",
            COALESCE(sum(subtotal_amount), 0)::float8 AS "total"
     FROM quotations WHERE ${where.join(' AND ')} GROUP BY quotation_status`,
    values,
  );
  const byStatus: Record<string, { count: number; total: number }> = {
    Pending: { count: 0, total: 0 },
    Approved: { count: 0, total: 0 },
  };
  for (const row of result.rows) byStatus[row.status] = { count: row.count, total: row.total };
  return {
    count: byStatus.Pending.count + byStatus.Approved.count,
    total: Math.round((byStatus.Pending.total + byStatus.Approved.total) * 100) / 100,
    byStatus,
  };
}
