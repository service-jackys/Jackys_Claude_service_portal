// Report catalogue for the Reports page (modification.md #52). Mirrors the
// legacy portal's "Download service reports" tab: pick a record type and a
// date range, preview the rows, download them as a formatted workbook.
//
// Every definition is a fixed, hand-written SELECT -- nothing from the
// request is ever interpolated into SQL except through bind parameters.

export type ReportColumnKind = 'text' | 'date' | 'datetime' | 'money' | 'number' | 'json';

export type ReportColumn = {
  label: string;
  // A SQL expression over the definition's FROM clause.
  expr: string;
  kind?: ReportColumnKind;
};

export type ReportDefinition = {
  type: string;
  label: string;
  description: string;
  // The per-record-type read permission a user also needs (reports.read opens
  // the page, this decides which record types they can pull).
  permission: string;
  from: string;
  // A date expression the From/To range filters on.
  dateExpr: string;
  dateLabel: string;
  referenceExpr: string;
  orderBy: string;
  searchExprs: string[];
  columns: ReportColumn[];
};

const created = (table: string): ReportColumn => ({
  label: 'Created at',
  expr: `${table}.created_at`,
  kind: 'datetime',
});

// Turnaround time (modification.md #57), counted in Dubai calendar days from
// when the complaint was logged (or the appointment was booked, if it has no
// complaint) to when the appointment was closed. TAT is only filled for closed
// appointments; Days Open only for ones still open (cancelled ones get neither).
const TAT_LOGGED = 'COALESCE(complaints.submitted_at, appointments.created_at)';
const dubaiDay = (expr: string) => `timezone('Asia/Dubai', ${expr})::date`;
const APPOINTMENT_TAT = `CASE WHEN appointments.closed_at IS NOT NULL AND appointments.status <> 'Cancelled'
  THEN ${dubaiDay('appointments.closed_at')} - ${dubaiDay(TAT_LOGGED)} END`;
const APPOINTMENT_DAYS_OPEN = `CASE WHEN appointments.closed_at IS NULL AND appointments.status <> 'Cancelled'
  THEN ${dubaiDay('now()')} - ${dubaiDay(TAT_LOGGED)} END`;

