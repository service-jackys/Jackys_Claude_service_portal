import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  BER_HANDLING_CHARGE,
  finalStatusesLocked,
  finalStatusNeedsReason,
  finalStatuses,
  jobOutcomeStatuses,
  type FinalStatus,
  type JobFinalStatus,
  jobFinalStatusesReadyToDeliver,
  serviceJobCardStatusForFinal,
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
  serviceJobCardCreateSchema,
  serviceJobCardUpdateSchema,
  walkInJobCardCreateSchema,
  type JobCardPart,
  type ServiceJobCardCreateInput,
  type ServiceJobCardUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findOpenRecordsForContact,
  listAppointmentsAwaitingJobCard,
  findServiceJobCardByAppointmentId,
  findServiceJobCardByQuotationId,
  findServiceJobCardById,
  insertServiceJobCard,
  insertServiceJobCardHistory,
  listServiceJobCardHistory,
  listServiceJobCards,
  setServiceJobCardFinalStatus,
  setServiceJobCardJobStatus,
  setServiceJobCardClosureApproval,
  setServiceJobCardDeliveryDateIfBlank,
  updateServiceJobCardBilling,
  updateServiceJobCardContent,
  updateServiceJobCardStatus,
  type ServiceJobCardContent,
  type ServiceJobCardRecord,
} from '../../../../packages/db/src/job-cards.js';
import {
  findLatestApprovalForJobCard,
  findLatestApprovalForQuotation,
} from '../../../../packages/db/src/warranty-approvals.js';
import { recordManualApprovalForJob } from '../warranty-approvals/service.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { listActiveBillingRules } from '../../../../packages/db/src/billing-rules.js';
import {
  billedAmount,
  deliveryBlockReason,
  gateInvoiceNo,
  isMdaGroup,
  mdaStandardRate,
  normalizeWarranty,
  resolveBilling,
} from './billing.js';
import { createPricingConfigService } from '../pricing-config/service.js';
import {
  findAppointmentById,
  type AppointmentRecord,
} from '../../../../packages/db/src/appointments.js';
import { findQuotationById, type QuotationRecord } from '../../../../packages/db/src/quotations.js';
import { findTechnicianById } from '../../../../packages/db/src/technicians.js';
import { findSalesmanByName } from '../../../../packages/db/src/salesmen.js';
import { findB2bBranchByName } from '../../../../packages/db/src/b2b-branches.js';
import { findStockItemByCode, searchStockItems } from '../../../../packages/db/src/stock-master.js';
import {
  allocateJobCardReference,
  allocateWalkInJobCardReference,
} from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ServiceJobCardError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'appointment-ineligible'
      | 'quotation-ineligible'
      | 'duplicate'
      | 'invalid-transition'
      | 'terminal-job-card'
      | 'billing-blocked'
      | 'approval-required'
      | 'reason-required'
      | 'closure-approval-required'
      | 'sales-channel-required'
      | 'salesman-required',
    message: string,
  ) {
    super(message);
  }
}

export const SALESMAN_REQUIRED_MESSAGE =
  "Choose the salesman. A direct customer (B2C) job under warranty is billed to the salesman's sales channel, so the salesman is required.";

/** A B2C job under warranty is billed internally to the salesman's channel, so it needs one. */
export function salesmanRequired(card: {
  customerType: string | null | undefined;
  effectiveWarranty: string | null | undefined;
  jobFinalStatus: string | null | undefined;
  salesman: string | null | undefined;
}): boolean {
  return (
    card.customerType === 'B2C' &&
    card.effectiveWarranty === 'In Warranty' &&
    card.jobFinalStatus !== 'Cancelled' &&
    !(card.salesman ?? '').trim()
  );
}

