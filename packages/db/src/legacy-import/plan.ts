import ExcelJS from 'exceljs';
import {
  type Note,
  cleanBrand,
  cleanInvoiceNo,
  dubaiDate,
  isBlank,
  mapWarranty,
  normalisePhone,
  partRow,
  productRow,
  technicianKey,
  text,
  toDate,
  toMoney,
  toNumber,
  toTimestamp,
} from './transforms.js';

// Reads the exported Jackys_Distribution workbook and turns it into a plan: the
// exact rows that would be written, plus every issue found on the way. Reading
// and planning never touch the database.

export const SOURCE_NAME = 'google-sheet-jackys';

export type Issue = {
  sheet: string;
  row: number;
  reference: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export type TechnicianPlan = {
  legacyRef: string;
  row: number;
  name: string;
  region: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type AppointmentPlan = {
  legacyRef: string; // also the portal reference, the formats are identical
  row: number;
  createdAt: Date;
  customerType: 'B2B' | 'B2C';
  customerName: string;
  contactNumber: string;
  customerEmail: string | null;
  address: string | null;
  region: string | null;
  brand: string | null;
  model: string | null;
  itemCode: string | null;
  faultDescription: string;
  jobWarranty: 'In Warranty' | 'Out Warranty' | null;
  salesOrderNumber: string | null;
  appointmentDate: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  closedAt: Date | null;
  technicianName: string | null;
  b2bBranchSchool: string | null;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  subGroup: string | null;
};

export type JobCardPlan = {
  legacyRef: string;
  row: number;
  createdAt: Date;
  appointmentRef: string | null; // null => walk-in
  jobCardDate: string;
  customerName: string;
  customerContact: string | null;
  customerAddress: string | null;
  itemDescription: string | null;
  modelNo: string | null;
  warrantyStatus: 'In Warranty' | 'Out Warranty' | null;
  complaint: string | null;
  serviceRendered: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  timeConsumedHours: number | null;
  parts: { partNo: string; description: string; qty: number; unitPrice: number }[];
  totalCost: number;
  serviceCharge: number;
  grandTotal: number;
  amountChargeable: number | null;
  invoiceNo: string | null;
  deliveryDate: string | null;
  technicianName: string | null;
  brand: string | null;
  jobFinalStatus: string;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  customerNumber: string | null;
  billingJobType: 'CSIJW' | 'CSIJO' | null;
  attachmentCount: number;
  legacyAttachmentLinks: string[];
  sourceAppointmentRef: string | null;
  duplicateOf: string | null;
};

export type QuotationPlan = {
  legacyRef: string;
  row: number;
  createdAt: Date;
  quotationDate: string;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  technicalDiagnosis: string | null;
  products: ReturnType<typeof productRow>[];
  parts: ReturnType<typeof partRow>[];
  labourAmount: number;
  grandTotal: number;
  preparedBy: string | null;
  preparedDate: string | null;
  approvedBy: string | null;
  approvedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
};

export type InspectionPlan = {
  legacyRef: string;
  row: number;
  createdAt: Date;
  inspectionDate: string;
  customerName: string | null;
  contactNumber: string | null;
  projectName: string | null;
  siteLocation: string | null;
  dateOfCollection: string | null;
  technicianName: string | null;
  customerComplaint: string | null;
  visualFindings: string | null;
  technicalDiagnosis: string | null;
  products: ReturnType<typeof productRow>[];
  faultyParts: ReturnType<typeof partRow>[];
  recommendedAction: string | null;
  refQuotationNo: string | null; // legacy QO-nnn, resolved at apply time
  warrantyStatus: string | null;
  estRepairCost: number | null;
  inspectedBy: string | null;
  inspectedDate: string | null;
  reviewedBy: string | null;
  reviewedDate: string | null;
  customerSignature: string | null;
  signatureDate: string | null;
};

export type ThomsonPlan = {
  legacyRef: string;
  row: number;
  createdAt: Date;
  saleDate: string;
  clientName: string | null;
  contactNumber: string | null;
  siteLocation: string | null;
  transportSharePercent: number;
  lineItems: {
    region: string;
    applianceName: string;
    qty: number;
    siteVisits: number;
    trainingSessions: number;
    unitRate: number;
    applianceSubtotal: number;
    addonRevenue: number;
    transportCost: number;
    totalPrice: number;
    totalCost: number;
    margin: number;
  }[];
  totalPrice: number;
  totalCost: number;
  margin: number;
};

export type Plan = {
  technicians: TechnicianPlan[];
  appointments: AppointmentPlan[];
  jobCards: JobCardPlan[];
  quotations: QuotationPlan[];
  inspections: InspectionPlan[];
  thomson: ThomsonPlan[];
  issues: Issue[];
  skipped: { sheet: string; rows: number; reason: string }[];
};

// Sheets that are intentionally not migrated.
const SKIPPED: Record<string, string> = {
  Customer_Complaints: 'Complaints were never used; start fresh in the portal.',
  B2BCustomers: 'B2B branch master already lives in the portal database.',
  Users: 'Contains password and session hashes; create logins in the portal.',
  RoleAccess: 'Replaced by portal roles and permissions.',
  ActivityLog: 'Archive only.',
  AMCQuotes: 'AMC data is not migrated.',
  AMCContracts: 'AMC data is not migrated.',
  VASSales: 'Only a test row.',
  AwaitingSchedules: 'Empty.',
  Thomson_Pricing_Admin: 'Pricing config is managed in the portal.',
  AMC_Pricing_Admin: 'Pricing config is managed in the portal.',
  DandI_Pricing_Admin: 'Pricing config is managed in the portal.',
  VAS_PriceBands_Admin: 'Pricing config is managed in the portal.',
  VAS_PricingParams_Admin: 'Pricing config is managed in the portal.',
};

// Typos and alternate spellings of technician names found in the sheet.
const TECHNICIAN_ALIASES: Record<string, string> = { latheef: 'latif' };

type Sheet = {
  header: string[];
  rows: {
    row: number;
    cells: unknown[];
    get: (h: string) => unknown;
    json: Record<string, any> | null;
  }[];
};

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o) return o.richText.map((t: any) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return null;
  }
  return v;
}

