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
  erpStatus: string;
  erpInvoiceNo: string;
  invoicedAt: string | null;
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
  erpStatus: string;
  erpInvoiceNo: string;
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
  erp_status AS "erpStatus",
  erp_invoice_no AS "erpInvoiceNo",
  invoiced_at::text AS "invoicedAt",
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
       customer_type, b2b_branch_school, quotation_status, erp_status, erp_invoice_no
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21,
       $22, $23, $24, $24, $25, $26, $27, $28, $29, $30, $31, $32
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
      c.erpStatus,
      c.erpInvoiceNo,
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
         customer_type = $28, b2b_branch_school = $29, quotation_status = $30, erp_status = $31, erp_invoice_no = $32
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
      content.erpStatus,
      content.erpInvoiceNo,
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
    erpStatus?: string;
    customerType?: string;
    // Quotation month as YYYY-MM (the Records > Quotations month filter).
    month?: string;
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
  if (query.erpStatus) filters.push(`erp_status = ${add(query.erpStatus)}`);
  if (query.customerType) filters.push(`customer_type = ${add(query.customerType)}`);
  if (query.month) filters.push(`to_char(quotation_date, 'YYYY-MM') = ${add(query.month)}`);
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(quotation_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR project_name ILIKE ${parameter} OR b2b_branch_school ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  // The count and the money total cover every quotation that matches, not only the page shown.
  const count = await client.query<{ total: string; amount: string; subtotal: string }>(
    `SELECT count(*)::text AS total, COALESCE(sum(grand_total), 0)::text AS amount,
            COALESCE(sum(subtotal_amount), 0)::text AS subtotal
     FROM quotations ${where}`,
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
  return {
    items: result.rows,
    total: Number(count.rows[0].total),
    totalAmount: Math.round(Number(count.rows[0].amount) * 100) / 100,
    totalSubtotal: Math.round(Number(count.rows[0].subtotal) * 100) / 100,
  };
}

/** Months that have quotations (newest first), for the month filter and the report picker. */
export async function listQuotationMonths(client: PoolClient) {
  const result = await client.query<{ month: string; count: number }>(
    `SELECT to_char(quotation_date, 'YYYY-MM') AS month, count(*)::int AS count
     FROM quotations WHERE quotation_date IS NOT NULL
     GROUP BY 1 ORDER BY 1 DESC`,
  );
  return result.rows;
}

// LPO pending: Pending or Approved quotations still waiting to be invoiced in ERP / ORION.
// A quotation stays pending (carried forward) from its quotation month until it is marked
// Invoiced, so management does not lose track of it. For a selected month the figure is the
// position at that month's end: dated on or before it, and not yet invoiced by then (invoiced_at
// is stamped when the status becomes Invoiced; a blank invoiced_at is a legacy Invoiced quotation
// and never counts). With only a year, or no filter, it is what is open now. Quotation status
// Rejected is left out. The value is the subtotal excluding VAT. It is shown to management as
// visibility only and is never added to revenue.
function lpoScope(filter: { year?: string; month?: string }) {
  const values: unknown[] = [];
  const where = [`quotation_status IN ('Pending', 'Approved')`];
  let raisedExpr = 'TRUE';
  let asOfExpr = `(now() AT TIME ZONE 'Asia/Dubai')::date`;
  if (filter.year && filter.month) {
    values.push(Number(filter.year), Number(filter.month));
    const first = `make_date($1::int, $2::int, 1)`;
    const end = `(${first} + interval '1 month - 1 day')::date`;
    where.push(
      `quotation_date <= ${end}`,
      `(erp_status = 'Pending invoice' OR (erp_status = 'Invoiced' AND invoiced_at > ${end}))`,
    );
    raisedExpr = `quotation_date >= ${first}`;
    asOfExpr = `LEAST(${end}, (now() AT TIME ZONE 'Asia/Dubai')::date)`;
  } else {
    where.push(`erp_status = 'Pending invoice'`);
    if (filter.year) {
      values.push(Number(filter.year));
      where.push(`EXTRACT(YEAR FROM quotation_date) = $${values.length}`);
    }
    if (filter.month) {
      values.push(Number(filter.month));
      where.push(`EXTRACT(MONTH FROM quotation_date) = $${values.length}`);
    }
  }
  return { values, where, raisedExpr, asOfExpr };
}

export async function quotationsLpoPending(
  client: PoolClient,
  filter: { year?: string; month?: string },
) {
  const { values, where, raisedExpr, asOfExpr } = lpoScope(filter);
  const result = await client.query(
    `SELECT quotation_status AS "status", count(*)::int AS "count",
            COALESCE(sum(subtotal_amount), 0)::float8 AS "total",
            count(*) FILTER (WHERE ${raisedExpr})::int AS "raisedCount",
            COALESCE(sum(subtotal_amount) FILTER (WHERE ${raisedExpr}), 0)::float8 AS "raisedTotal",
            max(${asOfExpr} - quotation_date)::int AS "oldestDays"
     FROM quotations WHERE ${where.join(' AND ')} GROUP BY quotation_status`,
    values,
  );
  const byStatus: Record<string, { count: number; total: number }> = {
    Pending: { count: 0, total: 0 },
    Approved: { count: 0, total: 0 },
  };
  let raisedCount = 0;
  let raisedTotal = 0;
  let oldestDays = 0;
  for (const row of result.rows) {
    byStatus[row.status] = { count: row.count, total: row.total };
    raisedCount += row.raisedCount;
    raisedTotal += row.raisedTotal;
    oldestDays = Math.max(oldestDays, row.oldestDays ?? 0);
  }
  const count = byStatus.Pending.count + byStatus.Approved.count;
  const total = byStatus.Pending.total + byStatus.Approved.total;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    count,
    total: round2(total),
    byStatus,
    raisedCount,
    raisedTotal: round2(raisedTotal),
    carriedCount: count - raisedCount,
    carriedTotal: round2(total - raisedTotal),
    oldestDays: count - raisedCount > 0 ? oldestDays : 0,
  };
}