// Delivered and Cancelled job cards are locked; an old-style Completed card
// that never got a final outcome is treated as locked too. Administrators can
// still edit a locked card.
function isJobCardLocked(
  card: Pick<ServiceJobCardRecord, 'status' | 'jobFinalStatus' | 'finalStatus'>,
): boolean {
  return (
    (card.finalStatus !== null && finalStatusesLocked.includes(card.finalStatus)) ||
    (card.status === 'Completed' &&
      (card.jobFinalStatus === 'WIP' || card.jobFinalStatus === 'Spare pending'))
  );
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

type MasterClient = Parameters<typeof findSalesmanByName>[0];

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** Finds the stock master item for a job: the exact item code first, then a
 *  single unambiguous match on the typed model / code (narrowed by brand when
 *  that helps). Returns null when nothing, or more than one item, matches. */
async function resolveStockItem(
  client: MasterClient,
  code: string | null | undefined,
  brand: string | null | undefined,
) {
  const term = (code ?? '').trim();
  if (!term) return null;
  const exact = await findStockItemByCode(client, term);
  if (exact) return exact;
  for (const narrowBy of [brand?.trim() || undefined, undefined]) {
    const hits = await searchStockItems(client, { query: term, limit: 5, brand: narrowBy });
    if (hits.length === 1) return hits[0];
    const prefixed = hits.filter((hit) =>
      hit.itemCode.toUpperCase().startsWith(term.toUpperCase()),
    );
    if (prefixed.length === 1) return prefixed[0];
    if (hits.length > 1) return null;
  }
  return null;
}

type MasterInput = Pick<
  ServiceJobCardContent,
  | 'b2bBranchSchool'
  | 'customerType'
  | 'customerNumber'
  | 'salesOrderNumber'
  | 'salesman'
  | 'salesChannel'
  | 'itemCode'
  | 'modelNo'
  | 'brand'
  | 'itemDescription'
  | 'mainGroup'
  | 'groupName'
  | 'subGroup'
>;

type MasterContext = {
  /** Fields whose value came from (or matches) a master -- highlighted green. */
  masterFields: string[];
  /** Values the stock master supplies for fields that are still blank. */
  masterFill: Partial<MasterInput>;
};

/** Works out which job card fields a master supplies, and the stock master
 *  values for blank item fields. Used when a job card is created and again when
 *  an existing one is opened for editing. Nothing is written here. */
async function masterContextFor(
  client: MasterClient,
  content: MasterInput,
): Promise<MasterContext> {
  const masterFields = new Set<string>();
  const masterFill: Partial<MasterInput> = {};

  const branch =
    content.b2bBranchSchool && content.customerType !== 'B2C'
      ? await findB2bBranchByName(client, content.b2bBranchSchool)
      : null;
  if (branch) {
    masterFields.add('b2bBranchSchool');
    if (sameText(content.customerNumber, branch.custCode)) masterFields.add('customerNumber');
    if (sameText(content.salesOrderNumber, branch.lastSalesOrderNumber)) {
      masterFields.add('salesOrderNumber');
    }
  }
  if (branch) {
    if (!content.customerNumber && branch.custCode) masterFill.customerNumber = branch.custCode;
    if (!content.salesOrderNumber && branch.lastSalesOrderNumber) {
      masterFill.salesOrderNumber = branch.lastSalesOrderNumber;
    }
    // A matched branch supplies the salesman when the job card has none.
    if (!content.salesman && branch.salesman) masterFill.salesman = branch.salesman;
  }
  const salesmanName = content.salesman || masterFill.salesman;
  if (salesmanName) {
    const record = await findSalesmanByName(client, salesmanName);
    if (record || (branch && sameText(salesmanName, branch.salesman))) {
      masterFields.add('salesman');
    }
    // The salesman's own channel wins; otherwise the branch's channel.
    const channel = record?.salesChannel || (branch?.salesChannel ?? null);
    if (channel && !content.salesChannel) {
      masterFill.salesChannel = channel;
      masterFields.add('salesChannel');
    } else if (channel && sameText(content.salesChannel, channel)) {
      masterFields.add('salesChannel');
    }
  } else if (branch?.salesChannel && !content.salesChannel) {
    masterFill.salesChannel = branch.salesChannel;
    masterFields.add('salesChannel');
  }

  const item = await resolveStockItem(client, content.itemCode || content.modelNo, content.brand);
  if (item) {
    masterFields.add('modelNo');
    if (!content.modelNo) masterFill.modelNo = item.itemCode;
    if (!content.itemCode) masterFill.itemCode = item.itemCode;
    const itemFields = {
      brand: item.brand,
      itemDescription: item.itemDesc,
      mainGroup: item.mainGroup,
      groupName: item.groupName,
      subGroup: item.subGroup,
    } as const;
    for (const key of Object.keys(itemFields) as Array<keyof typeof itemFields>) {
      const value = itemFields[key];
      if (!value) continue;
      if (!content[key]) {
        masterFill[key] = value;
        masterFields.add(key);
      } else if (sameText(content[key], value)) {
        masterFields.add(key);
      }
    }
  }
  return { masterFields: [...masterFields], masterFill };
}

/** Fills the job card defaults from the masters and reports which fields came
 *  from a master, so the form can highlight them. The B2B branch master wins
 *  for the salesman and sales channel; the stock master fills the item fields.
 *  Everything stays editable on the form. */
async function enrichDefaultsFromMasters(
  client: MasterClient,
  appointment: AppointmentRecord,
  defaults: ServiceJobCardContent,
): Promise<{ content: ServiceJobCardContent; masterFields: string[] }> {
  const content: ServiceJobCardContent = { ...defaults };
  const branch =
    appointment.b2bBranchSchool && appointment.customerType !== 'B2C'
      ? await findB2bBranchByName(client, appointment.b2bBranchSchool)
      : null;
  if (branch) {
    if (!content.customerNumber) content.customerNumber = branch.custCode;
    if (!content.salesOrderNumber && branch.lastSalesOrderNumber) {
      content.salesOrderNumber = branch.lastSalesOrderNumber;
    }
    if (branch.salesman) content.salesman = branch.salesman;
  }
  if (content.salesman) {
    const record = await findSalesmanByName(client, content.salesman);
    if (record?.salesChannel) content.salesChannel = record.salesChannel;
  }
  if (!content.salesChannel && branch?.salesChannel) content.salesChannel = branch.salesChannel;

  const context = await masterContextFor(client, content);
  const filled = { ...content, ...context.masterFill };
  if (Object.keys(context.masterFill).length || context.masterFields.includes('modelNo')) {
    const item = await resolveStockItem(client, filled.itemCode || filled.modelNo, filled.brand);
    if (item) filled.itemCode = item.itemCode;
    filled.itemInMaster = Boolean(item) || filled.itemInMaster;
  }
  const after = await masterContextFor(client, filled);
  return { content: filled, masterFields: after.masterFields };
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
    finalStatus: null,
    finalStatusReason: null,
    schoolContactPerson: appointment.b2bBranchSchool ? appointment.schoolContactPerson : null,
    schoolContactNumber: appointment.b2bBranchSchool ? appointment.schoolContactNumber : null,
    customerNumber: appointment.customerNumber,
    customerType: appointment.customerType,
    customerEmail: appointment.customerEmail,
    region: appointment.region,
    b2bBranchSchool: appointment.b2bBranchSchool,
    salesOrderNumber: appointment.salesOrderNumber,
    legacyReference: null,
    itemCode: appointment.itemCode,
    mainGroup: null,
    groupName: null,
    subGroup: appointment.subGroup,
    itemInMaster: null,
    serialNo: null,
    purchaseDate: null,
    accessoriesReceived: null,
    conditionNotes: null,
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
    finalStatus: null,
    finalStatusReason: null,
    schoolContactPerson: null,
    schoolContactNumber: null,
    customerNumber: null,
    customerType: null,
    customerEmail: null,
    region: null,
    b2bBranchSchool: null,
    salesOrderNumber: null,
    legacyReference: quotation.legacyReference,
    itemCode: null,
    mainGroup: null,
    groupName: null,
    subGroup: null,
    itemInMaster: null,
    serialNo: null,
    purchaseDate: null,
    accessoriesReceived: null,
    conditionNotes: null,
  };
}

