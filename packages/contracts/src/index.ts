import { z } from 'zod';

// Matches the live system's three customer types exactly (see
// docs/PARITY_REVIEW_2026-09-28.md, gap #3). 'B2B-SalesChannel' is a real,
// reporting-relevant tier in the live Revenue Dashboard (different margin/
// commission treatment from a direct B2B job) — it is not the same as B2B
// and must not be collapsed into it.
export const customerTypes = ['B2C', 'B2B', 'B2B-SalesChannel'] as const;
export const complaintStatuses = [
  'New',
  'Under Review',
  'Pending Information',
  'Ready for Scheduling',
  'Scheduled',
  'Closed',
  'Cancelled',
] as const;

export const complaintStatusSchema = z.enum(complaintStatuses);
export const customerTypeSchema = z.enum(customerTypes);

const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).optional();

// The 8 emirates the live public complaint form offers as a fixed dropdown
// (see docs/PARITY_REVIEW_2026-09-28.md, gap #4). Exported so the web UI can
// build its <select> from one source of truth instead of a hardcoded list.
// Not enforced server-side as a strict enum — the live backend never
// validates region against this list either, only its own front-end select
// constrains it; keeping this field as free text here avoids breaking any
// other flow (branch admin form, standalone staff-created appointments) that
// may send a region this list doesn't cover.
export const uaeRegions = [
  'Dubai',
  'Sharjah',
  'Ajman',
  'Ras Al Khaimah',
  'Fujairah',
  'Umm Al Quwain',
  'Abu Dhabi',
  'Al Ain',
] as const;

export const publicComplaintSchema = z
  .object({
    customerType: customerTypeSchema,
    customerName: z.string().trim().min(1).max(200),
    // Required by default (B2C and B2B-SalesChannel); optional only for a
    // B2B corporate account, which rarely has one relevant mobile number to
    // collect on a public form -- enforced conditionally below, see
    // modification.md #1.
    contactNumber: optionalText(50),
    customerEmail: z.string().trim().email().max(320).optional(),
    address: optionalText(500),
    region: optionalText(120),
    brand: optionalText(120),
    model: optionalText(120),
    serialOrItemCode: optionalText(120),
    description: z.string().trim().min(1).max(10000),
    // B2B/school workflow fields — see docs/PARITY_REVIEW_2026-09-28.md, gap #1.
    // Plain optional text, exactly like the live ComplaintRegistration_26.html
    // public form: never gated, no picker required, blank for a B2C submission.
    // Plain free text (see modification.md #2 -- the public form never
    // offers the master list itself, to avoid exposing the whole B2B
    // customer roster publicly). Staff match it to the b2b_branches master
    // list afterwards via PATCH /api/complaints/{id}/b2b-branch.
    b2bBranchSchool: optionalText(500),
    schoolContactPerson: optionalText(500),
    schoolContactNumber: optionalText(100),
    customerNumber: optionalText(100),
    salesOrderNumber: optionalText(100),
    // Staff set the warranty status when they register the request (the
    // public form never sends it; the public route drops it).
    warrantyClassification: z.enum(['In Warranty', 'Out Warranty']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Required by default (including a B2C submission); only a B2B
    // corporate account skips it, since the site contact person/number
    // already cover that case and a corporate account rarely has one
    // relevant mobile number to collect here. See modification.md #1.
    if (value.customerType !== 'B2B' && !value.contactNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactNumber'],
        message: 'Contact number is required for this customer type.',
      });
    }
  });

export type PublicComplaintInput = z.infer<typeof publicComplaintSchema>;

const queryNumber = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(minimum).max(maximum),
  );

