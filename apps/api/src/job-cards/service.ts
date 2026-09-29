import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
  serviceJobCardCreateSchema,
  serviceJobCardUpdateSchema,
  type JobCardPart,
  type ServiceJobCardCreateInput,
  type ServiceJobCardUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findServiceJobCardByAppointmentId,
  findServiceJobCardByQuotationId,
  findServiceJobCardById,
  insertServiceJobCard,
  insertServiceJobCardHistory,
  listServiceJobCardHistory,
  listServiceJobCards,
  updateServiceJobCardContent,
  updateServiceJobCardStatus,
  type ServiceJobCardContent,
} from '../../../../packages/db/src/job-cards.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  findAppointmentById,
  type AppointmentRecord,
} from '../../../../packages/db/src/appointments.js';
import { findQuotationById, type QuotationRecord } from '../../../../packages/db/src/quotations.js';
import { findTechnicianById } from '../../../../packages/db/src/technicians.js';
import { findSalesmanByName } from '../../../../packages/db/src/salesmen.js';
import { allocateJobCardReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ServiceJobCardError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'appointment-ineligible'
      | 'quotation-ineligible'
      | 'duplicate'
      | 'invalid-transition'
      | 'terminal-job-card',
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Time Consumed is derived from Period From/To (whole hours, rounded), matching
 *  the live system's calcJobCardTimeConsumed() -- never typed by hand. */
function calcTimeConsumedHours(periodFrom: string | null, periodTo: string | null): number | null {
  if (!periodFrom || !periodTo) return null;
  const from = new Date(periodFrom);
  const to = new Date(periodTo);
  const diffMs = to.getTime() - from.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 3600000);
}

/** Mirrors the live system's recalcJobCardTotals(): totalCost is always the sum of
 *  the parts lines, grandTotal is always totalCost + serviceCharge. Neither is
 *  ever accepted from the client -- both are recomputed server-side every time. */
function computeTotals(parts: JobCardPart[], serviceCharge: number) {
  const totalCost = parts.reduce((sum, part) => sum + (part.qty || 0) * (part.unitPrice || 0), 0);
  return { totalCost, grandTotal: totalCost + (serviceCharge || 0) };
}

async function resolveTechnicianName(
  client: Parameters<typeof findTechnicianById>[0],
  technicianId: string | null,
) {
  if (!technicianId) return null;
  const technician = await findTechnicianById(client, technicianId);
  return technician?.name ?? null;
}

// The job card's Sales channel defaults from the salesman already on the
// appointment (see modification.md #17) -- the same salesman a staff member
// picked or confirmed on the Schedule form. Falls back to null (e.g. free
// text name that isn't in the salesmen master, or no salesman at all) --
// staff can always fill it in on the job card's own Sales channel field.
async function resolveSalesChannelForSalesman(
  client: Parameters<typeof findSalesmanByName>[0],
  salesman: string | null,
) {
  if (!salesman) return null;
  const record = await findSalesmanByName(client, salesman);
  return record?.salesChannel ?? null;
}

/** Default job-card content pulled from a completed appointment, matching the live
 *  system's pullJobCardFromScheduler(). The CCE can edit anything from here before
 *  saving; nothing here is final until the job card is created. */
function defaultsFromAppointment(
  appointment: AppointmentRecord,
  technicianName: string | null,
  salesChannel: string | null,
): ServiceJobCardContent {
  return {
    jobCardDate: new Date().toISOString().slice(0, 10),
    customerName: appointment.customerName,
    customerContact: appointment.contactNumber,
    customerAddress: appointment.address,
    itemDescription: [appointment.brand, appointment.model].filter(Boolean).join(' ') || null,
    modelNo: appointment.model,
    warrantyStatus: appointment.jobWarranty,
    complaint: appointment.faultDescription,
    serviceRendered: null,
    periodFrom: null,
    periodTo: null,
    timeConsumedHours: null,
    parts: [],
    totalCost: 0,
    serviceCharge: 0,
    grandTotal: 0,
    amountChargeable: null,
    invoiceNo: null,
    deliveryDate: null,
    technicianName,
    brand: appointment.brand,
    salesman: appointment.salesman,
    salesChannel,
    jobFinalStatus: 'WIP',
    schoolContactPerson: appointment.b2bBranchSchool ? appointment.schoolContactPerson : null,
    schoolContactNumber: appointment.b2bBranchSchool ? appointment.schoolContactNumber : null,
    customerNumber: appointment.customerNumber,
    legacyReference: null,
  };
}

