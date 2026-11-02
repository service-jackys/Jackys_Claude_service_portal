import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  quotationWriteSchema,
  quotationListQuerySchema,
  computeQuotationTotals,
  type QuotationWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findQuotationById,
  insertQuotation,
  listQuotations,
  updateQuotation,
  type QuotationContent,
} from '../../../../packages/db/src/quotations.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateQuotationReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class QuotationServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: QuotationWriteInput, existing?: QuotationContent): QuotationContent {
  const base: QuotationContent = existing ?? {
    appointmentId: null,
    quotationDate: null,
    customerName: null,
    contactNumber: null,
    projectName: null,
    siteLocation: null,
    dateOfCollection: null,
    technicianName: null,
    customerComplaint: null,
    technicalDiagnosis: null,
    warrantyStatus: null,
    customerType: null,
    b2bBranchSchool: null,
    quotationStatus: 'Pending',
    erpStatus: '',
    products: [],
    parts: [],
    labourAmount: 0,
    vatRate: 0.05,
    subtotalAmount: 0,
    vatAmount: 0,
    grandTotal: 0,
    preparedBy: null,
    preparedDate: null,
    approvedBy: null,
    approvedDate: null,
    customerSignature: null,
    signatureDate: null,
    legacyReference: null,
  };
  const merged: QuotationContent = {
    appointmentId: input.appointmentId ?? base.appointmentId,
    quotationDate: input.quotationDate ?? base.quotationDate,
    customerName: input.customerName ?? base.customerName,
    contactNumber: input.contactNumber ?? base.contactNumber,
    projectName: input.projectName ?? base.projectName,
    siteLocation: input.siteLocation ?? base.siteLocation,
    dateOfCollection: input.dateOfCollection ?? base.dateOfCollection,
    technicianName: input.technicianName ?? base.technicianName,
    customerComplaint: input.customerComplaint ?? base.customerComplaint,
    technicalDiagnosis: input.technicalDiagnosis ?? base.technicalDiagnosis,
    warrantyStatus: input.warrantyStatus ?? base.warrantyStatus,
    customerType: input.customerType ?? base.customerType,
    b2bBranchSchool: input.b2bBranchSchool ?? base.b2bBranchSchool,
    quotationStatus: input.quotationStatus ?? base.quotationStatus,
    erpStatus: input.erpStatus ?? base.erpStatus,
    products: input.products ?? base.products,
    parts: input.parts ?? base.parts,
    labourAmount: input.labourAmount ?? base.labourAmount,
    vatRate: input.vatRate ?? base.vatRate,
    subtotalAmount: 0,
    vatAmount: 0,
    grandTotal: 0,
    preparedBy: input.preparedBy ?? base.preparedBy,
    preparedDate: input.preparedDate ?? base.preparedDate,
    approvedBy: input.approvedBy ?? base.approvedBy,
    approvedDate: input.approvedDate ?? base.approvedDate,
    customerSignature: input.customerSignature ?? base.customerSignature,
    signatureDate: input.signatureDate ?? base.signatureDate,
    legacyReference: input.legacyReference ?? base.legacyReference,
  };
  // ERP / ORION status is mandatory: every saved quotation says whether it is invoiced yet.
  if (!merged.erpStatus) {
    throw new z.ZodError([
      { code: 'custom', path: ['erpStatus'], message: 'ERP/ORION status is required.' },
    ]);
  }
  // The total is always worked out here from the lines, never taken from the client.
  const totals = computeQuotationTotals(merged);
  merged.subtotalAmount = totals.subtotal;
  merged.vatAmount = totals.vat;
  merged.grandTotal = totals.grandTotal;
  return merged;
}

export function createQuotationService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = quotationWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.quotationDate ?? new Date().toISOString().slice(0, 10);
      const quotationReference = await allocateQuotationReference(client, scopeDate);
      const quotation = await insertQuotation(client, {
        quotationReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'quotation.created',
        targetType: 'quotation',
        targetId: quotation.id,
        metadata: { quotationReference: quotation.quotationReference },
        requestId,
      });
      return quotation;
    });
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = quotationWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findQuotationById(client, id, true);
      if (!current) throw new QuotationServiceError('not-found', 'The quotation was not found.');
      const existing: QuotationContent = {
        appointmentId: current.appointmentId,
        quotationDate: current.quotationDate,
        customerName: current.customerName,
        contactNumber: current.contactNumber,
        projectName: current.projectName,
        siteLocation: current.siteLocation,
        dateOfCollection: current.dateOfCollection,
        technicianName: current.technicianName,
        customerComplaint: current.customerComplaint,
        technicalDiagnosis: current.technicalDiagnosis,
        warrantyStatus: current.warrantyStatus,
        customerType: current.customerType,
        b2bBranchSchool: current.b2bBranchSchool,
        quotationStatus: current.quotationStatus,
        erpStatus: current.erpStatus,
        products: current.products,
        parts: current.parts,
        labourAmount: Number(current.labourAmount),
        vatRate: Number(current.vatRate),
        subtotalAmount: Number(current.subtotalAmount),
        vatAmount: Number(current.vatAmount),
        grandTotal: Number(current.grandTotal),
        preparedBy: current.preparedBy,
        preparedDate: current.preparedDate,
        approvedBy: current.approvedBy,
        approvedDate: current.approvedDate,
        customerSignature: current.customerSignature,
        signatureDate: current.signatureDate,
        legacyReference: current.legacyReference,
      };
      const quotation = await updateQuotation(client, id, toContent(data, existing), profileId);
      if (!quotation) throw new QuotationServiceError('not-found', 'The quotation was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'quotation.updated',
        targetType: 'quotation',
        targetId: id,
        metadata: { quotationReference: quotation.quotationReference },
        requestId,
      });
      return quotation;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = quotationListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listQuotations(client, {
        search: data.search,
        appointmentId: data.appointmentId,
        unused: data.unused === 'true',
        quotationStatus: data.quotationStatus,
        erpStatus: data.erpStatus,
        customerType: data.customerType,
        page: data.page,
        pageSize: data.pageSize,
      });
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const quotation = await findQuotationById(client, id);
      if (!quotation) throw new QuotationServiceError('not-found', 'The quotation was not found.');
      return quotation;
    } finally {
      client.release();
    }
  }

  return { create, update, list, detail };
}

export type QuotationService = ReturnType<typeof createQuotationService>;