export const complaintListQuerySchema = z
  .object({
    status: complaintStatusSchema.optional(),
    region: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

export type ComplaintListQuery = z.infer<typeof complaintListQuerySchema>;

export const complaintWarrantyClassifications = ['In Warranty', 'Out Warranty'] as const;

// Either field may be sent on its own; an empty warrantyClassification clears it.
export const complaintNotesSchema = z
  .object({
    notes: z.string().trim().min(1).max(10000).optional(),
    warrantyClassification: z.enum(['', ...complaintWarrantyClassifications]).optional(),
  })
  .strict()
  .refine((value) => value.notes !== undefined || value.warrantyClassification !== undefined, {
    message: 'Send notes, a warranty classification, or both.',
  });

export type ComplaintNotesInput = z.infer<typeof complaintNotesSchema>;

export const complaintStatusUpdateSchema = z
  .object({
    status: complaintStatusSchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export type ComplaintStatusUpdateInput = z.infer<typeof complaintStatusUpdateSchema>;

// Staff-only linking of a complaint's free-text "B2B Branch / School" to the
// authenticated master list (see modification.md #2) -- the public form
// never sees or picks from that list, only staff do, after the complaint is
// registered. custCode: null unlinks (keeps the customer's original typed
// text, just clears the link).
export const b2bBranchLinkSchema = z
  .object({
    custCode: z.string().trim().regex(/^\d+$/).max(40).nullable(),
  })
  .strict();

export type B2bBranchLinkInput = z.infer<typeof b2bBranchLinkSchema>;

export type ComplaintStatus = (typeof complaintStatuses)[number];
export type CustomerType = (typeof customerTypes)[number];

export const appointmentStatuses = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'] as const;
export const appointmentStatusSchema = z.enum(appointmentStatuses);
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const serviceJobCardStatuses = ['Open', 'In Progress', 'Completed', 'Cancelled'] as const;
export const serviceJobCardStatusSchema = z.enum(serviceJobCardStatuses);
export type ServiceJobCardStatus = (typeof serviceJobCardStatuses)[number];

export const serviceJobCardStatusTransitions: Record<
  ServiceJobCardStatus,
  readonly ServiceJobCardStatus[]
> = {
  Open: ['In Progress', 'Cancelled'],
  'In Progress': ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export const serviceJobCardStatusUpdateSchema = z
  .object({
    status: serviceJobCardStatusSchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ServiceJobCardStatusUpdateInput = z.infer<typeof serviceJobCardStatusUpdateSchema>;

// Matches the live system's JOB_FINAL_STATUS_OPTIONS exactly (docs/code.gs).
export const customerWriteSchema = z
  .object({
    customerType: customerTypeSchema,
    name: z.string().trim().min(1).max(200),
    contactNumber: z.string().trim().min(1).max(50),
    email: z.string().trim().email().max(320).optional(),
    address: optionalText(500),
    region: optionalText(120),
  })
  .strict();

export const branchWriteSchema = z
  .object({
    customerId: z.string().regex(/^\d+$/).optional(),
    name: z.string().trim().min(1).max(200),
    contactPerson: optionalText(120),
    contactNumber: z.string().trim().min(1).max(50).optional(),
    address: optionalText(500),
    region: optionalText(120),
    customerNumber: optionalText(120),
  })
  .strict();

export const technicianWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    region: optionalText(120),
    phone: optionalText(50),
    email: z.string().trim().email().max(320).optional(),
    active: z.boolean().optional(),
    // Max appointments this technician can be assigned on a single calendar
    // day; admin-changeable (see modification.md #8). Defaults to 10 at the
    // database level when omitted on create.
    maxAppointmentsPerDay: z.number().int().min(1).max(999).optional(),
  })
  .strict();

// Salesmen and Sales Channels: small admin-managed master lists (see
// modification.md #8). Sales Channel write is deliberately restricted to
// the admin role only at the permission-grant level (super-admin option).
export const billingRuleWriteSchema = z
  .object({
    salesman: z.string().trim().min(1).max(200).nullish(),
    branchKeyword: z.string().trim().min(1).max(200).nullish(),
    billToChannel: z.string().trim().min(1).max(200),
    active: z.boolean().optional(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((value) => Boolean(value.salesman) || Boolean(value.branchKeyword), {
    message: 'Enter a salesman, a branch keyword, or both.',
  });
export type BillingRuleWriteInput = z.infer<typeof billingRuleWriteSchema>;

export const salesmanWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    active: z.boolean().optional(),
    salesChannel: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type SalesmanWriteInput = z.infer<typeof salesmanWriteSchema>;

export const salesChannelWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    active: z.boolean().optional(),
  })
  .strict();
export type SalesChannelWriteInput = z.infer<typeof salesChannelWriteSchema>;

export const masterDataListQuerySchema = z
  .object({
    active: z.enum(['true', 'false']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    // Master data lists (salesmen, sales channels) have no pagination UI --
    // the frontend fetches the whole list in one request (pageSize=200), so
    // the cap here has to be at least that high or every such fetch fails
    // Zod validation with a generic "request body is invalid" error.
    pageSize: queryNumber(25, 1, 500),
  })
  .strict();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm format.');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Date must be a real calendar date.');

// A separate concept from serviceJobCardStatuses above: this is the outcome/
// diagnostic field a CCE sets as work progresses, not the workflow-lock state.
export const jobFinalStatuses = [
  'WIP',
  'Spare pending',
  'BER',
  'Rejected',
  'Repair Completed',
  'Delivered',
  'Cancelled',
] as const;
export const warrantyStatuses = ['In Warranty', 'Out Warranty'] as const;
export const paymentByOptions = ['Sales channel', 'Customer'] as const;
export const paymentModes = ['Cash', 'Online', 'Bank transfer', 'Card'] as const;
export const billingJobTypes = ['CSIJW', 'CSIJO'] as const;

export const jobFinalStatusSchema = z.enum(jobFinalStatuses);
export type JobFinalStatus = (typeof jobFinalStatuses)[number];

// Job final status is the one status users see on a job card. Delivered and
// Cancelled lock the card: after that only an administrator can edit it.
export const jobFinalStatusesLocked: readonly JobFinalStatus[] = ['Delivered', 'Cancelled'];
// Outcomes that must be reached before a job can be marked Delivered.
export const jobFinalStatusesReadyToDeliver: readonly JobFinalStatus[] = [
  'Repair Completed',
  'BER',
  'Rejected',
];

// The internal workflow status (used by the dashboard and TAT) follows the
// job final status; nobody sets it by hand any more.
export function serviceJobCardStatusForFinal(
  final: JobFinalStatus,
  current: ServiceJobCardStatus,
): ServiceJobCardStatus {
  if (final === 'Cancelled') return 'Cancelled';
  if (final === 'WIP' || final === 'Spare pending') {
    return current === 'Open' ? 'Open' : 'In Progress';
  }
  return 'Completed';
}

export const jobCardPartSchema = z
  .object({
    partNo: z.string().trim().max(120).optional().default(''),
    description: z.string().trim().max(300).optional().default(''),
    qty: z.number().min(0).max(100000).optional().default(0),
    unitPrice: z.number().min(0).max(10000000).optional().default(0),
  })
  .strict();
export type JobCardPart = z.infer<typeof jobCardPartSchema>;

// The content fields a job card carries, matching the live system's
// HEADERS_BY_TYPE['service-job-card'] (docs/code.gs). Shared between create
// (where these values start out pulled from the source appointment, then are
// whatever the CCE edited before saving) and update (editing an existing,
// non-terminal job card as work progresses) -- both accept the same shape,
// all optional, because a create call only needs to override what the
// pre-fill got wrong and an update call only needs to change what's new.
const jobCardContentFields = {
  jobCardDate: dateSchema.optional(),
  customerName: optionalText(200),
  customerContact: optionalText(50),
  customerAddress: optionalText(500),
  itemDescription: optionalText(300),
  modelNo: optionalText(120),
  warrantyStatus: optionalText(50),
  complaint: optionalText(10000),
  serviceRendered: optionalText(10000),
  // Free-form datetime strings (matches the live <input type="datetime-local">
  // field) rather than a strict ISO schema -- time_consumed_hours is derived
  // server-side from these two when both are present and parseable.
  periodFrom: optionalText(40),
  periodTo: optionalText(40),
  parts: z.array(jobCardPartSchema).max(50).optional(),
  serviceCharge: z.number().min(0).max(10000000).optional(),
  amountChargeable: z.number().min(0).max(10000000).optional(),
  invoiceNo: optionalText(120),
  deliveryDate: dateSchema.optional(),
  technicianName: optionalText(120),
  brand: optionalText(120),
  jobFinalStatus: jobFinalStatusSchema.optional(),
  // Stock-master item fields (modification.md #59) -- filled by the item
  // lookup, always editable. itemInMaster is false when the item was typed in
  // by hand because it is not in the ERP stock master.
  itemCode: optionalText(120),
  mainGroup: optionalText(120),
  groupName: optionalText(120),
  subGroup: optionalText(120),
  itemInMaster: z.boolean().optional(),
  serialNo: optionalText(120),
  purchaseDate: dateSchema.optional(),
  accessoriesReceived: optionalText(1000),
  conditionNotes: optionalText(2000),
  schoolContactPerson: optionalText(500),
  schoolContactNumber: optionalText(100),
  customerNumber: optionalText(100),
  customerType: z.enum(['B2C', 'B2B']).optional(),
  customerEmail: optionalText(320),
  region: optionalText(80),
  b2bBranchSchool: optionalText(300),
  salesOrderNumber: optionalText(100),
  // Picked from the salesmen / sales_channels master lists on the UI, both
  // stored as plain text -- see modification.md #8.
  salesman: optionalText(200),
  salesChannel: optionalText(200),
  // Warranty and billing (migration 034). The warranty status above is what
  // was registered at the start; the final status is what the technician
  // confirms after inspecting the item and is what billing follows.
  finalWarrantyStatus: z.enum(['In Warranty', 'Out Warranty']).optional(),
  warrantyOverrideReason: optionalText(1000),
  paymentBy: z.enum(['Sales channel', 'Customer']).optional(),
  // Empty string = clear a manual override and go back to the automatic rule.
  billToChannel: z.string().trim().max(200).optional(),
  invoiceDate: dateSchema.optional(),
  paymentMode: z.enum(['Cash', 'Online', 'Bank transfer', 'Card']).optional(),
  paymentReference: optionalText(200),
  // true records that the payment was received (stamped with who and when);
  // false clears a confirmation made in error.
  paymentConfirmed: z.boolean().optional(),
  // Optional free-text reference to a corresponding document in the legacy
  // Google Sheets/Apps Script system, printed alongside this record's own
  // reference (see "Add print views and legacy-reference preservation",
  // Phase 5).
  legacyReference: optionalText(120),
};

export const serviceJobCardCreateSchema = z.object(jobCardContentFields).strict();
export type ServiceJobCardCreateInput = z.infer<typeof serviceJobCardCreateSchema>;

// A walk-in job card has no complaint, appointment or quotation behind it, so
// the counter staff must capture who the customer is, what they brought and
// what is wrong with it.
export const walkInJobCardCreateSchema = z
  .object(jobCardContentFields)
  .strict()
  .superRefine((value, context) => {
    if (!value.customerName) {
      context.addIssue({
        code: 'custom',
        path: ['customerName'],
        message: 'Customer name is required.',
      });
    }
    if (!value.customerType) {
      context.addIssue({
        code: 'custom',
        path: ['customerType'],
        message: 'Select the customer type (B2C or B2B).',
      });
    }
    if (value.customerType === 'B2B') {
      if (!value.customerContact && !value.b2bBranchSchool) {
        context.addIssue({
          code: 'custom',
          path: ['b2bBranchSchool'],
          message: 'Enter the B2B branch / school or a contact number.',
        });
      }
    } else if (!value.customerContact) {
      context.addIssue({
        code: 'custom',
        path: ['customerContact'],
        message: 'Customer contact is required.',
      });
    }
    if (!value.modelNo && !value.itemDescription && !value.itemCode) {
      context.addIssue({
        code: 'custom',
        path: ['modelNo'],
        message: 'Enter the model, item code or item description.',
      });
    }
    if (!value.complaint) {
      context.addIssue({
        code: 'custom',
        path: ['complaint'],
        message: 'Describe the fault the customer reported.',
      });
    }
  });
export type WalkInJobCardCreateInput = z.infer<typeof walkInJobCardCreateSchema>;

export const serviceJobCardUpdateSchema = z.object(jobCardContentFields).strict();
export type ServiceJobCardUpdateInput = z.infer<typeof serviceJobCardUpdateSchema>;

// Quotation and inspection records (Phase 5 -- docs/DEVELOPMENT_PLAN.md),
// matching the live system's HEADERS_BY_TYPE['quotation'] and
// ['inspection'] (docs/code.gs). Unlike job cards, neither has an enforced
// workflow status in the live system -- Prepared/Approved and
// Inspected/Reviewed by/date are plain fields the CCE fills in, so these
// schemas carry no status field and no transition rules.
export const quotationWriteSchema = z
  .object({
    appointmentId: z.string().regex(/^\d+$/).optional(),
    quotationDate: dateSchema.optional(),
    customerName: optionalText(200),
    contactNumber: optionalText(50),
    projectName: optionalText(200),
    siteLocation: optionalText(500),
    dateOfCollection: dateSchema.optional(),
    technicianName: optionalText(120),
    customerComplaint: optionalText(10000),
    technicalDiagnosis: optionalText(10000),
    products: z.array(jobCardPartSchema).max(50).optional(),
    parts: z.array(jobCardPartSchema).max(50).optional(),
    labourAmount: z.number().min(0).max(10000000).optional(),
    preparedBy: optionalText(120),
    preparedDate: dateSchema.optional(),
    approvedBy: optionalText(120),
    approvedDate: dateSchema.optional(),
    customerSignature: optionalText(200),
    signatureDate: dateSchema.optional(),
    legacyReference: optionalText(120),
  })
  .strict();
export type QuotationWriteInput = z.infer<typeof quotationWriteSchema>;

export const quotationListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    appointmentId: z.string().regex(/^\d+$/).optional(),
    // "true" excludes quotations that already have a service job card --
    // used by the "create job card from Quotation" picker (modification.md #18).
    unused: z.enum(['true', 'false']).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

export const inspectionWriteSchema = z
  .object({
    appointmentId: z.string().regex(/^\d+$/).optional(),
    inspectionDate: dateSchema.optional(),
    customerName: optionalText(200),
    contactNumber: optionalText(50),
    projectName: optionalText(200),
    siteLocation: optionalText(500),
    dateOfCollection: dateSchema.optional(),
    technicianName: optionalText(120),
    customerComplaint: optionalText(10000),
    visualFindings: optionalText(10000),
    technicalDiagnosis: optionalText(10000),
    products: z.array(jobCardPartSchema).max(50).optional(),
    faultyParts: z.array(jobCardPartSchema).max(50).optional(),
    recommendedAction: optionalText(10000),
    refQuotationNo: optionalText(120),
    warrantyStatus: optionalText(50),
    estRepairCost: z.number().min(0).max(10000000).optional(),
    inspectedBy: optionalText(120),
    inspectedDate: dateSchema.optional(),
    reviewedBy: optionalText(120),
    reviewedDate: dateSchema.optional(),
    customerSignature: optionalText(200),
    signatureDate: dateSchema.optional(),
    legacyReference: optionalText(120),
  })
  .strict();
export type InspectionWriteInput = z.infer<typeof inspectionWriteSchema>;

export const inspectionListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    appointmentId: z.string().regex(/^\d+$/).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// VAS sale + printable certificate (modification.md #35 -- "Issue a VAS
// Sale -- Customer Certificate", docs/index.html's VAS Sales tab /
// docs/code.gs HEADERS_BY_TYPE['vas-sale']). planKey is not in the legacy
// sheet -- added so the certificate's plan-specific legal text
// (apps/web/src/app.js VAS_PLAN_CONTENT) can be looked up exactly by key on
// any future reprint, rather than fuzzy-matching the stored plan label.
export const vasSalePlanKeys = ['ew1', 'ew2', 'di1', 'premium'] as const;
export const vasSalePlanKeySchema = z.enum(vasSalePlanKeys);

export const vasSaleWriteSchema = z
  .object({
    saleDate: dateSchema.optional(),
    customerName: optionalText(200),
    contactNumber: optionalText(50),
    address: optionalText(500),
    invoiceNumber: optionalText(120),
    purchaseDate: dateSchema.optional(),
    itemCode: optionalText(120),
    itemDescription: optionalText(300),
    planKey: vasSalePlanKeySchema,
    vasProduct: z.string().trim().min(1).max(200),
    sellingPrice: z.number().min(0).max(10000000),
    planFee: z.number().min(0).max(10000000),
    deductible: z.number().min(0).max(10000000).optional(),
    serviceFeeText: optionalText(300),
    contractRef: optionalText(120),
  })
  .strict();
export type VasSaleWriteInput = z.infer<typeof vasSaleWriteSchema>;

export const vasSaleListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// AMC contract + printable certificate (modification.md #38 -- "Issue an
// AMC Contract -- Customer Certificate", docs/code.gs
// HEADERS_BY_TYPE['amc-contract'] / docs/index_sep_15.html's AMC Contract
// tab). Unlike VAS (one item, one plan), an AMC contract covers a whole
// appliance schedule priced as a single contract, so `appliances` is an
// array rather than flat columns -- matching how the AMC Quote Calculator
// (modification.md #32) already represents them client-side.
export const amcContractPlanKeys = ['basic-rm', 'standard-pmc', 'premium-pmc'] as const;
export const amcContractPlanKeySchema = z.enum(amcContractPlanKeys);

const amcApplianceLineSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    qty: z.number().min(0).max(100000),
    price: z.number().min(0).max(10000000),
  })
  .strict();

// One of the 3 plans computed for a saved AMC contract's appliance
// schedule (modification.md #39 -- the Excel workflow saves the full
// quote, not one chosen plan; which plan to print is picked afterwards).
const amcContractPlanComputationSchema = z
  .object({
    planKey: amcContractPlanKeySchema,
    planLabel: z.string().trim().min(1).max(100),
    coverage: optionalText(200),
    coverageDetail: optionalText(300),
    // Full "Service Scope -- Inclusions & Exclusions" wording for this
    // plan, from the Contract Quotation sheet's section 4 scope table
    // (modification.md #41) -- stored per plan (like coverage/
    // coverageDetail already were) so a reprint always shows exactly what
    // applied when this contract was saved, even if the admin text
    // changes later.
    included: optionalText(600),
    notIncluded: optionalText(600),
    visitsText: optionalText(100),
    annualVisits: z.number().min(0).max(1000),
    laborCost: z.number().min(0).max(10000000),
    transportCost: z.number().min(0).max(10000000),
    partsReserve: z.number().min(0).max(10000000),
    directCost: z.number().min(0).max(10000000),
    overhead: z.number().min(0).max(10000000),
    priceExclVat: z.number().min(0).max(10000000),
    priceInclVat: z.number().min(0).max(10000000),
  })
  .strict();

export const amcContractWriteSchema = z
  .object({
    contractDate: dateSchema.optional(),
    contractPeriod: optionalText(50),
    clientName: optionalText(200),
    attentionTo: optionalText(200),
    siteLocation: optionalText(500),
    appliances: z.array(amcApplianceLineSchema).min(1).max(200),
    totalCount: z.number().min(0).max(100000),
    totalValue: z.number().min(0).max(100000000),
    plans: z.array(amcContractPlanComputationSchema).min(1).max(3),
    commencementDate: dateSchema.optional(),
    contractRef: optionalText(120),
  })
  .strict();
export type AmcContractWriteInput = z.infer<typeof amcContractWriteSchema>;
export type AmcContractPlanComputation = z.infer<typeof amcContractPlanComputationSchema>;

export const amcContractStatuses = ['Quote', 'Sold', 'Lost'] as const;

// Moves a saved AMC record between Quote, Sold (with the plan the customer
// took) and Lost. Sold copies that plan's price at that moment.
export const amcContractStatusSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('Sold'),
      planKey: amcContractPlanKeySchema,
      soldDate: dateSchema,
      contractRef: optionalText(120),
    })
    .strict(),
  z.object({ status: z.literal('Lost'), reason: optionalText(300) }).strict(),
  z.object({ status: z.literal('Quote') }).strict(),
]);
export type AmcContractStatusInput = z.infer<typeof amcContractStatusSchema>;