const billingKeys = [
  'finalWarrantyStatus',
  'warrantyOverrideReason',
  'paymentBy',
  'billToChannel',
  'invoiceDate',
  'paymentMode',
  'paymentReference',
  'paymentConfirmed',
] as const;

type BillingOverrides = {
  finalWarrantyStatus?: 'In Warranty' | 'Out Warranty';
  warrantyOverrideReason?: string;
  paymentBy?: 'Sales channel' | 'Customer';
  billToChannel?: string;
  invoiceDate?: string;
  paymentMode?: 'Cash' | 'Online' | 'Bank transfer' | 'Card';
  paymentReference?: string;
  paymentConfirmed?: boolean;
};

/** Separates the warranty/billing inputs from the plain job-card content. */
function splitBilling<T extends Record<string, unknown>>(
  data: T,
): { billing: BillingOverrides; rest: Omit<T, (typeof billingKeys)[number]> } {
  const billing: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if ((billingKeys as readonly string[]).includes(key)) billing[key] = value;
    else rest[key] = value;
  }
  return {
    billing: billing as BillingOverrides,
    rest: rest as Omit<T, (typeof billingKeys)[number]>,
  };
}

/** Today's date in the business time zone (Dubai), as YYYY-MM-DD. */
function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Dubai',
  }).format(new Date());
}

/** The older single-status form: a final-status name sent as the job status is the final
 *  status (modification #125). */
function normaliseStatusAlias<T extends { jobFinalStatus?: string }>(
  input: T,
): Omit<T, 'jobFinalStatus'> & { jobFinalStatus?: JobFinalStatus } {
  const out: Record<string, unknown> = { ...input };
  if (
    typeof out.jobFinalStatus === 'string' &&
    (finalStatuses as readonly string[]).includes(out.jobFinalStatus)
  ) {
    if (out.finalStatus === undefined) out.finalStatus = out.jobFinalStatus;
    delete out.jobFinalStatus;
  }
  return out as Omit<T, 'jobFinalStatus'> & { jobFinalStatus?: JobFinalStatus };
}

/** What the job's closing outcome bills: the rate card's OOW inspection charge and the
 *  warranty the job is finally billed under. */
type OutcomeRates = {
  oowInspection: number | null;
  effectiveWarranty: 'In Warranty' | 'Out Warranty' | null;
};