/** Default job-card content pulled from a saved Quotation, matching the live
 *  system's pullJobCardFromQuotation(). A quotation never captures the B2B
 *  fields (site contact person/number, customer number) or a salesman/sales
 *  channel, so those are left blank here -- a "soft N/A" the CCE can still
 *  fill in by hand, never disabled (see modification.md #18). */
function defaultsFromQuotation(quotation: QuotationRecord): ServiceJobCardContent {
  return {
    jobCardDate: new Date().toISOString().slice(0, 10),
    customerName: quotation.customerName,
    customerContact: quotation.contactNumber,
    customerAddress: quotation.siteLocation,
    itemDescription:
      quotation.products
        .map((product) => product.description)
        .filter(Boolean)
        .join(', ') || null,
    modelNo: null,
    warrantyStatus: null,
    complaint: quotation.customerComplaint,
    serviceRendered: null,
    periodFrom: null,
    periodTo: null,
    timeConsumedHours: null,
    parts: [],
    totalCost: 0,
    serviceCharge: 0,
    grandTotal: 0,
    amountChargeable: null,
    invoiceNo: null,
    deliveryDate: null,
    technicianName: quotation.technicianName,
    brand: null,
    salesman: null,
    salesChannel: null,
    jobFinalStatus: 'WIP',
    schoolContactPerson: null,
    schoolContactNumber: null,
    customerNumber: null,
    legacyReference: quotation.legacyReference,
  };
}

function mergeContent(
  defaults: ServiceJobCardContent,
  overrides: ServiceJobCardCreateInput | ServiceJobCardUpdateInput,
): ServiceJobCardContent {
  const merged: ServiceJobCardContent = {
    ...defaults,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  } as ServiceJobCardContent;
  const parts = merged.parts ?? [];
  const serviceCharge = merged.serviceCharge ?? 0;
  const { totalCost, grandTotal } = computeTotals(parts, serviceCharge);
  merged.parts = parts;
  merged.serviceCharge = serviceCharge;
  merged.totalCost = totalCost;
  merged.grandTotal = grandTotal;
  merged.timeConsumedHours =
    overrides.periodFrom !== undefined || overrides.periodTo !== undefined
      ? calcTimeConsumedHours(merged.periodFrom, merged.periodTo)
      : (merged.timeConsumedHours ?? calcTimeConsumedHours(merged.periodFrom, merged.periodTo));
  return merged;
}