export const amcContractListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(amcContractStatuses).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// Rate Card sale + printable quotation (modification.md #43 -- "Issue a
// Rate Card Sale"). A Rate Card sale is one or more line items (section +
// activity + rate + qty) priced as a single quotation total, matching how
// the Rate Card Calculator (modification.md #32) already represents them
// client-side -- so lineItems is an array rather than flat columns, the
// same shape choice amc_contracts' appliances made.
export const rateCardSaleLineItemSchema = z
  .object({
    sectionLabel: z.string().trim().min(1).max(200),
    activityName: z.string().trim().min(1).max(200),
    rate: z.number().min(0).max(10000000),
    qty: z.number().min(0).max(100000),
  })
  .strict();

export const rateCardSaleWriteSchema = z
  .object({
    saleDate: dateSchema.optional(),
    clientName: optionalText(200),
    contactNumber: optionalText(50),
    siteLocation: optionalText(500),
    lineItems: z.array(rateCardSaleLineItemSchema).min(1).max(200),
    totalValue: z.number().min(0).max(100000000),
    contractRef: optionalText(120),
  })
  .strict();
export type RateCardSaleWriteInput = z.infer<typeof rateCardSaleWriteSchema>;
export type RateCardSaleLineItemInput = z.infer<typeof rateCardSaleLineItemSchema>;