async function readSheet(wb: ExcelJS.Workbook, name: string): Promise<Sheet | null> {
  const ws = wb.getWorksheet(name);
  if (!ws) return null;
  const headerRow = ws.getRow(1);
  const header: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (c, col) => {
    header[col - 1] = String(cellValue(c.value) ?? '').trim();
  });
  const rows: Sheet['rows'] = [];
  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: unknown[] = [];
    for (let i = 0; i < Math.max(header.length, r.cellCount); i += 1)
      cells.push(cellValue(r.getCell(i + 1).value));
    if (cells.every(isBlank)) return;
    let json: Record<string, any> | null = null;
    // The JSON blob is the real source of truth. In some rows it has slipped
    // out of its DataJSON column, so find it by content, not by position.
    for (const c of cells) {
      if (typeof c === 'string' && c.trim().startsWith('{')) {
        try {
          json = JSON.parse(c);
          break;
        } catch {
          /* keep looking */
        }
      }
    }
    rows.push({
      row: rowNumber,
      cells,
      get: (h) => {
        const i = header.indexOf(h);
        return i >= 0 ? cells[i] : null;
      },
      json,
    });
  });
  return { header, rows };
}

export type PlanOptions = {
  // A second job card for an appointment cannot link to it (one per appointment).
  // 'walk-in' imports it unlinked and flags it; 'skip' leaves it out.
  duplicateJobCards?: 'walk-in' | 'skip';
};