function mergeContent(
  defaults: ServiceJobCardContent,
  overrides: ServiceJobCardCreateInput | ServiceJobCardUpdateInput,
  mdaRate: number | null = null,
  createdAt: string | null = null,
  outcomeRates: OutcomeRates | null = null,
): ServiceJobCardContent {
  const incoming: Record<string, unknown> = normaliseStatusAlias({ ...overrides });
  // Period from is the job created time: it is set once by the server when the
  // job card is created and can never be changed by an edit.
  const merged: ServiceJobCardContent = {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(incoming).filter(
        ([key, value]) => value !== undefined && key !== 'periodFrom',
      ),
    ),
  } as ServiceJobCardContent;
  if (!merged.finalStatus) merged.finalStatusReason = null;
  const parts = merged.parts ?? [];
  // Major appliances (MDA) are always charged the rate card's "MDA – Standard"
  // service charge, in warranty and out of warranty, whatever the billing rule
  // or channel. It replaces any typed service charge.
  let serviceCharge =
    isMdaGroup(merged.mainGroup) && mdaRate !== null ? mdaRate : (merged.serviceCharge ?? 0);
  const isOutcome = (jobOutcomeStatuses as readonly string[]).includes(merged.jobFinalStatus);
  const wasOutcome = (jobOutcomeStatuses as readonly string[]).includes(defaults.jobFinalStatus);
  if (isOutcome && outcomeRates) {
    // A job that ends as BER, Rejected or Cancelled is not charged the repair rate.
    // A business customer whose final warranty is Out Warranty is billed the rate
    // card's OOW inspection charge (not for Cancelled); everyone else, and every
    // B2C customer, pays nothing. Spare parts are not billed on these outcomes.
    const channelPays =
      merged.customerType !== 'B2C' &&
      outcomeRates.effectiveWarranty === 'Out Warranty' &&
      merged.jobFinalStatus !== 'Cancelled';
    serviceCharge = channelPays ? (outcomeRates.oowInspection ?? BER_HANDLING_CHARGE) : 0;
    merged.amountChargeable = serviceCharge;
  } else if (wasOutcome && !isOutcome) {
    // Back to repair work: the outcome charge no longer applies.
    if (
      overrides.serviceCharge === undefined &&
      !(isMdaGroup(merged.mainGroup) && mdaRate !== null)
    ) {
      serviceCharge = 0;
    }
    if (overrides.amountChargeable === undefined) merged.amountChargeable = null;
  }
  const { totalCost, grandTotal } = computeTotals(parts, serviceCharge);
  if (createdAt) merged.periodFrom = createdAt;
  // The delivery date is captured by the system when the job is Delivered,
  // unless a date was entered by hand.
  if (merged.finalStatus === 'Delivered' && !merged.deliveryDate) {
    merged.deliveryDate = businessToday();
  }
  merged.parts = parts;
  merged.serviceCharge = serviceCharge;
  merged.totalCost = totalCost;
  merged.grandTotal = grandTotal;
  merged.timeConsumedHours =
    overrides.periodTo !== undefined
      ? calcTimeConsumedHours(merged.periodFrom, merged.periodTo)
      : (merged.timeConsumedHours ?? calcTimeConsumedHours(merged.periodFrom, merged.periodTo));
  return merged;
}

