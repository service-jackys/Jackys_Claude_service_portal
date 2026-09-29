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

export const complaintNotesSchema = z
  .object({
    notes: z.string().trim().min(1).max(10000),
  })
  .strict();

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
    custCode: z
      .string()
      .trim()
      .regex(/^\d+$/)
      .max(40)
      .nullable(),
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
  'BER',
  'Rejected',
  'Repair Completed',
  'Spare pending',
] as const;
export const jobFinalStatusSchema = z.enum(jobFinalStatuses);
export type JobFinalStatus = (typeof jobFinalStatuses)[number];

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
  schoolContactPerson: optionalText(500),
  schoolContactNumber: optionalText(100),
  customerNumber: optionalText(100),
  // Optional free-text reference to a corresponding document in the legacy
  // Google Sheets/Apps Script system, printed alongside this record's own
  // reference (see "Add print views and legacy-reference preservation",
  // Phase 5).
  legacyReference: optionalText(120),
};

export const serviceJobCardCreateSchema = z.object(jobCardContentFields).strict();
export type ServiceJobCardCreateInput = z.infer<typeof serviceJobCardCreateSchema>;

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
    appointmentDate: dateSchema,
    appointmentTime: timeSchema,
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
export const appointmentScheduleUpdateSchema = z
  .object({ appointmentDate: dateSchema, appointmentTime: timeSchema })
  .strict();
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
    availableDate: dateSchema.optional(),
    availableTime: timeSchema.optional(),
    page: queryNumber(1, 1, 100000),
    pageSize: queryNumber(25, 1, 100),
  })
  .strict();

export const complaintSchedulingTransitions: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  New: ['Under Review', 'Cancelled'],
  'Under Review': ['Pending Information', 'Ready for Scheduling', 'Cancelled'],
  'Pending Information': ['Under Review', 'Cancelled'],
  'Ready for Scheduling': ['Scheduled', 'Cancelled'],
  Scheduled: ['Closed', 'Cancelled', 'Ready for Scheduling'],
  Closed: [],
  Cancelled: [],
};

export const appointmentTransitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  Scheduled: ['In Progress', 'Cancelled'],
  'In Progress': ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};