export const rateCardSaleListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// Thomson sale + printable quotation (modification.md #44 -- "Issue a
// Thomson Sale"). Unlike Rate Card's line items (rate * qty is always
// reproducible later), a Thomson line's price depends on admin rates that
// can change (tech rate, region round-trip cost, add-on rates, team
// capacity) and the "Customer transport share %" chosen at save time -- so,
// like amcContractPlanComputationSchema, each line item carries its own
// fully computed numbers rather than just the raw inputs, so a reprint
// later always matches what the customer was quoted.
export const thomsonSaleLineItemSchema = z
  .object({
    region: z.string().trim().min(1).max(100),
    applianceName: z.string().trim().min(1).max(200),
    qty: z.number().min(0).max(100000),
    siteVisits: z.number().min(0).max(1000),
    trainingSessions: z.number().min(0).max(1000),
    unitRate: z.number().min(0).max(10000000),
    applianceSubtotal: z.number().min(0).max(100000000),
    addonRevenue: z.number().min(0).max(100000000),
    transportCost: z.number().min(0).max(100000000),
    totalPrice: z.number().min(0).max(100000000),
    totalCost: z.number().min(0).max(100000000),
    margin: z.number().min(-100000000).max(100000000),
  })
  .strict();

export const thomsonSaleWriteSchema = z
  .object({
    saleDate: dateSchema.optional(),
    clientName: optionalText(200),
    contactNumber: optionalText(50),
    siteLocation: optionalText(500),
    transportSharePercent: z.number().min(0).max(100),
    lineItems: z.array(thomsonSaleLineItemSchema).min(1).max(200),
    totalPrice: z.number().min(0).max(100000000),
    totalCost: z.number().min(0).max(100000000),
    margin: z.number().min(-100000000).max(100000000),
    contractRef: optionalText(120),
  })
  .strict();