export function createServiceJobCardService(pool: Pool) {
  const pricing = createPricingConfigService(pool);
  // The service charge MDA jobs bill, read from the live rate card so a price
  // change there applies to the next save.
  // The rate card's OOW inspection line (AED 60), billed to the sales channel when a
  // business job ends as BER or Rejected.
  async function oowInspectionRate(): Promise<number | null> {
    const rateCard = await pricing.get('rate_card');
    const sections = (rateCard.payload ?? []) as { activities: { name: string; rate: number }[] }[];
    for (const section of sections) {
      for (const activity of section.activities ?? []) {
        const name = String(activity.name).toLowerCase();
        if (name.includes('oow') && name.includes('inspection')) return Number(activity.rate);
      }
    }
    return null;
  }

  async function mdaRate(): Promise<number | null> {
    const rateCard = await pricing.get('rate_card');
    return mdaStandardRate(rateCard.payload as Parameters<typeof mdaStandardRate>[0]);
  }

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
      const enriched = await enrichDefaultsFromMasters(
        client,
        appointment,
        defaultsFromAppointment(appointment, technicianName, salesChannel),
      );
      return { appointment, content: enriched.content, masterFields: enriched.masterFields };
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
      const approval = await findLatestApprovalForQuotation(client, quotationId);
      // A job made from a quotation waits for the customer's approval unless the
      // quotation's approval request has already been approved.
      const initialJobFinalStatus =
        approval?.status === 'Approved' ? 'WIP' : 'Customer approval pending';
      return { quotation, content: defaultsFromQuotation(quotation), initialJobFinalStatus };
    } finally {
      client.release();
    }
  }

  /** Resolves and stores the warranty/billing fields for a job card, then enforces the delivery gate. */
  async function applyBilling(
    client: Parameters<typeof findServiceJobCardById>[0],
    before: ServiceJobCardRecord | null,
    saved: ServiceJobCardRecord,
    billing: BillingOverrides,
    profileId: string,
    enforceDelivery: boolean,
  ): Promise<ServiceJobCardRecord> {
    const rules = await listActiveBillingRules(client);
    const previousEffective = before
      ? (normalizeWarranty(before.finalWarrantyStatus) ?? normalizeWarranty(before.warrantyStatus))
      : null;
    const finalWarrantyStatus = billing.finalWarrantyStatus ?? before?.finalWarrantyStatus ?? null;
    const resolution = resolveBilling({
      warrantyStatus: saved.warrantyStatus,
      finalWarrantyStatus,
      customerType: saved.customerType,
      salesman: saved.salesman,
      salesChannel: saved.salesChannel,
      b2bBranchSchool: saved.b2bBranchSchool,
      paymentBy:
        billing.paymentBy ??
        // Moving from In Warranty (always channel) to Out Warranty re-applies the default payer.
        (previousEffective === 'In Warranty' ? undefined : (before?.paymentBy as never)),
      billToOverride:
        billing.billToChannel !== undefined
          ? billing.billToChannel
          : before?.billToOverridden
            ? before.billToChannel
            : undefined,
      rules,
    });
    if (
      resolution.warrantyChanged &&
      !(billing.warrantyOverrideReason ?? before?.warrantyOverrideReason)
    ) {
      throw new ServiceJobCardError(
        'billing-blocked',
        'The final warranty status differs from the registered one. Enter the reason (for example customer-induced damage or misuse).',
      );
    }
    const paymentConfirmedNow =
      billing.paymentConfirmed ?? (before?.paymentConfirmedAt ? true : undefined);
    const paymentMode = billing.paymentMode ?? before?.paymentMode ?? null;
    if (billing.paymentConfirmed === true) {
      if (resolution.paymentBy !== 'Customer') {
        throw new ServiceJobCardError(
          'billing-blocked',
          'Only a job paid by the customer needs a payment confirmation.',
        );
      }
      if (!(saved.portalInvoiceNo || saved.invoiceNo)) {
        throw new ServiceJobCardError(
          'billing-blocked',
          'Issue the tax invoice (Service desk > Invoice) or record the ERP invoice number before confirming the payment.',
        );
      }
      if (!paymentMode) {
        throw new ServiceJobCardError(
          'billing-blocked',
          'Select the payment mode (cash, online, bank transfer or card) before confirming the payment.',
        );
      }
    }
    await updateServiceJobCardBilling(
      client,
      saved.id,
      {
        finalWarrantyStatus,
        warrantyOverrideReason: resolution.warrantyChanged
          ? (billing.warrantyOverrideReason ?? before?.warrantyOverrideReason ?? null)
          : null,
        paymentBy: resolution.paymentBy,
        billToChannel: resolution.billToChannel,
        billToOverridden: resolution.billToOverridden,
        billingJobType: resolution.billingJobType,
        invoiceDate: billing.invoiceDate ?? before?.invoiceDate ?? null,
        paymentMode,
        paymentReference: billing.paymentReference ?? before?.paymentReference ?? null,
        paymentConfirmed: billing.paymentConfirmed,
      },
      profileId,
    );
    const refreshed = (await findServiceJobCardById(client, saved.id)) ?? saved;
    if (enforceDelivery) {
      const reason = deliveryBlockReason({
        amount: billedAmount({
          amountChargeable:
            refreshed.amountChargeable === null ? null : Number(refreshed.amountChargeable),
          grandTotal: Number(refreshed.grandTotal),
        }),
        billingJobType: refreshed.billingJobType,
        paymentBy: refreshed.paymentBy,
        invoiceNo: gateInvoiceNo(refreshed),
        paymentConfirmed: Boolean(refreshed.paymentConfirmedAt) && paymentConfirmedNow !== false,
      });
      if (reason) throw new ServiceJobCardError('billing-blocked', reason);
    }
    return refreshed;
  }

  async function createFromQuotation(
    quotationId: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const { billing, rest: overrides } = splitBilling(
      serviceJobCardCreateSchema.parse(input ?? {}),
    );
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

      const content = mergeContent(
        defaultsFromQuotation(quotation),
        overrides,
        await mdaRate(),
        new Date().toISOString(),
      );
      const quotationApproval = await findLatestApprovalForQuotation(client, quotationId);
      if (
        quotationApproval?.status !== 'Approved' &&
        (content.jobFinalStatus === 'WIP' || content.jobFinalStatus === 'Customer approval pending')
      ) {
        content.jobFinalStatus = 'Customer approval pending';
      }
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
      jobCard = await applyBilling(
        client,
        null,
        jobCard,
        billing,
        profileId,
        jobCard.finalStatus === 'Delivered',
      );
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
    const { billing, rest: overrides } = splitBilling(
      serviceJobCardCreateSchema.parse(input ?? {}),
    );
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
      const enriched = await enrichDefaultsFromMasters(
        client,
        appointment,
        defaultsFromAppointment(appointment, technicianName, salesChannel),
      );
      const content = mergeContent(
        enriched.content,
        overrides,
        await mdaRate(),
        new Date().toISOString(),
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
      jobCard = await applyBilling(
        client,
        null,
        jobCard,
        billing,
        profileId,
        jobCard.finalStatus === 'Delivered',
      );
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

  // ---- Walk-in job cards (modification.md #59) ----
  // The customer comes straight to the service centre: no complaint, no
  // appointment, no quotation. The card is opened at the counter with the
  // essentials and everything else is filled in as the repair progresses.

  async function listAwaiting(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return await listAppointmentsAwaitingJobCard(client, {
        search: typeof query.search === 'string' ? query.search : undefined,
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 50),
      });
    } finally {
      client.release();
    }
  }

  async function walkInContactCheck(contact: unknown) {
    const client = await pool.connect();
    try {
      return await findOpenRecordsForContact(client, typeof contact === 'string' ? contact : '');
    } finally {
      client.release();
    }
  }

  async function createWalkIn(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const { billing, rest: data } = splitBilling(walkInJobCardCreateSchema.parse(input ?? {}));
    if (
      salesmanRequired({
        customerType: data.customerType,
        effectiveWarranty: normalizeWarranty(billing.finalWarrantyStatus ?? data.warrantyStatus),
        jobFinalStatus: null,
        salesman: data.salesman,
      })
    ) {
      throw new ServiceJobCardError('salesman-required', SALESMAN_REQUIRED_MESSAGE);
    }
    return withTransaction(pool, async (client) => {
      const intakeAt = new Date();
      const today = intakeAt.toISOString().slice(0, 10);
      const content = mergeContent(
        {
          jobCardDate: today,
          customerName: null,
          customerContact: null,
          customerAddress: null,
          itemDescription: null,
          modelNo: null,
          warrantyStatus: null,
          complaint: null,
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
          technicianName: null,
          brand: null,
          salesman: null,
          salesChannel: null,
          jobFinalStatus: 'WIP',
          finalStatus: null,
          finalStatusReason: null,
          schoolContactPerson: null,
          schoolContactNumber: null,
          customerNumber: null,
          customerType: null,
          customerEmail: null,
          region: null,
          b2bBranchSchool: null,
          salesOrderNumber: null,
          legacyReference: null,
          itemCode: null,
          mainGroup: null,
          groupName: null,
          subGroup: null,
          itemInMaster: null,
          serialNo: null,
          purchaseDate: null,
          accessoriesReceived: null,
          conditionNotes: null,
        },
        data,
        await mdaRate(),
        intakeAt.toISOString(),
      );
      if (content.customerType === 'B2C' && content.salesman && !content.salesChannel) {
        const channel = await resolveSalesChannelForSalesman(client, content.salesman);
        if (channel) content.salesChannel = channel;
      }
      const jobCardReference = await allocateWalkInJobCardReference(client, today);
      let jobCard = await insertServiceJobCard(client, {
        jobCardReference,
        appointmentId: null,
        quotationId: null,
        sourceType: 'Walk-in',
        createdBy: profileId,
        content,
        intakeAt,
      });
      jobCard = await applyBilling(
        client,
        null,
        jobCard,
        billing,
        profileId,
        jobCard.finalStatus === 'Delivered',
      );
      await insertServiceJobCardHistory(
        client,
        jobCard.id,
        null,
        'Open',
        profileId,
        'Walk-in intake',
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.created',
        targetType: 'service_job_card',
        targetId: jobCard.id,
        metadata: { jobCardReference: jobCard.jobCardReference, sourceType: 'Walk-in' },
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
    isAdmin = false,
  ) {
    const {
      billing,
      rest: { approvalMethod, approvalNotes, ...rawOverrides },
    } = splitBilling(serviceJobCardUpdateSchema.parse(input ?? {}));
    const overrides = normaliseStatusAlias(rawOverrides);
    return withTransaction(pool, async (client) => {
      const current = await findServiceJobCardById(client, id, true);
      if (!current) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      const releasingApproval =
        current.jobFinalStatus === 'Customer approval pending' &&
        overrides.jobFinalStatus === 'WIP';
      if (releasingApproval && !approvalMethod) {
        throw new ServiceJobCardError(
          'approval-required',
          'Record how the customer approved before moving this job to WIP.',
        );
      }
      if (isJobCardLocked(current) && !isAdmin) {
        throw new ServiceJobCardError(
          'terminal-job-card',
          `A ${current.finalStatus ?? current.jobFinalStatus} job card is locked. Only an administrator can edit it.`,
        );
      }
      const nextJob = overrides.jobFinalStatus ?? current.jobFinalStatus;
      const nextFinal: FinalStatus | null =
        overrides.finalStatus !== undefined ? overrides.finalStatus : current.finalStatus;
      if (
        nextFinal === 'Delivered' &&
        current.finalStatus !== 'Delivered' &&
        !jobFinalStatusesReadyToDeliver.includes(nextJob)
      ) {
        throw new ServiceJobCardError(
          'invalid-transition',
          'Set the job status to Repair Completed or BER before marking it Delivered.',
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
          finalStatus: current.finalStatus,
          finalStatusReason: current.finalStatusReason,
          schoolContactPerson: current.schoolContactPerson,
          schoolContactNumber: current.schoolContactNumber,
          customerNumber: current.customerNumber,
          customerType: current.customerType,
          customerEmail: current.customerEmail,
          region: current.region,
          b2bBranchSchool: current.b2bBranchSchool,
          salesOrderNumber: current.salesOrderNumber,
          legacyReference: current.legacyReference,
          itemCode: current.itemCode,
          mainGroup: current.mainGroup,
          groupName: current.groupName,
          subGroup: current.subGroup,
          itemInMaster: current.itemInMaster,
          serialNo: current.serialNo,
          purchaseDate: current.purchaseDate,
          accessoriesReceived: current.accessoriesReceived,
          conditionNotes: current.conditionNotes,
        },
        overrides,
        await mdaRate(),
        null,
        {
          oowInspection: await oowInspectionRate(),
          effectiveWarranty:
            normalizeWarranty(billing.finalWarrantyStatus ?? current.finalWarrantyStatus) ??
            normalizeWarranty(
              (overrides as { warrantyStatus?: string }).warrantyStatus ?? current.warrantyStatus,
            ),
        },
      );
      if (nextFinal === 'Delivered' && !content.deliveryDate) {
        content.deliveryDate = businessToday();
      }
      const partsOnCard = (list: { partNo?: string; description?: string }[]) =>
        list.filter((part) => part.partNo || part.description).length;
      if (
        nextFinal !== current.finalStatus &&
        finalStatusNeedsReason({ jobStatus: nextJob, finalStatus: nextFinal }) &&
        !content.finalStatusReason
      ) {
        throw new ServiceJobCardError(
          'reason-required',
          'Choose the reason this BER, Rejected or Cancelled job is being delivered back.',
        );
      }
      const partsBefore = partsOnCard(current.parts);
      const partsAfter = partsOnCard(content.parts);
      // A B2C job that ends as BER or Rejected with spare parts fitted needs a manager's
      // approval before the parts are removed or the job is delivered (it is not billed).
      const needsClosureApproval =
        content.customerType === 'B2C' && (nextJob === 'BER' || nextJob === 'Rejected');
      if (
        needsClosureApproval &&
        !isAdmin &&
        current.closureApprovalStatus !== 'Approved' &&
        ((partsAfter < partsBefore && partsBefore > 0) ||
          (nextFinal === 'Delivered' && current.finalStatus !== 'Delivered' && partsAfter > 0))
      ) {
        throw new ServiceJobCardError(
          'closure-approval-required',
          current.closureApprovalStatus === 'Pending'
            ? 'This job is waiting for manager approval. The spare parts cannot be removed and the job cannot be delivered until it is approved.'
            : 'This job carries spare parts. Send it for manager approval before removing the parts or delivering it.',
        );
      }
      if (partsAfter < partsBefore && (jobOutcomeStatuses as readonly string[]).includes(nextJob)) {
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'job_card.parts_removed',
          targetType: 'service_job_card',
          targetId: id,
          metadata: {
            jobCardReference: current.jobCardReference,
            partsBefore,
            partsAfter,
            jobStatus: nextJob,
            finalStatus: nextFinal,
          },
          requestId,
        });
      }
      if (
        salesmanRequired({
          customerType: content.customerType,
          effectiveWarranty:
            normalizeWarranty(billing.finalWarrantyStatus ?? current.finalWarrantyStatus) ??
            normalizeWarranty(
              (overrides as { warrantyStatus?: string }).warrantyStatus ?? current.warrantyStatus,
            ),
          jobFinalStatus: content.jobFinalStatus,
          salesman: content.salesman,
        })
      ) {
        throw new ServiceJobCardError('salesman-required', SALESMAN_REQUIRED_MESSAGE);
      }
      if (content.customerType === 'B2C') {
        // A direct customer has no branch master, but the salesman still supplies the
        // sales channel the job is billed to.
        if (content.salesman && !content.salesChannel) {
          const channel = await resolveSalesChannelForSalesman(client, content.salesman);
          if (channel) content.salesChannel = channel;
        }
      } else {
        // A business job takes its salesman, sales channel, customer number and sales
        // order from the B2B Branch / School master when they are blank (#128).
        const linked = await masterContextFor(client, content);
        for (const key of [
          'salesman',
          'salesChannel',
          'customerNumber',
          'salesOrderNumber',
        ] as const) {
          const value = linked.masterFill[key];
          if (value && !content[key]) content[key] = value;
        }
      }
      let jobCard = await updateServiceJobCardContent(client, id, content, profileId);
      if (!jobCard)
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      jobCard = await applyBilling(
        client,
        current,
        jobCard,
        billing,
        profileId,
        nextFinal === 'Delivered' && current.finalStatus !== 'Delivered',
      );
      if (
        nextFinal === 'Delivered' &&
        current.finalStatus !== 'Delivered' &&
        (jobOutcomeStatuses as readonly string[]).includes(nextJob) &&
        jobCard.paymentBy === 'Sales channel' &&
        Number(jobCard.amountChargeable ?? jobCard.grandTotal) > 0 &&
        !jobCard.billToChannel
      ) {
        throw new ServiceJobCardError(
          'sales-channel-required',
          'Choose the sales channel this job is billed to before delivering it. Open Warranty and billing and set the Sales channel or the Bill to channel.',
        );
      }
      if (current.closureApprovalStatus && nextJob !== 'BER' && nextJob !== 'Rejected') {
        // The job went back to repair work: an old approval no longer applies.
        await client.query(
          `UPDATE service_job_cards SET closure_approval_status = NULL,
             closure_approval_requested_by = NULL, closure_approval_requested_at = NULL,
             closure_approval_decided_by = NULL, closure_approval_decided_at = NULL,
             closure_approval_note = NULL WHERE id = $1`,
          [id],
        );
      }
      const finalChanged = nextFinal !== current.finalStatus;
      if (finalChanged) {
        await insertServiceJobCardHistory(
          client,
          id,
          current.finalStatus,
          nextFinal ?? 'Open',
          profileId,
          content.finalStatusReason ? `Reason: ${content.finalStatusReason}` : undefined,
          requestId,
        );
      }
      if (nextJob !== current.jobFinalStatus || finalChanged) {
        const nextStatus = serviceJobCardStatusForFinal(nextJob, nextFinal, current.status);
        if (nextStatus !== current.status) {
          await updateServiceJobCardStatus(
            client,
            id,
            { status: nextStatus },
            profileId,
            nextStatus === 'Completed' || nextStatus === 'Cancelled',
          );
        }
        let historyReason: string | undefined;
        if (releasingApproval && approvalMethod) {
          const approval = await recordManualApprovalForJob(
            client,
            {
              id,
              quotationId: current.quotationId,
              customerName: current.customerName,
              customerContact: current.customerContact,
              itemDescription: current.itemDescription,
              warrantyStatus: current.warrantyStatus,
              grandTotal: current.grandTotal,
            },
            {
              method: approvalMethod,
              notes: approvalNotes ?? null,
              decidedByName: 'Recorded by staff',
            },
            profileId,
          );
          historyReason = `Customer approved (${approvalMethod}) - ${approval.approvalReference}${
            approvalNotes ? `: ${approvalNotes}` : ''
          }`;
        }
        if (nextJob !== current.jobFinalStatus) {
          await insertServiceJobCardHistory(
            client,
            id,
            current.jobFinalStatus,
            nextJob,
            profileId,
            historyReason,
            requestId,
          );
        }
        jobCard = (await findServiceJobCardById(client, id)) ?? jobCard;
      }
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

  /** A CCE sends a B2C BER/Rejected job that carries spare parts for manager approval. */
  async function requestClosureApproval(
    id: string,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    return withTransaction(pool, async (client) => {
      const job = await findServiceJobCardById(client, id, true);
      if (!job) throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      if (job.customerType !== 'B2C' || !['BER', 'Rejected'].includes(job.jobFinalStatus)) {
        throw new ServiceJobCardError(
          'invalid-transition',
          'Only a B2C job with the job status BER or Rejected can be sent for closure approval.',
        );
      }
      if (!job.parts.some((part) => part.partNo || part.description)) {
        throw new ServiceJobCardError(
          'invalid-transition',
          'This job has no spare parts, so it does not need approval.',
        );
      }
      if (job.closureApprovalStatus === 'Pending' || job.finalStatus === 'Delivered') {
        throw new ServiceJobCardError(
          'invalid-transition',
          job.finalStatus === 'Delivered'
            ? 'This job is already delivered.'
            : 'This job is already waiting for approval.',
        );
      }
      await setServiceJobCardClosureApproval(client, id, { status: 'Pending', profileId });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.closure_approval_requested',
        targetType: 'service_job_card',
        targetId: id,
        metadata: { jobCardReference: job.jobCardReference },
        requestId,
      });
      return (await findServiceJobCardById(client, id)) ?? job;
    });
  }

  /** A manager approves or declines a closure-approval request. */
  async function decideClosureApproval(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const body = (input ?? {}) as { decision?: string; note?: string };
    if (body.decision !== 'Approved' && body.decision !== 'Declined') {
      throw new ServiceJobCardError('invalid-transition', 'Choose Approved or Declined.');
    }
    const decision = body.decision;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    return withTransaction(pool, async (client) => {
      const job = await findServiceJobCardById(client, id, true);
      if (!job) throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      if (job.closureApprovalStatus !== 'Pending') {
        throw new ServiceJobCardError(
          'invalid-transition',
          'This job is not waiting for closure approval.',
        );
      }
      await setServiceJobCardClosureApproval(client, id, { status: decision, profileId, note });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: `job_card.closure_approval_${decision.toLowerCase()}`,
        targetType: 'service_job_card',
        targetId: id,
        metadata: { jobCardReference: job.jobCardReference, note },
        requestId,
      });
      return (await findServiceJobCardById(client, id)) ?? job;
    });
  }

  async function list(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return listServiceJobCards(client, {
        status: typeof query.status === 'string' ? query.status : undefined,
        search: typeof query.search === 'string' ? query.search : undefined,
        forApproval: query.forApproval === 'true',
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
      const master = await masterContextFor(client, jobCard);
      const approval = await findLatestApprovalForJobCard(client, id);
      return { jobCard, history, approval, ...master };
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
      if (data.status === 'Completed') {
        const reason = deliveryBlockReason({
          amount: billedAmount({
            amountChargeable:
              current.amountChargeable === null ? null : Number(current.amountChargeable),
            grandTotal: Number(current.grandTotal),
          }),
          billingJobType: current.billingJobType,
          paymentBy: current.paymentBy,
          invoiceNo: gateInvoiceNo(current),
          paymentConfirmed: Boolean(current.paymentConfirmedAt),
        });
        if (reason) throw new ServiceJobCardError('billing-blocked', reason);
      }
      const finalized = data.status === 'Completed' || data.status === 'Cancelled';
      const result = await updateServiceJobCardStatus(client, id, data, profileId, finalized);
      if (!result)
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      if (data.status === 'Completed') {
        await setServiceJobCardFinalStatus(client, id, 'Delivered');
        await setServiceJobCardDeliveryDateIfBlank(client, id, businessToday());
      }
      if (data.status === 'Cancelled') await setServiceJobCardJobStatus(client, id, 'Cancelled');
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
    requestClosureApproval,
    decideClosureApproval,
    prefillFromQuotation,
    createFromQuotation,
    byQuotation,
    createWalkIn,
    walkInContactCheck,
    listAwaiting,
  };
}

export type ServiceJobCardService = ReturnType<typeof createServiceJobCardService>;
