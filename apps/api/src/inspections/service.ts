import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  inspectionWriteSchema,
  inspectionListQuerySchema,
  type InspectionWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findInspectionById,
  insertInspection,
  listInspections,
  updateInspection,
  type InspectionContent,
} from '../../../../packages/db/src/inspections.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateInspectionReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class InspectionServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: InspectionWriteInput, existing?: InspectionContent): InspectionContent {
  const base: InspectionContent = existing ?? {
    appointmentId: null,
    inspectionDate: null,
    customerName: null,
    contactNumber: null,
    projectName: null,
    siteLocation: null,
    dateOfCollection: null,
    technicianName: null,
    customerComplaint: null,
    visualFindings: null,
    technicalDiagnosis: null,
    products: [],
    faultyParts: [],
    recommendedAction: null,
    refQuotationNo: null,
    warrantyStatus: null,
    estRepairCost: null,
    inspectedBy: null,
    inspectedDate: null,
    reviewedBy: null,
    reviewedDate: null,
    customerSignature: null,
    signatureDate: null,
  };
  return {
    appointmentId: input.appointmentId ?? base.appointmentId,
    inspectionDate: input.inspectionDate ?? base.inspectionDate,
    customerName: input.customerName ?? base.customerName,
    contactNumber: input.contactNumber ?? base.contactNumber,
    projectName: input.projectName ?? base.projectName,
    siteLocation: input.siteLocation ?? base.siteLocation,
    dateOfCollection: input.dateOfCollection ?? base.dateOfCollection,
    technicianName: input.technicianName ?? base.technicianName,
    customerComplaint: input.customerComplaint ?? base.customerComplaint,
    visualFindings: input.visualFindings ?? base.visualFindings,
    technicalDiagnosis: input.technicalDiagnosis ?? base.technicalDiagnosis,
    products: input.products ?? base.products,
    faultyParts: input.faultyParts ?? base.faultyParts,
    recommendedAction: input.recommendedAction ?? base.recommendedAction,
    refQuotationNo: input.refQuotationNo ?? base.refQuotationNo,
    warrantyStatus: input.warrantyStatus ?? base.warrantyStatus,
    estRepairCost: input.estRepairCost ?? base.estRepairCost,
    inspectedBy: input.inspectedBy ?? base.inspectedBy,
    inspectedDate: input.inspectedDate ?? base.inspectedDate,
    reviewedBy: input.reviewedBy ?? base.reviewedBy,
    reviewedDate: input.reviewedDate ?? base.reviewedDate,
    customerSignature: input.customerSignature ?? base.customerSignature,
    signatureDate: input.signatureDate ?? base.signatureDate,
  };
}

export function createInspectionService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = inspectionWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.inspectionDate ?? new Date().toISOString().slice(0, 10);
      const inspectionReference = await allocateInspectionReference(client, scopeDate);
      const inspection = await insertInspection(client, {
        inspectionReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'inspection.created',
        targetType: 'inspection',
        targetId: inspection.id,
        metadata: { inspectionReference: inspection.inspectionReference },
        requestId,
      });
      return inspection;
    });
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = inspectionWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findInspectionById(client, id, true);
      if (!current) throw new InspectionServiceError('not-found', 'The inspection was not found.');
      const existing: InspectionContent = {
        appointmentId: current.appointmentId,
        inspectionDate: current.inspectionDate,
        customerName: current.customerName,
        contactNumber: current.contactNumber,
        projectName: current.projectName,
        siteLocation: current.siteLocation,
        dateOfCollection: current.dateOfCollection,
        technicianName: current.technicianName,
        customerComplaint: current.customerComplaint,
        visualFindings: current.visualFindings,
        technicalDiagnosis: current.technicalDiagnosis,
        products: current.products,
        faultyParts: current.faultyParts,
        recommendedAction: current.recommendedAction,
        refQuotationNo: current.refQuotationNo,
        warrantyStatus: current.warrantyStatus,
        estRepairCost: current.estRepairCost === null ? null : Number(current.estRepairCost),
        inspectedBy: current.inspectedBy,
        inspectedDate: current.inspectedDate,
        reviewedBy: current.reviewedBy,
        reviewedDate: current.reviewedDate,
        customerSignature: current.customerSignature,
        signatureDate: current.signatureDate,
      };
      const inspection = await updateInspection(client, id, toContent(data, existing), profileId);
      if (!inspection) {
        throw new InspectionServiceError('not-found', 'The inspection was not found.');
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'inspection.updated',
        targetType: 'inspection',
        targetId: id,
        metadata: { inspectionReference: inspection.inspectionReference },
        requestId,
      });
      return inspection;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = inspectionListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listInspections(client, {
        search: data.search,
        appointmentId: data.appointmentId,
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
      const inspection = await findInspectionById(client, id);
      if (!inspection) {
        throw new InspectionServiceError('not-found', 'The inspection was not found.');
      }
      return inspection;
    } finally {
      client.release();
    }
  }

  return { create, update, list, detail };
}

export type InspectionService = ReturnType<typeof createInspectionService>;