export type ThomsonSaleWriteInput = z.infer<typeof thomsonSaleWriteSchema>;
export type ThomsonSaleLineItemInput = z.infer<typeof thomsonSaleLineItemSchema>;

export const thomsonSaleListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// Service Revenue Dashboard + Budget vs Actual (modification.md #49, #50).
// Fed by admin uploads of the master Excel workbooks until ERP access exists.
export const revenueImportKinds = ['revenue', 'budget'] as const;
export const revenueImportKindSchema = z.enum(revenueImportKinds);

export const revenueDimensions = [
  'year',
  'month',
  'week',
  'period',
  'yearWeek',
  'jobType',
  'channel',
  'salesPerson',
  'customer',
  'costStatus',
  'billingCode',
  'jobStatus',
  'orderStatus',
] as const;
export const revenueDimensionSchema = z.enum(revenueDimensions);

export const revenueExceptionKeys = [
  'billingReview',
  'channelReview',
  'costReview',
  'zeroRevenue',
  'notApproved',
  'unmatchedOrder',
  'noCustomer',
] as const;

const filterText = z.string().trim().min(1).max(200).optional();
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const revenueFilterQuerySchema = z
  .object({
    year: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
    ),
    month: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{1,2}$/)
        .optional(),
    ),
    week: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{1,2}$/)
        .optional(),
    ),
    period: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
    ),
    yearWeek: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{4}-W\d{2}$/)
        .optional(),
    ),
    jobType: z.preprocess(emptyToUndefined, filterText),
    channel: z.preprocess(emptyToUndefined, filterText),
    salesPerson: z.preprocess(emptyToUndefined, filterText),
    customer: z.preprocess(emptyToUndefined, filterText),
    costStatus: z.preprocess(emptyToUndefined, filterText),
    billingCode: z.preprocess(emptyToUndefined, filterText),
    jobStatus: z.preprocess(emptyToUndefined, filterText),
    orderStatus: z.preprocess(emptyToUndefined, filterText),
    exception: z.preprocess(emptyToUndefined, z.enum(revenueExceptionKeys).optional()),
    search: z.preprocess(emptyToUndefined, filterText),
  })
  .strict();

export const revenueLinesQuerySchema = revenueFilterQuerySchema
  .extend({
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(50, 1, 200),
  })
  .strict();

export const revenueGroupQuerySchema = revenueFilterQuerySchema
  .extend({ dimension: revenueDimensionSchema })
  .strict();

export const revenueMatrixQuerySchema = revenueFilterQuerySchema
  .extend({ rowDimension: revenueDimensionSchema, columnDimension: revenueDimensionSchema })
  .strict();

// Out-of-warranty approval requests (Phase 5 -- docs/DEVELOPMENT_PLAN.md).
// New functionality, not a live-system parity item: staff raise a request
// against a job card or inspection that's Out of Warranty, and the customer
// approves or declines it themselves through an unauthenticated link
// (see apps/web/src/approve.html and /api/public/warranty-approvals/*).
export const warrantyApprovalStatuses = ['Pending', 'Approved', 'Declined'] as const;
export const warrantyApprovalStatusSchema = z.enum(warrantyApprovalStatuses);
export type WarrantyApprovalStatus = (typeof warrantyApprovalStatuses)[number];