export function createServiceJobCardService(pool: Pool) {
  async function prefill(appointmentId: string) {
    const client = await pool.connect();
    try {
      const appointment = await findAppointmentById(client, appointmentId);
      if (!appointment) {
        throw new ServiceJobCardError('not-found', 'The appointment was not found.');
      }
      if (appointment.status !== 'Completed') {
        throw new ServiceJobCardError(
          'appointment-ineligible',
          'A job card can only be prefilled from a completed appointment.',
        );
      }
      if (await findServiceJobCardByAppointmentId(client, appointmentId)) {
        throw new ServiceJobCardError(
          'duplicate',
          'The appointment already has a service job card.',
        );
      }
      const technicianName = await resolveTechnicianName(client, appointment.technicianId);
      const salesChannel = await resolveSalesChannelForSalesman(client, appointment.salesman);
      return {
        appointment,
        content: defaultsFromAppointment(appointment, technicianName, salesChannel),
      };
    } finally {
      client.release();
    }
  }

  // ---- Quotation-sourced job cards (modification.md #18) ----

  async function prefillFromQuotation(quotationId: string) {
    const client = await pool.connect();
    try {
      const quotation = await findQuotationById(client, quotationId);
      if (!quotation) {
        throw new ServiceJobCardError('not-found', 'The quotation was not found.');
      }
      if (await findServiceJobCardByQuotationId(client, quotationId)) {
        throw new ServiceJobCardError(
          'duplicate',
          'This quotation already has a service job card.',
        );
      }
      return { quotation, content: defaultsFromQuotation(quotation) };
    } finally {
      client.release();
    }
  }

  async function createFromQuotation(
    quotationId: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const overrides = serviceJobCardCreateSchema.parse(input ?? {});
    return withTransaction(pool, async (client) => {
      const quotation = await findQuotationById(client, quotationId, true);
      if (!quotation) {
        throw new ServiceJobCardError('not-found', 'The quotation was not found.');
      }
      if (await findServiceJobCardByQuotationId(client, quotationId, true)) {
        throw new ServiceJobCardError(
          'duplicate',
          'This quotation already has a service job card.',
        );
      }

      const content = mergeContent(defaultsFromQuotation(quotation), overrides);
      const scopeDate = quotation.quotationDate ?? new Date().toISOString().slice(0, 10);
      const jobCardReference = await allocateJobCardReference(client, scopeDate);
      let jobCard;
      try {
        jobCard = await insertServiceJobCard(client, {
          jobCardReference,
          appointmentId: null,
          quotationId,
          sourceType: 'Quotation',
          createdBy: profileId,
          content,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ServiceJobCardError(
            'duplicate',
            'This quotation already has a service job card.',
          );
        }
        throw error;
      }
      await insertServiceJobCardHistory(
        client,
        jobCard.id,
        null,
        'Open',
        profileId,
        'Created',
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.created',
        targetType: 'service_job_card',
        targetId: jobCard.id,
        metadata: {
          jobCardReference: jobCard.jobCardReference,
          quotationId,
          quotationReference: quotation.quotationReference,
        },
        requestId,
      });
      return jobCard;
    });
  }

  async function byQuotation(quotationId: string) {
    const client = await pool.connect();
    try {
      const quotation = await findQuotationById(client, quotationId);
      if (!quotation) throw new ServiceJobCardError('not-found', 'The quotation was not found.');
      const jobCard = await findServiceJobCardByQuotationId(client, quotationId);
      return { jobCard };
    } finally {
      client.release();
    }
  }

  async function create(
    appointmentId: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const overrides = serviceJobCardCreateSchema.parse(input ?? {});
    return withTransaction(pool, async (client) => {
      const appointment = await findAppointmentById(client, appointmentId, true);
      if (!appointment) {
        throw new ServiceJobCardError('not-found', 'The appointment was not found.');
      }
      if (appointment.status !== 'Completed') {
        throw new ServiceJobCardError(
          'appointment-ineligible',
          'A job card will be created once the appointment is completed.',
        );
      }
      if (await findServiceJobCardByAppointmentId(client, appointmentId, true)) {
        throw new ServiceJobCardError(
          'duplicate',
          'The appointment already has a service job card.',
        );
      }

      const technicianName = await resolveTechnicianName(client, appointment.technicianId);
      const salesChannel = await resolveSalesChannelForSalesman(client, appointment.salesman);
      const content = mergeContent(
        defaultsFromAppointment(appointment, technicianName, salesChannel),
        overrides,
      );

      const jobCardReference = await allocateJobCardReference(client, appointment.appointmentDate);
      let jobCard;
      try {
        jobCard = await insertServiceJobCard(client, {
          jobCardReference,
          appointmentId,
          quotationId: null,
          sourceType: 'Scheduler',
          createdBy: profileId,
          content,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ServiceJobCardError(
            'duplicate',
            'The appointment already has a service job card.',
          );
        }
        throw error;
      }
      await insertServiceJobCardHistory(
        client,
        jobCard.id,
        null,
        'Open',
        profileId,
        'Created',
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.created',
        targetType: 'service_job_card',
        targetId: jobCard.id,
        metadata: {
          jobCardReference: jobCard.jobCardReference,
          appointmentId,
          appointmentReference: appointment.appointmentReference,
        },
        requestId,
      });
      return jobCard;
    });
  }

  async function updateContent(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const overrides = serviceJobCardUpdateSchema.parse(input ?? {});
    return withTransaction(pool, async (client) => {
      const current = await findServiceJobCardById(client, id, true);
      if (!current) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      if (current.status === 'Completed' || current.status === 'Cancelled') {
        throw new ServiceJobCardError(
          'terminal-job-card',
          `A job card in ${current.status} can no longer be edited.`,
        );
      }
      const content = mergeContent(
        {
          jobCardDate: current.jobCardDate,
          customerName: current.customerName,
          customerContact: current.customerContact,
          customerAddress: current.customerAddress,
          itemDescription: current.itemDescription,
          modelNo: current.modelNo,
          warrantyStatus: current.warrantyStatus,
          complaint: current.complaint,
          serviceRendered: current.serviceRendered,
          periodFrom: current.periodFrom ? new Date(current.periodFrom).toISOString() : null,
          periodTo: current.periodTo ? new Date(current.periodTo).toISOString() : null,
          timeConsumedHours: current.timeConsumedHours ? Number(current.timeConsumedHours) : null,
          parts: current.parts,
          totalCost: Number(current.totalCost),
          serviceCharge: Number(current.serviceCharge),
          grandTotal: Number(current.grandTotal),
          amountChargeable: current.amountChargeable ? Number(current.amountChargeable) : null,
          invoiceNo: current.invoiceNo,
          deliveryDate: current.deliveryDate,
          technicianName: current.technicianName,
          brand: current.brand,
          salesman: current.salesman,
          salesChannel: current.salesChannel,
          jobFinalStatus: current.jobFinalStatus,
          schoolContactPerson: current.schoolContactPerson,
          schoolContactNumber: current.schoolContactNumber,
          customerNumber: current.customerNumber,
          legacyReference: current.legacyReference,
        },
        overrides,
      );
      const jobCard = await updateServiceJobCardContent(client, id, content, profileId);
      if (!jobCard)
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.content_updated',
        targetType: 'service_job_card',
        targetId: id,
        metadata: { jobCardReference: jobCard.jobCardReference },
        requestId,
      });
      return jobCard;
    });
  }

  async function list(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return listServiceJobCards(client, {
        status: typeof query.status === 'string' ? query.status : undefined,
        search: typeof query.search === 'string' ? query.search : undefined,
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 25),
      });
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const jobCard = await findServiceJobCardById(client, id);
      if (!jobCard)
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      const history = await listServiceJobCardHistory(client, id);
      return { jobCard, history };
    } finally {
      client.release();
    }
  }

  async function byAppointment(appointmentId: string) {
    const client = await pool.connect();
    try {
      const appointment = await findAppointmentById(client, appointmentId);
      if (!appointment)
        throw new ServiceJobCardError('not-found', 'The appointment was not found.');
      const jobCard = await findServiceJobCardByAppointmentId(client, appointmentId);
      return { jobCard };
    } finally {
      client.release();
    }
  }

  async function history(id: string) {
    const client = await pool.connect();
    try {
      if (!(await findServiceJobCardById(client, id))) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      return listServiceJobCardHistory(client, id);
    } finally {
      client.release();
    }
  }

  async function changeStatus(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = serviceJobCardStatusUpdateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findServiceJobCardById(client, id, true);
      if (!current) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      if (!serviceJobCardStatusTransitions[current.status].includes(data.status)) {
        throw new ServiceJobCardError(
          current.status === 'Completed' || current.status === 'Cancelled'
            ? 'terminal-job-card'
            : 'invalid-transition',
          `A job card in ${current.status} cannot transition to ${data.status}.`,
        );
      }
      const finalized = data.status === 'Completed' || data.status === 'Cancelled';
      const result = await updateServiceJobCardStatus(client, id, data, profileId, finalized);
      if (!result)
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      await insertServiceJobCardHistory(
        client,
        id,
        result.previousStatus,
        data.status,
        profileId,
        data.reason,
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.status_changed',
        targetType: 'service_job_card',
        targetId: id,
        metadata: {
          fromStatus: result.previousStatus,
          toStatus: data.status,
          finalized,
        },
        requestId,
      });
      return result.jobCard;
    });
  }

  return {
    list,
    create,
    prefill,
    updateContent,
    detail,
    byAppointment,
    history,
    changeStatus,
    prefillFromQuotation,
    createFromQuotation,
    byQuotation,
  };
}

export type ServiceJobCardService = ReturnType<typeof createServiceJobCardService>;