// The date the LPO pending position is as at: the end of the chosen month, or today if that is earlier.
function lpoAsAt(filter: { year?: string; month?: string }) {
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  if (!(filter.year && filter.month)) return today;
  const end = new Date(Date.UTC(Number(filter.year), Number(filter.month), 0))
    .toISOString()
    .slice(0, 10);
  return end < today ? end : today;
}

// LPO pending in detail, for the Management summary of the weekly ROI: the same position as
// quotationsLpoPending, broken down by the month each quotation was created, plus the oldest
// quotations to follow up (up to `limit`; moreCount is how many more there are).
export async function quotationsLpoPendingDetail(
  client: PoolClient,
  filter: { year?: string; month?: string },
  limit = 8,
) {
  const summary = await quotationsLpoPending(client, filter);
  const { values, where, asOfExpr } = lpoScope(filter);
  const byMonth = await client.query(
    `SELECT to_char(quotation_date, 'YYYY-MM') AS "period", count(*)::int AS "count",
            count(*) FILTER (WHERE quotation_status = 'Approved')::int AS "approved",
            COALESCE(sum(subtotal_amount), 0)::float8 AS "total",
            GREATEST(max(${asOfExpr} - quotation_date), 0)::int AS "oldestDays"
     FROM quotations WHERE ${where.join(' AND ')} AND quotation_date IS NOT NULL
     GROUP BY 1 ORDER BY 1`,
    values,
  );
  const items = await client.query(
    `SELECT quotation_reference AS "reference", customer_name AS "customer",
            quotation_date::text AS "date", quotation_status AS "status",
            GREATEST(${asOfExpr} - quotation_date, 0)::int AS "days",
            COALESCE(subtotal_amount, 0)::float8 AS "subtotal"
     FROM quotations WHERE ${where.join(' AND ')} AND quotation_date IS NOT NULL
     ORDER BY quotation_date, id LIMIT ${Math.max(1, Math.floor(limit))}`,
    values,
  );
  return {
    ...summary,
    asAt: lpoAsAt(filter),
    byMonth: byMonth.rows.map((r) => ({ ...r, total: Math.round(r.total * 100) / 100 })),
    items: items.rows.map((r) => ({ ...r, subtotal: Math.round(r.subtotal * 100) / 100 })),
    moreCount: Math.max(0, summary.count - items.rows.length),
  };
}

// LPO pending for every month, for the Budget vs Actual chart. Each month shows the position at
// its end (same carry-forward rule as quotationsLpoPending): quotations dated on or before the
// month that were not yet invoiced by then. "raised" is the part dated in that month; the rest was
// carried forward from earlier months.
export async function quotationsLpoPendingByMonth(client: PoolClient) {
  const result = await client.query(
    `WITH cand AS (
       SELECT quotation_date, quotation_status, subtotal_amount, erp_status, invoiced_at
       FROM quotations
       WHERE quotation_status IN ('Pending', 'Approved') AND quotation_date IS NOT NULL
         AND (erp_status = 'Pending invoice' OR (erp_status = 'Invoiced' AND invoiced_at IS NOT NULL))
     ),
     months AS (
       SELECT generate_series(
         date_trunc('month', (SELECT min(quotation_date) FROM cand))::date,
         GREATEST(date_trunc('month', (now() AT TIME ZONE 'Asia/Dubai'))::date,
                  date_trunc('month', (SELECT max(quotation_date) FROM cand))::date),
         interval '1 month')::date AS m
     )
     SELECT to_char(m, 'YYYY-MM') AS "period",
            count(*)::int AS "count",
            COALESCE(sum(c.subtotal_amount), 0)::float8 AS "total",
            count(*) FILTER (WHERE c.quotation_status = 'Approved')::int AS "approved",
            count(*) FILTER (WHERE c.quotation_date >= m)::int AS "raisedCount",
            COALESCE(sum(c.subtotal_amount) FILTER (WHERE c.quotation_date >= m), 0)::float8 AS "raisedTotal",
            COALESCE(max(LEAST((m + interval '1 month - 1 day')::date,
                               (now() AT TIME ZONE 'Asia/Dubai')::date) - c.quotation_date)
                     FILTER (WHERE c.quotation_date < m), 0)::int AS "oldestDays"
     FROM months
     JOIN cand c ON c.quotation_date <= (m + interval '1 month - 1 day')::date
       AND (c.erp_status = 'Pending invoice'
            OR c.invoiced_at > (m + interval '1 month - 1 day')::date)
     GROUP BY m ORDER BY m`,
  );
  return result.rows.map((r) => ({
    period: r.period as string,
    count: r.count as number,
    total: Math.round(r.total * 100) / 100,
    approved: r.approved as number,
    raisedCount: r.raisedCount as number,
    raisedTotal: Math.round(r.raisedTotal * 100) / 100,
    carriedCount: (r.count - r.raisedCount) as number,
    carriedTotal: Math.round((r.total - r.raisedTotal) * 100) / 100,
    oldestDays: r.oldestDays as number,
  }));
}