export const warrantyApprovalCreateSchema = z
  .object({
    jobCardId: z.string().regex(/^\d+$/).optional(),
    inspectionId: z.string().regex(/^\d+$/).optional(),
    customerName: optionalText(200),
    contactNumber: optionalText(50),
    itemDescription: optionalText(300),
    warrantyStatus: optionalText(50),
    estimatedCost: z.number().min(0).max(10000000).optional(),
    notes: optionalText(2000),
  })
  .strict()
  .refine((value) => Boolean(value.jobCardId) !== Boolean(value.inspectionId), {
    message: 'Provide exactly one of jobCardId or inspectionId.',
    path: ['jobCardId'],
  });
export type WarrantyApprovalCreateInput = z.infer<typeof warrantyApprovalCreateSchema>;

export const warrantyApprovalListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    status: warrantyApprovalStatusSchema.optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

// Submitted by the customer through the unauthenticated approval link --
// deliberately a small, separate shape from the create schema above (no
// reference to internal record ids, no cost editing).
export const warrantyApprovalDecisionSchema = z
  .object({
    decision: z.enum(['Approved', 'Declined']),
    decidedByName: z.string().trim().min(1).max(200),
    decisionNotes: optionalText(2000),
  })
  .strict();
export type WarrantyApprovalDecisionInput = z.infer<typeof warrantyApprovalDecisionSchema>;

export const availabilityWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startsAt: timeSchema,
    endsAt: timeSchema,
  })
  .strict()
  .refine((value) => value.startsAt < value.endsAt, {
    message: 'Availability start time must be before its end time.',
    path: ['endsAt'],
  });

export const technicianAvailabilitySchema = z
  .object({ windows: z.array(availabilityWindowSchema).max(7) })
  .strict()
  .superRefine((value, context) => {
    const weekdays = value.windows.map((window) => window.weekday);
    if (new Set(weekdays).size !== weekdays.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only one window is allowed per weekday.',
      });
    }
  });

export const appointmentCreateSchema = z
  .object({
    complaintId: z.string().regex(/^\d+$/).optional(),
    customerId: z.string().regex(/^\d+$/).optional(),
    branchId: z.string().regex(/^\d+$/).optional(),
    technicianId: z.string().regex(/^\d+$/).optional(),
    customerType: customerTypeSchema.optional(),
    customerName: z.string().trim().min(1).max(200).optional(),
    contactNumber: z.string().trim().min(1).max(50).optional(),
    customerEmail: z.string().trim().email().max(320).optional(),
    address: optionalText(500),
    region: optionalText(120),
    brand: optionalText(120),
    model: optionalText(120),
    itemCode: optionalText(120),
    faultDescription: z.string().trim().min(1).max(10000).optional(),
    jobWarranty: optionalText(120),
    salesOrderNumber: optionalText(120),
    // B2B/school workflow + product-category fields — see
    // docs/PARITY_REVIEW_2026-09-28.md, gaps #1 and #2. Always optional and
    // editable regardless of customerType, matching the live Scheduler's
    // "select branch, or type it in manually, never gated" rule.
    b2bBranchSchool: optionalText(500),
    schoolContactPerson: optionalText(500),
    schoolContactNumber: optionalText(100),
    customerNumber: optionalText(100),
    subGroup: optionalText(120),
    // Free text, picked from the salesmen master list on the UI but stored
    // as plain text (matches how b2bBranchSchool works) -- see
    // modification.md #8.
    salesman: optionalText(200),
    appointmentDate: dateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const standaloneFields = [
      value.customerType,
      value.customerName,
      value.contactNumber,
      value.faultDescription,
    ];
    const hasStandalone = standaloneFields.some((field) => field !== undefined);
    if (value.complaintId && hasStandalone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Linked appointments cannot include standalone customer fields.',
      });
    }
    if (!value.complaintId && standaloneFields.some((field) => field === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Standalone appointments require customerType, customerName, contactNumber, and faultDescription.',
      });
    }
  });

export const appointmentAssignmentSchema = z
  .object({
    technicianId: z.string().regex(/^\d+$/).nullable(),
  })
  .strict();
export const appointmentMessageTemplates = [
  'customer_booked',
  'customer_rescheduled',
  'technician_assigned',
] as const;
export const appointmentMessageChannels = ['whatsapp', 'email'] as const;
export const appointmentMessageCreateSchema = z
  .object({
    template: z.enum(appointmentMessageTemplates),
    channel: z.enum(appointmentMessageChannels),
  })
  .strict();
export type AppointmentMessageCreateInput = z.infer<typeof appointmentMessageCreateSchema>;
export const appointmentScheduleUpdateSchema = z.object({ appointmentDate: dateSchema }).strict();
export type AppointmentScheduleUpdateInput = z.infer<typeof appointmentScheduleUpdateSchema>;
export const appointmentStatusUpdateSchema = z
  .object({ status: appointmentStatusSchema, reason: z.string().trim().max(1000).optional() })
  .strict();
export type AppointmentStatusUpdateInput = z.infer<typeof appointmentStatusUpdateSchema>;

export const appointmentListQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    technicianId: z.string().regex(/^\d+$/).optional(),
    branchId: z.string().regex(/^\d+$/).optional(),
    complaintId: z.string().regex(/^\d+$/).optional(),
    status: appointmentStatusSchema.optional(),
    region: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The from date must be before or equal to the to date.',
    path: ['to'],
  });

export const draftScheduleItemSchema = z
  .object({
    complaintId: z.string().regex(/^\d+$/),
    technicianId: z.string().regex(/^\d+$/).optional(),
    appointmentDate: dateSchema,
    appointmentTime: timeSchema,
  })
  .strict();

export const draftScheduleSchema = z
  .object({ items: z.array(draftScheduleItemSchema).min(1).max(100) })
  .strict();