// Job card TAT: complaint logged (else job card date) to the job card being
// finalised, in Dubai calendar days.
const JOB_CARD_TAT = `CASE WHEN service_job_cards.finalized_at IS NOT NULL
  THEN ${dubaiDay('service_job_cards.finalized_at')} - COALESCE(
    ${dubaiDay('complaints.submitted_at')},
    service_job_cards.job_card_date,
    ${dubaiDay('service_job_cards.created_at')}) END`;

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    type: 'quotation',
    label: 'Quotations',
    description: 'Repair quotations with diagnosis, parts and totals.',
    permission: 'quotation.read',
    from: 'quotations',
    dateExpr: 'COALESCE(quotations.quotation_date, quotations.created_at::date)',
    dateLabel: 'Quotation date',
    referenceExpr: 'quotations.quotation_reference',
    orderBy: 'quotations.quotation_date DESC NULLS LAST, quotations.id DESC',
    searchExprs: [
      'quotations.quotation_reference',
      'quotations.customer_name',
      'quotations.contact_number',
      'quotations.project_name',
    ],
    columns: [
      { label: 'Number', expr: 'quotations.quotation_reference' },
      { label: 'Date', expr: 'quotations.quotation_date', kind: 'date' },
      { label: 'Customer Name', expr: 'quotations.customer_name' },
      { label: 'Contact No', expr: 'quotations.contact_number' },
      { label: 'Project Name', expr: 'quotations.project_name' },
      { label: 'Site / Location', expr: 'quotations.site_location' },
      { label: 'Date of Collection', expr: 'quotations.date_of_collection', kind: 'date' },
      { label: 'Technician Name', expr: 'quotations.technician_name' },
      { label: 'Customer Complaint', expr: 'quotations.customer_complaint' },
      { label: 'Technical Diagnosis', expr: 'quotations.technical_diagnosis' },
      { label: 'Products', expr: 'quotations.products', kind: 'json' },
      { label: 'Spare Parts', expr: 'quotations.parts', kind: 'json' },
      { label: 'Labour (AED)', expr: 'quotations.labour_amount', kind: 'money' },
      { label: 'Grand Total (AED)', expr: 'quotations.grand_total', kind: 'money' },
      { label: 'Prepared By', expr: 'quotations.prepared_by' },
      { label: 'Prepared Date', expr: 'quotations.prepared_date', kind: 'date' },
      { label: 'Approved By', expr: 'quotations.approved_by' },
      { label: 'Approved Date', expr: 'quotations.approved_date', kind: 'date' },
      created('quotations'),
    ],
  },
  {
    type: 'inspection',
    label: 'Inspection Reports',
    description: 'Inspection findings, faulty parts and recommended action.',
    permission: 'inspection.read',
    from: 'inspections',
    dateExpr: 'COALESCE(inspections.inspection_date, inspections.created_at::date)',
    dateLabel: 'Inspection date',
    referenceExpr: 'inspections.inspection_reference',
    orderBy: 'inspections.inspection_date DESC NULLS LAST, inspections.id DESC',
    searchExprs: [
      'inspections.inspection_reference',
      'inspections.customer_name',
      'inspections.contact_number',
      'inspections.project_name',
    ],
    columns: [
      { label: 'Number', expr: 'inspections.inspection_reference' },
      { label: 'Date', expr: 'inspections.inspection_date', kind: 'date' },
      { label: 'Customer Name', expr: 'inspections.customer_name' },
      { label: 'Contact No', expr: 'inspections.contact_number' },
      { label: 'Project Name', expr: 'inspections.project_name' },
      { label: 'Site / Location', expr: 'inspections.site_location' },
      { label: 'Technician Name', expr: 'inspections.technician_name' },
      { label: 'Customer Complaint', expr: 'inspections.customer_complaint' },
      { label: 'Visual Findings', expr: 'inspections.visual_findings' },
      { label: 'Technical Diagnosis', expr: 'inspections.technical_diagnosis' },
      { label: 'Products', expr: 'inspections.products', kind: 'json' },
      { label: 'Faulty Parts', expr: 'inspections.faulty_parts', kind: 'json' },
      { label: 'Recommended Action', expr: 'inspections.recommended_action' },
      { label: 'Ref. Quotation No.', expr: 'inspections.ref_quotation_no' },
      { label: 'Warranty Status', expr: 'inspections.warranty_status' },
      { label: 'Est. Repair Cost (AED)', expr: 'inspections.est_repair_cost', kind: 'money' },
      { label: 'Inspected By', expr: 'inspections.inspected_by' },
      { label: 'Inspected Date', expr: 'inspections.inspected_date', kind: 'date' },
      { label: 'Reviewed By', expr: 'inspections.reviewed_by' },
      { label: 'Reviewed Date', expr: 'inspections.reviewed_date', kind: 'date' },
      created('inspections'),
    ],
  },
  {
    type: 'amc-contract',
    label: 'AMC Contracts',
    description: 'Issued AMC contracts with plan, appliances and price.',
    permission: 'amc_contract.read',
    from: 'amc_contracts',
    dateExpr: 'COALESCE(amc_contracts.contract_date, amc_contracts.created_at::date)',
    dateLabel: 'Contract date',
    referenceExpr: 'amc_contracts.amc_contract_reference',
    orderBy: 'amc_contracts.contract_date DESC NULLS LAST, amc_contracts.id DESC',
    searchExprs: [
      'amc_contracts.amc_contract_reference',
      'amc_contracts.client_name',
      'amc_contracts.contract_ref',
    ],
    columns: [
      { label: 'Number', expr: 'amc_contracts.amc_contract_reference' },
      { label: 'Contract Date', expr: 'amc_contracts.contract_date', kind: 'date' },
      { label: 'Contract Period', expr: 'amc_contracts.contract_period' },
      { label: 'Client', expr: 'amc_contracts.client_name' },
      { label: 'Attention To', expr: 'amc_contracts.attention_to' },
      { label: 'Site / Location', expr: 'amc_contracts.site_location' },
      { label: 'Total Appliances', expr: 'amc_contracts.total_count', kind: 'number' },
      { label: 'Total Equipment Value (AED)', expr: 'amc_contracts.total_value', kind: 'money' },
      { label: 'Plans and Prices', expr: 'amc_contracts.plans', kind: 'json' },
      { label: 'Commencement Date', expr: 'amc_contracts.commencement_date', kind: 'date' },
      { label: 'Contract Ref', expr: 'amc_contracts.contract_ref' },
      { label: 'Appliances', expr: 'amc_contracts.appliances', kind: 'json' },
      created('amc_contracts'),
    ],
  },
  {
    type: 'thomson-sale',
    label: 'Thomson Sales',
    description: 'Issued Thomson project quotations with price, cost and margin.',
    permission: 'thomson_sale.read',
    from: 'thomson_sales',
    dateExpr: 'COALESCE(thomson_sales.sale_date, thomson_sales.created_at::date)',
    dateLabel: 'Sale date',
    referenceExpr: 'thomson_sales.thomson_sale_reference',
    orderBy: 'thomson_sales.sale_date DESC NULLS LAST, thomson_sales.id DESC',
    searchExprs: [
      'thomson_sales.thomson_sale_reference',
      'thomson_sales.client_name',
      'thomson_sales.contract_ref',
    ],
    columns: [
      { label: 'Number', expr: 'thomson_sales.thomson_sale_reference' },
      { label: 'Sale Date', expr: 'thomson_sales.sale_date', kind: 'date' },
      { label: 'Customer / Project', expr: 'thomson_sales.client_name' },
      { label: 'Contact No', expr: 'thomson_sales.contact_number' },
      { label: 'Site Address', expr: 'thomson_sales.site_location' },
      { label: 'Transport Share %', expr: 'thomson_sales.transport_share_percent', kind: 'number' },
      { label: 'Total Project Price (AED)', expr: 'thomson_sales.total_price', kind: 'money' },
      { label: 'Total Project Cost (AED)', expr: 'thomson_sales.total_cost', kind: 'money' },
      { label: 'Margin (AED)', expr: 'thomson_sales.margin', kind: 'money' },
      { label: 'Contract Ref', expr: 'thomson_sales.contract_ref' },
      { label: 'Line Items', expr: 'thomson_sales.line_items', kind: 'json' },
      created('thomson_sales'),
    ],
  },
  {
    type: 'vas-sale',
    label: 'VAS Sales',
    description: 'Value-added service plans sold to customers.',
    permission: 'vas_sale.read',
    from: 'vas_sales',
    dateExpr: 'COALESCE(vas_sales.sale_date, vas_sales.created_at::date)',
    dateLabel: 'Sale date',
    referenceExpr: 'vas_sales.vas_sale_reference',
    orderBy: 'vas_sales.sale_date DESC NULLS LAST, vas_sales.id DESC',
    searchExprs: [
      'vas_sales.vas_sale_reference',
      'vas_sales.customer_name',
      'vas_sales.contact_number',
      'vas_sales.invoice_number',
      'vas_sales.contract_ref',
    ],
    columns: [
      { label: 'Number', expr: 'vas_sales.vas_sale_reference' },
      { label: 'Sale Date', expr: 'vas_sales.sale_date', kind: 'date' },
      { label: 'Customer Name', expr: 'vas_sales.customer_name' },
      { label: 'Contact No', expr: 'vas_sales.contact_number' },
      { label: 'Address / Emirates', expr: 'vas_sales.address' },
      { label: 'Invoice Number', expr: 'vas_sales.invoice_number' },
      { label: 'Purchase Date', expr: 'vas_sales.purchase_date', kind: 'date' },
      { label: 'Item Code', expr: 'vas_sales.item_code' },
      { label: 'Item Description', expr: 'vas_sales.item_description' },
      { label: 'VAS Product', expr: 'vas_sales.vas_product' },
      { label: 'Selling Price (AED)', expr: 'vas_sales.selling_price', kind: 'money' },
      { label: 'Plan Fee (AED)', expr: 'vas_sales.plan_fee', kind: 'money' },
      { label: 'Deductible (AED)', expr: 'vas_sales.deductible', kind: 'money' },
      { label: 'Service Fee', expr: 'vas_sales.service_fee_text' },
      { label: 'Contract Ref', expr: 'vas_sales.contract_ref' },
      created('vas_sales'),
    ],
  },
  {
    type: 'rate-card-sale',
    label: 'Rate Card Sales',
    description: 'Rate card quotations issued earlier.',
    permission: 'rate_card_sale.read',
    from: 'rate_card_sales',
    dateExpr: 'COALESCE(rate_card_sales.sale_date, rate_card_sales.created_at::date)',
    dateLabel: 'Sale date',
    referenceExpr: 'rate_card_sales.rate_card_sale_reference',
    orderBy: 'rate_card_sales.sale_date DESC NULLS LAST, rate_card_sales.id DESC',
    searchExprs: [
      'rate_card_sales.rate_card_sale_reference',
      'rate_card_sales.client_name',
      'rate_card_sales.contract_ref',
    ],
    columns: [
      { label: 'Number', expr: 'rate_card_sales.rate_card_sale_reference' },
      { label: 'Sale Date', expr: 'rate_card_sales.sale_date', kind: 'date' },
      { label: 'Client', expr: 'rate_card_sales.client_name' },
      { label: 'Contact No', expr: 'rate_card_sales.contact_number' },
      { label: 'Site / Location', expr: 'rate_card_sales.site_location' },
      { label: 'Total (AED)', expr: 'rate_card_sales.total_value', kind: 'money' },
      { label: 'Contract Ref', expr: 'rate_card_sales.contract_ref' },
      { label: 'Line Items', expr: 'rate_card_sales.line_items', kind: 'json' },
      created('rate_card_sales'),
    ],
  },
  {
    type: 'service-job-card',
    label: 'Service Job Cards',
    description: 'Job cards with parts, charges and final status.',
    permission: 'service_job_card.read',
    from: `service_job_cards
      LEFT JOIN appointments ON appointments.id = service_job_cards.appointment_id
      LEFT JOIN complaints ON complaints.id = appointments.complaint_id`,
    dateExpr: 'COALESCE(service_job_cards.job_card_date, service_job_cards.created_at::date)',
    dateLabel: 'Job card date',
    referenceExpr: 'service_job_cards.job_card_reference',
    orderBy: 'service_job_cards.job_card_date DESC NULLS LAST, service_job_cards.id DESC',
    searchExprs: [
      'service_job_cards.job_card_reference',
      'service_job_cards.customer_name',
      'service_job_cards.customer_contact',
      'service_job_cards.invoice_no',
      'service_job_cards.technician_name',
    ],
    columns: [
      { label: 'Number', expr: 'service_job_cards.job_card_reference' },
      { label: 'Job Card Date', expr: 'service_job_cards.job_card_date', kind: 'date' },
      { label: 'Source Ref No', expr: 'service_job_cards.legacy_reference' },
      { label: 'Customer Name', expr: 'service_job_cards.customer_name' },
      { label: 'Contact No', expr: 'service_job_cards.customer_contact' },
      { label: 'Address', expr: 'service_job_cards.customer_address' },
      { label: 'Item Description', expr: 'service_job_cards.item_description' },
      { label: 'Model No', expr: 'service_job_cards.model_no' },
      { label: 'Brand', expr: 'service_job_cards.brand' },
      { label: 'Warranty Status', expr: 'service_job_cards.warranty_status' },
      { label: 'Complaint', expr: 'service_job_cards.complaint' },
      { label: 'Service Rendered', expr: 'service_job_cards.service_rendered' },
      { label: 'Period From', expr: 'service_job_cards.period_from', kind: 'datetime' },
      { label: 'Period To', expr: 'service_job_cards.period_to', kind: 'datetime' },
      {
        label: 'Time Consumed (Hr)',
        expr: 'service_job_cards.time_consumed_hours',
        kind: 'number',
      },
      { label: 'Parts Used', expr: 'service_job_cards.parts', kind: 'json' },
      { label: 'Total Cost (AED)', expr: 'service_job_cards.total_cost', kind: 'money' },
      { label: 'Service Charge (AED)', expr: 'service_job_cards.service_charge', kind: 'money' },
      { label: 'Grand Total (AED)', expr: 'service_job_cards.grand_total', kind: 'money' },
      {
        label: 'Amount Chargeable (AED)',
        expr: 'service_job_cards.amount_chargeable',
        kind: 'money',
      },
      { label: 'Invoice No', expr: 'service_job_cards.invoice_no' },
      { label: 'Delivery Date', expr: 'service_job_cards.delivery_date', kind: 'date' },
      { label: 'Technician Name', expr: 'service_job_cards.technician_name' },
      { label: 'Salesman', expr: 'service_job_cards.salesman' },
      { label: 'Sales Channel', expr: 'service_job_cards.sales_channel' },
      { label: 'Workflow Status', expr: 'service_job_cards.status' },
      { label: 'Job Final Status', expr: 'service_job_cards.job_final_status' },
      { label: 'Finalised At', expr: 'service_job_cards.finalized_at', kind: 'datetime' },
      { label: 'TAT (days)', expr: JOB_CARD_TAT, kind: 'number' },
      created('service_job_cards'),
    ],
  },
  {
    type: 'scheduler',
    label: 'Scheduler (Appointments)',
    description: 'Appointments with customer, technician and status.',
    permission: 'appointments.read',
    from: `appointments
      LEFT JOIN technicians ON technicians.id = appointments.technician_id
      LEFT JOIN complaints ON complaints.id = appointments.complaint_id`,
    dateExpr: 'appointments.appointment_date',
    dateLabel: 'Appointment date',
    referenceExpr: 'appointments.appointment_reference',
    orderBy: 'appointments.appointment_date DESC, appointments.id DESC',
    searchExprs: [
      'appointments.appointment_reference',
      'appointments.customer_name',
      'appointments.contact_number',
      'appointments.item_code',
      'appointments.sales_order_number',
      'technicians.name',
    ],
    columns: [
      { label: 'Appointment No', expr: 'appointments.appointment_reference' },
      { label: 'Appointment Date', expr: 'appointments.appointment_date', kind: 'date' },
      { label: 'Status', expr: 'appointments.status' },
      { label: 'Customer Type', expr: 'appointments.customer_type' },
      { label: 'Customer Name', expr: 'appointments.customer_name' },
      { label: 'Contact No', expr: 'appointments.contact_number' },
      { label: 'Address', expr: 'appointments.address' },
      { label: 'Region', expr: 'appointments.region' },
      { label: 'Brand', expr: 'appointments.brand' },
      { label: 'Model', expr: 'appointments.model' },
      { label: 'Item Code', expr: 'appointments.item_code' },
      { label: 'Fault Description', expr: 'appointments.fault_description' },
      { label: 'Job Warranty', expr: 'appointments.job_warranty' },
      { label: 'Sales Order No', expr: 'appointments.sales_order_number' },
      { label: 'Technician', expr: 'technicians.name' },
      { label: 'Complaint No', expr: 'complaints.complaint_reference' },
      { label: 'Complaint Logged', expr: TAT_LOGGED, kind: 'datetime' },
      { label: 'Closed At', expr: 'appointments.closed_at', kind: 'datetime' },
      { label: 'TAT (days)', expr: APPOINTMENT_TAT, kind: 'number' },
      { label: 'Days Open', expr: APPOINTMENT_DAYS_OPEN, kind: 'number' },
      created('appointments'),
    ],
  },
];

export function findReportDefinition(type: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((definition) => definition.type === type);
}