// Invoice check: quotations marked Invoiced against the invoice numbers (inv_del_no) in the active
// master workbook. A quotation with an invoice number is "matched" when that number is in the
// workbook, "waiting" while it is within the grace days of being marked Invoiced, and "missing"
// after that. Quotations Invoiced before the invoice number existed are counted as legacy and not
// checked. matched rows also carry the workbook amount, flagged when it differs from the quotation
// subtotal (excl. VAT) by more than the tolerance.
export async function quotationsInvoiceCheck(
  client: PoolClient,
  options: { graceDays: number; tolerance?: number },
) {
  const tolerance = options.tolerance ?? 1;
  const result = await client.query(
    `WITH batch AS (
       SELECT id FROM revenue_import_batches
       WHERE kind = 'revenue' AND is_active ORDER BY uploaded_at DESC LIMIT 1
     ),
     master AS (
       SELECT upper(btrim(l.inv_del_no)) AS inv, COALESCE(sum(l.revenue), 0)::float8 AS revenue
       FROM revenue_lines l JOIN batch b ON b.id = l.batch_id
       WHERE btrim(COALESCE(l.inv_del_no, '')) <> ''
       GROUP BY 1
     )
     SELECT q.id::text AS "id", q.quotation_reference AS "reference", q.customer_name AS "customer",
            q.erp_invoice_no AS "invoiceNo", q.subtotal_amount::float8 AS "subtotal",
            q.invoiced_at::text AS "invoicedAt", q.updated_by::text AS "markedBy",
            (SELECT p.display_name FROM profiles p WHERE p.id = q.updated_by) AS "markedByName",
            ((now() AT TIME ZONE 'Asia/Dubai')::date - q.invoiced_at)::int AS "daysSince",
            m.revenue AS "masterRevenue", (m.inv IS NOT NULL) AS "found",
            (SELECT count(*) FROM batch)::int AS "hasBatch"
     FROM quotations q LEFT JOIN master m ON m.inv = upper(btrim(q.erp_invoice_no))
     WHERE q.erp_status = 'Invoiced' AND q.erp_invoice_no <> ''
     ORDER BY q.invoiced_at NULLS LAST, q.id`,
  );
  const legacy = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM quotations WHERE erp_status = 'Invoiced' AND erp_invoice_no = ''`,
  );
  const hasBatch = result.rows.length ? result.rows[0].hasBatch > 0 : null;
  const rows = result.rows.map((r) => {
    const days = r.daysSince ?? 0;
    let state: 'matched' | 'waiting' | 'missing' = 'matched';
    if (!r.found) state = days > options.graceDays ? 'missing' : 'waiting';
    const difference = r.found ? Math.round((r.masterRevenue - r.subtotal) * 100) / 100 : null;
    return {
      id: r.id as string,
      reference: r.reference as string,
      customer: r.customer as string | null,
      invoiceNo: r.invoiceNo as string,
      subtotal: Math.round(r.subtotal * 100) / 100,
      invoicedAt: r.invoicedAt as string | null,
      markedByName: r.markedByName as string | null,
      daysSince: days,
      state,
      masterRevenue: r.found ? Math.round(r.masterRevenue * 100) / 100 : null,
      difference,
      amountMismatch: difference !== null && Math.abs(difference) > tolerance,
    };
  });
  return {
    graceDays: options.graceDays,
    hasBatch: hasBatch ?? true,
    legacyCount: legacy.rows[0].n,
    counts: {
      checked: rows.length,
      matched: rows.filter((r) => r.state === 'matched').length,
      waiting: rows.filter((r) => r.state === 'waiting').length,
      missing: rows.filter((r) => r.state === 'missing').length,
      amountMismatch: rows.filter((r) => r.amountMismatch).length,
    },
    // Only what needs a look: missing, waiting and amount differences.
    rows: rows.filter((r) => r.state !== 'matched' || r.amountMismatch),
  };
}