export const customerListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();
export const branchListQuerySchema = z
  .object({
    customerId: z.string().regex(/^\d+$/).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();
export const technicianListQuerySchema = z
  .object({
    active: z.enum(['true', 'false']).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    // "Available" now means "hasn't hit their daily appointment cap for
    // this date yet" -- there's no time-of-day component to check against
    // any more (see modification.md #8).
    availableDate: dateSchema.optional(),
    page: queryNumber(1, 1, 100000),
    // The Technicians tab has no pagination UI either -- it fetches the
    // whole roster in one request (pageSize=200), so this cap must allow
    // at least that (see masterDataListQuerySchema above for the same fix).
    pageSize: queryNumber(25, 1, 500),
  })
  .strict();

export const complaintSchedulingTransitions: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  New: ['Under Review', 'Cancelled'],
  'Under Review': ['Pending Information', 'Ready for Scheduling', 'Cancelled'],
  'Pending Information': ['Under Review', 'Ready for Scheduling', 'Cancelled'],
  'Ready for Scheduling': ['Scheduled', 'Cancelled'],
  Scheduled: ['Closed', 'Cancelled', 'Ready for Scheduling'],
  Closed: [],
  Cancelled: [],
};

// Statuses the system sets by itself. Staff can never pick these by hand:
// Scheduled is set when an appointment with a technician is booked, and
// Closed when that appointment is completed (modification.md #69).
export const complaintAutomaticStatuses: readonly ComplaintStatus[] = ['Scheduled', 'Closed'];

export const appointmentTransitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  Scheduled: ['In Progress', 'Cancelled'],
  'In Progress': ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

// ---------------------------------------------------------------------
// Phase 6 (Commercial/pricing -- see modification.md #26): admin entry for
// VAS price banding & split, Rate Card, D+I, AMC and Thomson pricing.
// Ported from the legacy Apps Script prototype's "Management" tab
// (code.gs / index_sep_15.html, attached for reference), ranked faithful
// to that business logic but not to its exact field names -- this is a
// standalone rebuild, not a port of the Apps Script data shapes.
// Defaults load from the master Excel workbook once; after that the admin
// can freely change and always revert to that Excel default, with every
// save/reset/restore versioned via audit_events (see packages/db's
// pricing-configs module).
// ---------------------------------------------------------------------

export const pricingConfigDomainSchema = z.enum([
  'vas_price_bands',
  'vas_pricing_params',
  'rate_card',
  'dandi_pricing',
  'amc_pricing',
  'thomson_pricing',
]);
export type PricingConfigDomain = z.infer<typeof pricingConfigDomainSchema>;

const percentSchema = z.number().min(0).max(1);
const nonNegSchema = z.number().min(0);
const positiveSchema = z.number().gt(0);

// --- VAS: price banding -------------------------------------------------
export const vasPriceBandSchema = z
  .object({
    start: nonNegSchema,
    end: z.number(),
    label: z.string().trim().max(60).optional(),
  })
  .strict()
  .refine((band) => band.end > band.start, {
    message: 'A band’s end must be greater than its start.',
  });

export const vasPriceBandsSchema = z
  .array(vasPriceBandSchema)
  .min(1)
  .superRefine((bands, ctx) => {
    for (let i = 1; i < bands.length; i += 1) {
      if (bands[i].start < bands[i - 1].end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Value bands must be sorted and must not overlap.',
        });
        break;
      }
    }
  });
export type VasPriceBandsInput = z.infer<typeof vasPriceBandsSchema>;

// --- VAS: pricing parameters (rates, minimum fees, claim fees) ---------
// Service fee / claims-allowed / coverage & terms text -- one of each per
// plan, sourced verbatim from the workbook's "VAS Pricing" sheet PLAN
// DEFINITIONS table (modification.md #33). Kept as free text because the
// sheet's own values are prose ("No service fee - parts & labour covered",
// "Unlimited", a coverage paragraph), not numbers -- the 1-Year Damage
// Insurance service fee is the one exception: its *displayed* value is
// always computed from claimFeeLow/claimFeeHigh/claimFeeThreshold instead
// of this stored text (see deriveVasServiceFeeText in app.js), matching the
// legacy calculator's dynamic override for that plan only.
const vasPlanTextSchema = z.string().trim().min(1).max(500);

export const vasPricingParamsSchema = z
  .object({
    ew1Rate: percentSchema,
    ew2Rate: percentSchema,
    di1Rate: percentSchema,
    premiumRate: percentSchema,
    ew1MinFee: nonNegSchema,
    ew2MinFee: nonNegSchema,
    di1MinFee: nonNegSchema,
    premiumMinFee: nonNegSchema,
    roundingStep: positiveSchema,
    claimFeeLow: nonNegSchema,
    claimFeeHigh: nonNegSchema,
    claimFeeThreshold: nonNegSchema,
    deductibleEw1: nonNegSchema,
    deductibleEw2: nonNegSchema,
    deductibleDi1: nonNegSchema,
    deductiblePremium: nonNegSchema,
    ew1ServiceFee: vasPlanTextSchema,
    ew2ServiceFee: vasPlanTextSchema,
    di1ServiceFee: vasPlanTextSchema,
    premiumServiceFee: vasPlanTextSchema,
    ew1Claims: vasPlanTextSchema,
    ew2Claims: vasPlanTextSchema,
    di1Claims: vasPlanTextSchema,
    premiumClaims: vasPlanTextSchema,
    ew1Coverage: vasPlanTextSchema,
    ew2Coverage: vasPlanTextSchema,
    di1Coverage: vasPlanTextSchema,
    premiumCoverage: vasPlanTextSchema,
    // Depreciation schedule for total-loss claim settlement (workbook's
    // "DEPRECIATION SCHEDULE" box, K4:L8) -- % of purchase price deducted
    // by claim year, shared across all 4 plans.
    depreciationYear1: percentSchema,
    depreciationYear2: percentSchema,
    depreciationYear3: percentSchema,
  })
  .strict();
export type VasPricingParamsInput = z.infer<typeof vasPricingParamsSchema>;

// --- Rate Card ------------------------------------------------------------
export const rateCardActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    rate: nonNegSchema,
  })
  .strict();

export const rateCardSectionSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(120),
    activities: z.array(rateCardActivitySchema).min(1),
  })
  .strict();

export const rateCardSchema = z.array(rateCardSectionSchema).min(1);
export type RateCardInput = z.infer<typeof rateCardSchema>;