export async function buildPlan(file: string, options: PlanOptions = {}): Promise<Plan> {
  const duplicateMode = options.duplicateJobCards ?? 'walk-in';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const plan: Plan = {
    technicians: [],
    appointments: [],
    jobCards: [],
    quotations: [],
    inspections: [],
    thomson: [],
    issues: [],
    skipped: [],
  };
  const issue = (
    sheet: string,
    row: number,
    reference: string,
    level: Issue['level'],
    message: string,
  ) => plan.issues.push({ sheet, row, reference, level, message });
  const notes = (sheet: string, row: number, reference: string, list: Note[]) =>
    list.forEach((n) => issue(sheet, row, reference, n.level, n.message));

  for (const [name, reason] of Object.entries(SKIPPED)) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    let rows = 0;
    ws.eachRow((r, n) => {
      if (n > 1 && r.values && (r.values as any[]).some((v) => !isBlank(cellValue(v)))) rows += 1;
    });
    plan.skipped.push({ sheet: name, rows, reason });
  }

  // ---- Technicians --------------------------------------------------------
  const techNames = new Map<string, string>(); // key -> canonical name
  const techSheet = await readSheet(wb, 'Technicians');
  for (const r of techSheet?.rows ?? []) {
    const name = text(r.get('Name'), 120);
    if (!name) continue;
    const phone = normalisePhone(r.get('Phone'));
    notes('Technicians', r.row, name, phone.notes);
    plan.technicians.push({
      legacyRef: name,
      row: r.row,
      name,
      region: text(r.get('Region'), 80),
      phone: phone.value,
      email: text(r.get('Email'), 320),
      active:
        String(r.get('Active') ?? 'Yes')
          .trim()
          .toLowerCase() !== 'no',
    });
    techNames.set(technicianKey(name), name);
  }
  const canonicalTech = (
    value: unknown,
    sheet: string,
    row: number,
    ref: string,
    addIfUnknown = false,
  ): string | null => {
    const raw = text(value, 120);
    if (!raw) return null;
    let key = technicianKey(raw);
    key = TECHNICIAN_ALIASES[key] ?? key;
    const known = techNames.get(key);
    if (known) {
      if (known !== raw)
        issue(sheet, row, ref, 'info', `Technician "${raw}" mapped to "${known}".`);
      return known;
    }
    if (!addIfUnknown) {
      // Quotations and inspections keep the name as free text (it is often a
      // customer contact or a pair of technicians, not a master-list entry).
      return raw;
    }
    issue(
      sheet,
      row,
      ref,
      'warn',
      `Technician "${raw}" is not in the Technicians tab; added as a new technician.`,
    );
    techNames.set(key, raw);
    plan.technicians.push({
      legacyRef: raw,
      row: 0,
      name: raw,
      region: null,
      phone: null,
      email: null,
      active: true,
    });
    return raw;
  };

  // ---- Appointments (Schedules) ------------------------------------------
  const sched = await readSheet(wb, 'Schedules');
  const seenApt = new Set<string>();
  for (const r of sched?.rows ?? []) {
    const ref = text(r.get('Appointment No'), 40);
    if (!ref) {
      issue('Schedules', r.row, '', 'error', 'Missing Appointment No.');
      continue;
    }
    if (!/^APT-\d{4}-\d{5}$/.test(ref))
      issue('Schedules', r.row, ref, 'error', 'Appointment No is not in APT-YYYY-NNNNN form.');
    if (seenApt.has(ref)) issue('Schedules', r.row, ref, 'error', 'Duplicate Appointment No.');
    seenApt.add(ref);

    const createdAt = toTimestamp(r.get('Timestamp')) ?? new Date();
    const date = toDate(r.get('Appointment Date'));
    if (!date) issue('Schedules', r.row, ref, 'error', 'Missing or invalid Appointment Date.');
    const name = text(r.get('Customer Name'), 200);
    if (!name) issue('Schedules', r.row, ref, 'error', 'Missing Customer Name.');
    const phone = normalisePhone(r.get('Contact No'));
    notes('Schedules', r.row, ref, phone.notes);
    if (!phone.value)
      issue(
        'Schedules',
        r.row,
        ref,
        'warn',
        'Missing Contact No; set to "N/A" (the portal requires one).',
      );
    const fault = text(r.get('Fault Description'), 10000);
    if (!fault) issue('Schedules', r.row, ref, 'error', 'Missing Fault Description.');
    const warranty = mapWarranty(r.get('Job Warranty'));
    notes('Schedules', r.row, ref, warranty.notes);
    const brand = cleanBrand(r.get('Brand'));
    notes('Schedules', r.row, ref, brand.notes);
    const typeRaw = String(r.get('Customer Type') ?? '')
      .trim()
      .toUpperCase();
    if (typeRaw !== 'B2B' && typeRaw !== 'B2C')
      issue(
        'Schedules',
        r.row,
        ref,
        'warn',
        `Customer Type "${typeRaw}" not recognised; set to B2C.`,
      );
    const schoolPhone = normalisePhone(r.get('School Contact Number'));

    let status = String(r.get('Status') ?? '').trim() as AppointmentPlan['status'];
    if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
      issue(
        'Schedules',
        r.row,
        ref,
        'warn',
        `Status "${status}" not recognised; set to Scheduled.`,
      );
      status = 'Scheduled';
    }
    let closedAt: Date | null = null;
    if (status !== 'Scheduled') {
      closedAt = toTimestamp(r.get('Closed Timestamp'));
      if (!closedAt && date) {
        // Estimated: end of the appointment day, Dubai time.
        closedAt = toTimestamp(`${date} 17:00:00`);
        issue(
          'Schedules',
          r.row,
          ref,
          'info',
          `No Closed Timestamp; close time estimated from the appointment date.`,
        );
      }
    }
    if (r.get('Complaint No') && !isBlank(r.get('Complaint No'))) {
      issue(
        'Schedules',
        r.row,
        ref,
        'info',
        'Complaint No present but complaints are not migrated; link dropped.',
      );
    }

    plan.appointments.push({
      legacyRef: ref,
      row: r.row,
      createdAt,
      customerType: typeRaw === 'B2B' ? 'B2B' : 'B2C',
      customerName: name ?? '',
      contactNumber: phone.value ?? 'N/A',
      customerEmail: text(r.get('Customer Email'), 320),
      address: text(r.get('Location / Address'), 1000),
      region: text(r.get('Region'), 80),
      brand: brand.value,
      model: text(r.get('Model'), 200),
      itemCode: text(r.get('Item Code'), 80),
      faultDescription: fault ?? '',
      jobWarranty: warranty.value,
      salesOrderNumber: text(r.get('Sales Order No'), 80),
      appointmentDate: date ?? '',
      status,
      closedAt,
      technicianName: canonicalTech(r.get('Assigned Technician'), 'Schedules', r.row, ref, true),
      b2bBranchSchool: text(r.get('B2B Branch / School'), 200),
      schoolContactPerson: text(r.get('School Contact Person'), 200),
      schoolContactNumber: schoolPhone.value,
      customerNumber: text(r.get('Customer Number'), 80),
      subGroup: text(r.get('Sub Group'), 120),
    });
  }

  // ---- Job cards ----------------------------------------------------------
  const jcs = await readSheet(wb, 'ServiceJobCards');
  const seenJc = new Set<string>();
  const usedApt = new Map<string, string>();
  const readyToDeliver = new Set(['Repair Completed', 'BER', 'Rejected']);
  const finalStatuses = new Set([
    'WIP',
    'Spare pending',
    'BER',
    'Rejected',
    'Repair Completed',
    'Delivered',
    'Cancelled',
  ]);
  for (const r of jcs?.rows ?? []) {
    const ref = text(r.get('Number'), 40);
    if (!ref) {
      issue('ServiceJobCards', r.row, '', 'error', 'Missing job card Number.');
      continue;
    }
    if (seenJc.has(ref))
      issue('ServiceJobCards', r.row, ref, 'error', 'Duplicate job card Number.');
    seenJc.add(ref);
    const j = r.json ?? {};
    if (!r.json)
      issue(
        'ServiceJobCards',
        r.row,
        ref,
        'warn',
        'No DataJSON; parts and attachments unavailable.',
      );
    else if (isBlank(r.get('DataJSON')))
      issue('ServiceJobCards', r.row, ref, 'info', 'DataJSON was in a shifted column; recovered.');

    const createdAt = toTimestamp(r.get('Timestamp')) ?? new Date();
    let jcDate = toDate(r.get('Job Card Date')) ?? toDate(j.jcDate);
    if (!jcDate) {
      // Decided with the owner: job cards with a blank date are test or
      // abandoned entries and are left out.
      issue('ServiceJobCards', r.row, ref, 'info', 'No job card date; skipped (not imported).');
      continue;
    }
    const sourceRef = text(r.get('Source Ref No') ?? j.sourceRefNo, 40);
    let appointmentRef: string | null = null;
    let duplicateOf: string | null = null;
    if (sourceRef && sourceRef.startsWith('APT-')) {
      if (!seenApt.has(sourceRef))
        issue(
          'ServiceJobCards',
          r.row,
          ref,
          'error',
          `Source appointment ${sourceRef} not found in Schedules.`,
        );
      else if (usedApt.has(sourceRef)) {
        issue(
          'ServiceJobCards',
          r.row,
          ref,
          'warn',
          `Appointment ${sourceRef} already has job card ${usedApt.get(sourceRef)} (possible duplicate); ${duplicateMode === 'skip' ? 'skipped' : 'imported as an unlinked walk-in job card'}.`,
        );
        if (duplicateMode === 'skip') continue;
        duplicateOf = usedApt.get(sourceRef) ?? null;
      } else {
        appointmentRef = sourceRef;
        usedApt.set(sourceRef, ref);
      }
    } else {
      issue(
        'ServiceJobCards',
        r.row,
        ref,
        'info',
        'No source appointment; imported as a walk-in job card.',
      );
    }

    const name = text(r.get('Customer Name') ?? j.custName, 200);
    if (!name) issue('ServiceJobCards', r.row, ref, 'error', 'Missing customer name.');
    const phone = normalisePhone(r.get('Contact No') ?? j.custContact);
    notes('ServiceJobCards', r.row, ref, phone.notes);
    const warranty = mapWarranty(r.get('Warranty Status') ?? j.warrantyStatus);
    notes('ServiceJobCards', r.row, ref, warranty.notes);
    const brand = cleanBrand(r.get('Brand') ?? j.brand);
    notes('ServiceJobCards', r.row, ref, brand.notes);

    let final = text(r.get('Job Final Status') ?? j.jobFinalStatus, 40) ?? 'WIP';
    if (!finalStatuses.has(final)) {
      issue(
        'ServiceJobCards',
        r.row,
        ref,
        'warn',
        `Job Final Status "${final}" not recognised; set to WIP.`,
      );
      final = 'WIP';
    }
    const deliveryDate = toDate(r.get('Delivery Date') ?? j.deliveryDate);
    if (deliveryDate && final !== 'Delivered') {
      if (readyToDeliver.has(final)) final = 'Delivered';
      else
        issue(
          'ServiceJobCards',
          r.row,
          ref,
          'warn',
          `Has a delivery date but status is "${final}"; status kept, delivery date kept.`,
        );
    }

    const invoice = cleanInvoiceNo(r.get('Invoice No') ?? j.jcInvoiceNo);
    notes('ServiceJobCards', r.row, ref, invoice.notes);

    const rawParts = Array.isArray(j.parts) ? j.parts : [];
    const parts = rawParts
      .map((p: any) => partRow(p))
      .filter((p: any) => p.partNo || p.description);
    const attachments = Array.isArray(j.attachments) ? j.attachments.length : 0;
    if (attachments > 0)
      issue(
        'ServiceJobCards',
        r.row,
        ref,
        'warn',
        `${attachments} attachment link(s) in the sheet; the files stay in Google Drive and their links are added to the job card's condition notes.`,
      );

    const grand = toMoney(r.get('Grand Total (AED)') ?? j.grandTotal) ?? 0;
    const service = toMoney(r.get('Service Charge (AED)') ?? j.serviceCharge) ?? 0;
    const cost = toMoney(r.get('Total Cost (AED)') ?? j.totalCost) ?? 0;
    if (grand > 0 && grand < 1)
      issue(
        'ServiceJobCards',
        r.row,
        ref,
        'warn',
        `Grand total is ${grand}, looks like a placeholder.`,
      );
    const chargeable = toMoney(r.get('Amount Chargeable (AED)') ?? j.amountChargeable);
    const tech = canonicalTech(
      r.get('Technician Name') ?? j.technicianName,
      'ServiceJobCards',
      r.row,
      ref,
      true,
    );

    const schoolPerson = text(j.schoolContactPerson, 200);
    const schoolNo = normalisePhone(j.schoolContactNumber);

    plan.jobCards.push({
      legacyRef: ref,
      row: r.row,
      createdAt,
      appointmentRef,
      jobCardDate: jcDate,
      customerName: name ?? '',
      customerContact: phone.value,
      customerAddress: text(r.get('Address') ?? j.custAddress, 1000),
      itemDescription: text(r.get('Item Description') ?? j.itemDesc, 500),
      modelNo: text(r.get('Model No') ?? j.modelNo, 200),
      warrantyStatus: warranty.value,
      complaint: text(r.get('Complaint') ?? j.complaint, 10000),
      serviceRendered: text(r.get('Service Rendered') ?? j.serviceRendered, 10000),
      periodFrom: toTimestamp(r.get('Period From') ?? j.periodFrom),
      periodTo: toTimestamp(r.get('Period To') ?? j.periodTo),
      timeConsumedHours: toNumber(r.get('Time Consumed (Hr)') ?? j.timeConsumed),
      parts,
      totalCost: cost,
      serviceCharge: service,
      grandTotal: grand,
      amountChargeable: chargeable,
      invoiceNo: invoice.value,
      deliveryDate,
      technicianName: tech,
      brand: brand.value,
      jobFinalStatus: final,
      schoolContactPerson: schoolPerson,
      schoolContactNumber: schoolNo.value,
      customerNumber: text(j.customerNumber, 80),
      billingJobType:
        warranty.value === 'In Warranty'
          ? 'CSIJW'
          : warranty.value === 'Out Warranty'
            ? 'CSIJO'
            : null,
      attachmentCount: attachments,
      legacyAttachmentLinks: (Array.isArray(j.attachments) ? j.attachments : [])
        .map((a: any) => text(a?.url, 400))
        .filter((u: string | null): u is string => !!u),
      sourceAppointmentRef: sourceRef && sourceRef.startsWith('APT-') ? sourceRef : null,
      duplicateOf,
    });
  }

  // ---- Quotations ---------------------------------------------------------
  const quos = await readSheet(wb, 'Quotations');
  const seenQ = new Set<string>();
  for (const r of quos?.rows ?? []) {
    const ref = text(r.get('Number'), 40);
    if (!ref) {
      issue('Quotations', r.row, '', 'error', 'Missing quotation Number.');
      continue;
    }
    if (seenQ.has(ref)) issue('Quotations', r.row, ref, 'error', 'Duplicate quotation Number.');
    seenQ.add(ref);
    const j = r.json ?? {};
    const createdAt = toTimestamp(r.get('Timestamp')) ?? new Date();
    const date = toDate(r.get('Date') ?? j.qDate) ?? dubaiDate(createdAt);
    const phone = normalisePhone(r.get('Contact No') ?? j.qContact);
    notes('Quotations', r.row, ref, phone.notes);
    const parts = (Array.isArray(j.parts) ? j.parts : [])
      .map((p: any) => partRow(p))
      .filter((p: any) => p.description || p.partNo);
    const products = (Array.isArray(j.products) ? j.products : [])
      .map((p: any) => productRow(p))
      .filter((p: any) => p.description || p.partNo);
    const labour = toMoney(r.get('Labour (AED)') ?? j.labour) ?? 0;
    const grand = toMoney(r.get('Grand Total') ?? j.grandTotal) ?? 0;
    const calc = parts.reduce((s: number, p: any) => s + p.qty * p.unitPrice, 0) + labour;
    if (Math.abs(calc - grand) > 0.05)
      issue(
        'Quotations',
        r.row,
        ref,
        'info',
        `Sheet grand total ${grand} differs from parts + labour ${calc.toFixed(2)} (VAT or discount?). Sheet total is kept.`,
      );
    plan.quotations.push({
      legacyRef: ref,
      row: r.row,
      createdAt,
      quotationDate: date,
      customerName: text(r.get('Customer Name') ?? j.qCustomer, 200),
      contactNumber: phone.value,
      projectName: text(r.get('Project Name') ?? j.qProject, 200),
      siteLocation: text(r.get('Site / Location') ?? j.qSite, 500),
      dateOfCollection: toDate(r.get('Date of Collection') ?? j.qCollectionDate),
      technicianName: canonicalTech(
        r.get('Technician Name') ?? j.qTechnician,
        'Quotations',
        r.row,
        ref,
      ),
      customerComplaint: text(r.get('Customer Complaint') ?? j.qComplaint, 10000),
      technicalDiagnosis: text(r.get('Technical Diagnosis') ?? j.qDiagnosis, 10000),
      products,
      parts,
      labourAmount: labour,
      grandTotal: grand,
      preparedBy: text(r.get('Prepared By') ?? j.qPreparedBy, 120),
      preparedDate: toDate(r.get('Prepared Date') ?? j.qPreparedDate),
      approvedBy: text(r.get('Approved By') ?? j.qApprovedBy, 120),
      approvedDate: toDate(r.get('Approved Date') ?? j.qApprovedDate),
      customerSignature: text(r.get('Customer Signature') ?? j.qCustSign, 200),
      signatureDate: toDate(r.get('Signature Date') ?? j.qCustSignDate),
    });
  }

  // ---- Inspections --------------------------------------------------------
  const insp = await readSheet(wb, 'Inspections');
  const seenI = new Set<string>();
  for (const r of insp?.rows ?? []) {
    const ref = text(r.get('Number'), 40);
    if (!ref) {
      issue('Inspections', r.row, '', 'error', 'Missing inspection Number.');
      continue;
    }
    if (seenI.has(ref)) issue('Inspections', r.row, ref, 'error', 'Duplicate inspection Number.');
    seenI.add(ref);
    const j = r.json ?? {};
    const createdAt = toTimestamp(r.get('Timestamp')) ?? new Date();
    const phone = normalisePhone(r.get('Contact No') ?? j.iContact);
    notes('Inspections', r.row, ref, phone.notes);
    const faulty = (Array.isArray(j.faultyParts) ? j.faultyParts : [])
      .map((p: any) => ({ ...partRow({ description: p.desc, qty: p.qty }), partNo: '' }))
      .filter((p: any) => p.description);
    const products = (Array.isArray(j.products) ? j.products : [])
      .map((p: any) => productRow(p))
      .filter((p: any) => p.description || p.partNo);
    const refQ = text(r.get('Ref. Quotation No.') ?? j.iRefQuotation, 40);
    if (refQ && !seenQ.has(refQ))
      issue(
        'Inspections',
        r.row,
        ref,
        'warn',
        `Referenced quotation ${refQ} is not in the Quotations tab.`,
      );
    plan.inspections.push({
      legacyRef: ref,
      row: r.row,
      createdAt,
      inspectionDate: toDate(r.get('Date') ?? j.iDate) ?? dubaiDate(createdAt),
      customerName: text(r.get('Customer Name') ?? j.iCustomer, 200),
      contactNumber: phone.value,
      projectName: text(r.get('Project Name') ?? j.iProject, 200),
      siteLocation: text(r.get('Site / Location') ?? j.iSite, 500),
      dateOfCollection: toDate(r.get('Date of Collection') ?? j.iCollectionDate),
      technicianName: canonicalTech(
        r.get('Technician Name') ?? j.iTechnician,
        'Inspections',
        r.row,
        ref,
      ),
      customerComplaint: text(r.get('Customer Complaint') ?? j.iComplaint, 10000),
      visualFindings: text(r.get('Visual Findings') ?? j.iVisualFindings, 10000),
      technicalDiagnosis: text(r.get('Technical Diagnosis') ?? j.iDiagnosis, 10000),
      products,
      faultyParts: faulty,
      recommendedAction: text(r.get('Recommended Action') ?? j.iRecommendedAction, 200),
      refQuotationNo: refQ,
      warrantyStatus: text(r.get('Warranty Status') ?? j.iWarrantyStatus, 40),
      estRepairCost: toMoney(r.get('Est. Repair Cost') ?? j.iEstCost),
      inspectedBy: text(r.get('Inspected By') ?? j.iInspectedBy, 120),
      inspectedDate: toDate(r.get('Inspected Date') ?? j.iInspectedDate),
      reviewedBy: text(r.get('Reviewed By') ?? j.iReviewedBy, 120),
      reviewedDate: toDate(r.get('Reviewed Date') ?? j.iReviewedDate),
      customerSignature: text(r.get('Customer Signature') ?? j.iCustSign, 200),
      signatureDate: toDate(r.get('Signature Date') ?? j.iCustSignDate),
    });
  }

  // ---- Thomson proposals --------------------------------------------------
  const th = await readSheet(wb, 'ThomsonProposals');
  for (const r of th?.rows ?? []) {
    const ref = text(r.get('Number'), 40);
    if (!ref) {
      issue('ThomsonProposals', r.row, '', 'error', 'Missing proposal Number.');
      continue;
    }
    const j = r.json ?? {};
    const createdAt = toTimestamp(r.get('Timestamp')) ?? new Date();
    const region = text(r.get('Region') ?? j.thRegion, 80) ?? '';
    const phone = normalisePhone(r.get('Contact No') ?? j.thContact);
    notes('ThomsonProposals', r.row, ref, phone.notes);
    const items = (Array.isArray(j.items) ? j.items : []).map((it: any) => {
      const price = toMoney(it.price) ?? 0;
      const qty = toNumber(it.qty) ?? 0;
      const subtotal = toMoney(it.total) ?? price * qty;
      return {
        region,
        applianceName: text(it.name, 200) ?? '',
        qty,
        siteVisits: toNumber(it.siteVisits) ?? 0,
        trainingSessions: toNumber(it.trainingSessions) ?? 0,
        unitRate: price,
        applianceSubtotal: subtotal,
        addonRevenue: 0,
        transportCost: 0,
        totalPrice: subtotal,
        totalCost: 0,
        margin: 0,
      };
    });
    const total = toMoney(r.get('Total Project Price') ?? j.totalPrice) ?? 0;
    const cost = toMoney(r.get('Total Project Cost') ?? j.totalCost) ?? 0;
    const margin = toMoney(r.get('Margin (AED)') ?? j.marginAED) ?? total - cost;
    issue(
      'ThomsonProposals',
      r.row,
      ref,
      'info',
      'The sheet stores cost and margin only for the whole proposal; line items carry price only. Proposal totals are kept as in the sheet.',
    );
    const share = toNumber(j.thTransportShare) ?? 0.5;
    plan.thomson.push({
      legacyRef: ref,
      row: r.row,
      createdAt,
      saleDate: toDate(r.get('Proposal Date') ?? j.thDate) ?? dubaiDate(createdAt),
      clientName: text(r.get('Customer / Project') ?? j.thCustomer, 200),
      contactNumber: phone.value,
      siteLocation: text(r.get('Site Address') ?? j.thSite, 500),
      transportSharePercent: share <= 1 ? share * 100 : share,
      lineItems: items,
      totalPrice: total,
      totalCost: cost,
      margin,
    });
  }

  return plan;
}

export function summarisePlan(plan: Plan) {
  const count = (level: Issue['level']) => plan.issues.filter((i) => i.level === level).length;
  return {
    technicians: plan.technicians.length,
    appointments: plan.appointments.length,
    jobCards: plan.jobCards.length,
    quotations: plan.quotations.length,
    inspections: plan.inspections.length,
    thomson: plan.thomson.length,
    errors: count('error'),
    warnings: count('warn'),
    info: count('info'),
  };
}