// --- D+I (Delivery + Install) ---------------------------------------------
export const dandiRegionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    km: nonNegSchema,
    costPerKm: nonNegSchema,
    roundTripCost: nonNegSchema,
  })
  .strict();

export const dandiDiscountTierSchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int(),
    label: z.string().trim().min(1).max(60),
    rate: percentSchema,
  })
  .strict()
  .refine((tier) => tier.max >= tier.min, {
    message: 'A discount tier’s max must be at least its min.',
  });

export const dandiApplianceRatesSchema = z
  .object({ batch: nonNegSchema, standard: nonNegSchema })
  .strict();

export const dandiModeSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    transportAlways: z.boolean(),
    rates: z
      .object({
        fridge: dandiApplianceRatesSchema,
        washer: dandiApplianceRatesSchema,
        cooker: dandiApplianceRatesSchema,
      })
      .strict(),
    discounts: z.array(dandiDiscountTierSchema).min(1),
  })
  .strict();

export const dandiPricingSchema = z
  .object({
    maxUnits: z.union([z.literal(50), z.literal(60), z.literal(100)]),
    minUnitRate: nonNegSchema,
    regions: z.array(dandiRegionSchema).min(1),
    groupings: z.array(z.string().trim().min(1).max(120)).min(1),
    crewFactors: z
      .object({ '1': positiveSchema, '2': positiveSchema, '3': positiveSchema })
      .strict(),
    capacities: z
      .object({ fridge: positiveSchema, washer: positiveSchema, cooker: positiveSchema })
      .strict(),
    laborMinutes: z
      .object({ fridge: nonNegSchema, washer: nonNegSchema, cooker: nonNegSchema })
      .strict(),
    laborCostPerHour: nonNegSchema,
    modes: z.object({ dandi: dandiModeSchema, install: dandiModeSchema }).strict(),
  })
  .strict();
export type DandiPricingInput = z.infer<typeof dandiPricingSchema>;

// --- AMC ------------------------------------------------------------------
export const amcVisitTierSchema = z.tuple([z.number().int().min(1), z.number().int().min(0)]);

export const amcApplianceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    qty: z.number().int().min(0),
    price: nonNegSchema,
    active: z.boolean(),
  })
  .strict();

export const amcPricingSchema = z
  .object({
    basicPct: percentSchema,
    standardPct: percentSchema,
    premiumPct: percentSchema,
    riskUplift: percentSchema,
    overhead: percentSchema,
    profitMarkup: percentSchema,
    standardPartsReserve: percentSchema,
    premiumPartsReserve: percentSchema,
    handledPerVisit: nonNegSchema,
    transportPerVisit: nonNegSchema,
    salary: nonNegSchema,
    technicians: nonNegSchema,
    workingDays: nonNegSchema,
    hoursPerDay: nonNegSchema,
    visitHours: nonNegSchema,
    standardVisits: nonNegSchema,
    premiumVisits: nonNegSchema,
    basicVisitTiers: z.array(amcVisitTierSchema).min(1),
    appliances: z.array(amcApplianceSchema).min(1),
  })
  .strict();
export type AmcPricingInput = z.infer<typeof amcPricingSchema>;

// --- Thomson ----------------------------------------------------------------
export const thomsonRegionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    km: nonNegSchema,
    roundTripCost: nonNegSchema,
    active: z.boolean().optional(),
  })
  .strict();

export const thomsonApplianceRatesSchema = z
  .object({
    Base: nonNegSchema,
    '50+': nonNegSchema,
    '150+': nonNegSchema,
    '300+': nonNegSchema,
    '500+': nonNegSchema,
  })
  .strict();

export const thomsonApplianceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    rates: thomsonApplianceRatesSchema,
    avgMin: positiveSchema,
    active: z.boolean().optional(),
  })
  .strict();

export const thomsonAddonSchema = z
  .object({
    rate: nonNegSchema,
    hours: nonNegSchema,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const thomsonPricingSchema = z
  .object({
    techCount: positiveSchema,
    hoursDay: positiveSchema,
    techRate: nonNegSchema,
    costPerKm: nonNegSchema,
    regions: z.array(thomsonRegionSchema).min(1),
    appliances: z.array(thomsonApplianceSchema).min(1),
    addons: z
      .object({
        'Project Management Fee': thomsonAddonSchema,
        'Site Survey': thomsonAddonSchema,
        'Testing & Commissioning': thomsonAddonSchema,
        'Training (End User)': thomsonAddonSchema,
      })
      .strict(),
  })
  .strict();
export type ThomsonPricingInput = z.infer<typeof thomsonPricingSchema>;

// Only Built-in Hob (30cm) rounds down (floor) at the 50+ tier -- every
// other appliance and every other tier rounds up (ceil). This mirrors the
// legacy thomsonDerivedRatesFromBase_ formula exactly (code.gs / index
// Sep 15 prototype): the 4 non-Base tiers are always derived from Base and
// are never independently stored or edited.
export function deriveThomsonTierRates(
  base: number,
  applianceName: string,
): {
  Base: number;
  '50+': number;
  '150+': number;
  '300+': number;
  '500+': number;
} {
  const isHob = applianceName.trim().toLowerCase().startsWith('built-in hob');
  const round50 = isHob ? Math.floor : Math.ceil;
  return {
    Base: base,
    '50+': round50(base * 0.95),
    '150+': Math.ceil(base * 0.9),
    '300+': Math.ceil(base * 0.88),
    '500+': Math.ceil(base * 0.85),
  };
}

const pricingConfigPayloadSchemas: Record<PricingConfigDomain, z.ZodTypeAny> = {
  vas_price_bands: vasPriceBandsSchema,
  vas_pricing_params: vasPricingParamsSchema,
  rate_card: rateCardSchema,
  dandi_pricing: dandiPricingSchema,
  amc_pricing: amcPricingSchema,
  thomson_pricing: thomsonPricingSchema,
};

export function pricingConfigSchemaFor(domain: PricingConfigDomain): z.ZodTypeAny {
  return pricingConfigPayloadSchemas[domain];
}

export const pricingConfigRestoreSchema = z
  .object({ auditEventId: z.number().int().positive() })
  .strict();
export type PricingConfigRestoreInput = z.infer<typeof pricingConfigRestoreSchema>;
