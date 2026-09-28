/**
 * Jacky's Electronics LLC — Service Forms (all-in-one Apps Script deployment)
 * ----------------------------------------------------------------------------
 * This single script does two jobs:
 *   1. Serves the Index.html form as a web page (doGet).
 *   2. Reads/writes the Google Sheet it's bound to, via functions the page
 *      calls directly through google.script.run — no URL to configure,
 *      no CORS, nothing to paste.
 *
 * Each record is saved as ONE readable row with its own named columns
 * (Customer Name, Date, Complaint, etc.) so you can open any tab and
 * read it directly, or download/export it (File > Download) to share
 * with management. A DataJSON column is also included at the end of
 * each row — that's what the page itself uses to reload a record into
 * the form; you can ignore it when reading the sheet by eye.
 *
 * SETUP — see the numbered steps at the bottom of this file.
 */

/**
 * Scheduler notification emails (customer confirmation + technician job assignment)
 * are OFF by default — they were sending from a personal Gmail address, which isn't
 * appropriate for customer/staff-facing notifications from a business tool.
 * Previously "disabled" by commenting out one of the two call sites that trigger
 * these emails (saveSchedule and updateScheduleTechnician) — the other one was missed,
 * so emails kept going out. Fixed properly this time: ONE flag gates both, so there's
 * no scattered comment to miss. Flip this to true only once a proper business email/
 * domain is wired up to send from instead of a personal address.
 */
const SCHEDULER_EMAILS_ENABLED = false;

const SHEETS = {
  'quotation': 'Quotations',
  'inspection': 'Inspections',
  'amc-quote': 'AMCQuotes',
  'amc-contract': 'AMCContracts',
  'thomson-proposal': 'ThomsonProposals',
  'vas-sale': 'VASSales',
  'service-job-card': 'ServiceJobCards'
};
const PREFIXES = {
  'quotation': 'QO',
  'inspection': 'IR',
  'amc-quote': 'AQ',
  'amc-contract': 'AC',
  'thomson-proposal': 'TP',
  'vas-sale': 'VS',
  'service-job-card': 'JC'
};

// Column headers for each sheet tab, in the exact order buildRowValues_
// below writes them. Add/remove columns in BOTH places together.
const HEADERS_BY_TYPE = {
  'quotation': [
    'Timestamp', 'Number', 'Date', 'Customer Name', 'Contact No', 'Project Name',
    'Site / Location', 'Date of Collection', 'Technician Name', 'Customer Complaint',
    'Technical Diagnosis', 'Products', 'Spare Parts', 'Labour (AED)', 'Grand Total',
    'Prepared By', 'Prepared Date', 'Approved By', 'Approved Date',
    'Customer Signature', 'Signature Date', 'DataJSON'
  ],
  'inspection': [
    'Timestamp', 'Number', 'Date', 'Customer Name', 'Contact No', 'Project Name',
    'Site / Location', 'Date of Collection', 'Technician Name', 'Customer Complaint',
    'Visual Findings', 'Technical Diagnosis', 'Products', 'Faulty Parts',
    'Recommended Action', 'Ref. Quotation No.', 'Warranty Status', 'Est. Repair Cost',
    'Inspected By', 'Inspected Date', 'Reviewed By', 'Reviewed Date',
    'Customer Signature', 'Signature Date', 'DataJSON'
  ],
  'amc-quote': [
    'Timestamp', 'Number', 'Quotation Date', 'Contract Period', 'Client', 'Attention To',
    'Site / Location', 'Valid Until', 'Selected Plan', 'Total Appliances',
    'Total Equipment Value', 'Appliances', 'DataJSON'
  ],
  'amc-contract': [
    'Timestamp', 'Number', 'Contract Date', 'Contract Period', 'Client', 'Attention To',
    'Site / Location', 'Status', 'Approved Plan', 'Price Incl. VAT', 'Commencement Date',
    'Selected Plan', 'Total Appliances', 'Total Equipment Value', 'Appliances',
    'Signed By (Jacky\'s)', 'Designation (Jacky\'s)', 'Signed Date (Jacky\'s)',
    'Signed By (Client)', 'Designation (Client)', 'Signed Date (Client)', 'DataJSON'
  ],
  'thomson-proposal': [
    'Timestamp', 'Number', 'Proposal Date', 'Customer / Project', 'Contact No', 'Site Address',
    'Region', 'Technicians Deployed', 'Line Items', 'Appliance Subtotal', 'Additional Services Subtotal',
    'Transport Charged to Customer', 'Total Project Price', 'Total Project Cost', 'Margin (AED)', 'Margin %', 'DataJSON'
  ],
  'vas-sale': [
    'Timestamp', 'Number', 'Sale Date', 'Customer Name', 'Contact No', 'Address / Emirates',
    'Invoice Number', 'Purchase Date', 'Item Code', 'Item Description', 'VAS Product',
    'Selling Price (AED)', 'Plan & Price', 'Deductible (AED)', 'Service Fee', 'Contract Ref', 'DataJSON'
  ],
  'service-job-card': [
    'Timestamp', 'Number', 'Job Card Date', 'Source Type', 'Source Ref No', 'Customer Name',
    'Contact No', 'Address', 'Item Description', 'Model No', 'Warranty Status', 'Complaint',
    'Service Rendered', 'Period From', 'Period To', 'Time Consumed (Hr)', 'Parts Used',
    'Total Cost (AED)', 'Service Charge (AED)', 'Grand Total (AED)', 'Amount Chargeable (AED)',
    'Invoice No', 'Delivery Date', 'Technician Name', 'Brand', 'Job Final Status',
    'School Contact Person', 'School Contact Number', 'Customer Number', 'DataJSON'
  ]
};

// ------------------------------------------------------------------
// Serves the web page. This is what runs when someone opens the
// deployment's /exec URL.
//
// NOTE ON THE LOGO: earlier versions tried to fetch your logo from
// Drive and inject it server-side. That kept failing (broken image /
// unsupported return type errors) because of Apps Script platform
// quirks around returning binary data from doGet. The reliable fix is
// simpler and needs NO server code at all: in Index.html the <img
// class="logo"> tags now point directly at a public Google-hosted
// image URL (https://lh3.googleusercontent.com/d/YOUR_FILE_ID). See
// the comment above those tags in Index.html for how to set that up.
// ------------------------------------------------------------------
function doGet(e) {
  if (e && e.parameter && e.parameter.ics === '1') {
    return serveTechnicianIcs_(e.parameter.tech || '', e.parameter.date || '');
  }
  if (e && e.parameter && e.parameter.page === 'complaints') {
    return HtmlService.createHtmlOutputFromFile('ComplaintRegistration')
      .setTitle("Jacky's Electronics LLC — Customer Complaint Registration")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle("Jacky's Electronics LLC — Service Forms")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Returns the real, callable /exec URL of this deployment. The page's
 * own window.location.href can't be used for this \u2014 Apps Script serves
 * the page inside a sandboxed googleusercontent.com iframe, so that
 * URL is just a one-time content frame, not a working endpoint. This
 * is the documented, reliable way to get the actual deployment URL.
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Serves a downloadable .ics calendar file containing every job
 * assigned to one technician on one date — one VEVENT per job. Opening
 * this link on a phone (e.g. tapped from a WhatsApp message) triggers
 * the device's native "Add to Calendar" prompt for every job at once.
 */
function serveTechnicianIcs_(techName, date) {
  const rows = listSchedules().filter(s =>
    (s['Assigned Technician'] || '') === techName && (s['Appointment Date'] || '') === date
  );
  const ics = buildIcs_(rows, techName, date);
  return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
}

function icsEscape_(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsStamp_(dateObj) {
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyyMMdd'T'HHmmss");
}

function buildIcs_(rows, techName, date) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Jacky's Electronics LLC//Service Scheduler//EN", 'CALSCALE:GREGORIAN'];
  const now = icsStamp_(new Date());
  rows.forEach(s => {
    const dateStr = s['Appointment Date'] || date;
    const timeStr = s['Appointment Time'] || '09:00';
    let start;
    try {
      start = new Date(dateStr + 'T' + timeStr + ':00');
      if (isNaN(start.getTime())) start = new Date();
    } catch (err) {
      start = new Date();
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1-hour job slot
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + (s['Appointment No'] || Utilities.getUuid()) + '@jackyselectronics.com');
    lines.push('DTSTAMP:' + now);
    lines.push('DTSTART:' + icsStamp_(start));
    lines.push('DTEND:' + icsStamp_(end));
    lines.push('SUMMARY:' + icsEscape_('Service Job ' + (s['Appointment No'] || '') + ' \u2014 ' + (s['Customer Name'] || '')));
    lines.push('LOCATION:' + icsEscape_((s['Location / Address'] || '') + (s['Region'] ? ', ' + s['Region'] : '')));
    lines.push('DESCRIPTION:' + icsEscape_(
      'Customer: ' + (s['Customer Name'] || '') + '\n' +
      'Contact: ' + (s['Contact No'] || '') + '\n' +
      'Brand/Model: ' + (s['Brand'] || '') + ' ' + (s['Model'] || '') + '\n' +
      'Warranty: ' + (s['Job Warranty'] || '') + '\n' +
      'Fault: ' + (s['Fault Description'] || '')
    ));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ------------------------------------------------------------------
// Sheet helpers
// ------------------------------------------------------------------
function getOrCreateSheet_(type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = SHEETS[type];
  if (!name) throw new Error('Unknown type: ' + type);
  const wantHeaders = HEADERS_BY_TYPE[type];
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(wantHeaders);
    sheet.setFrozenRows(1);
    forceTextColumns_(sheet, name, wantHeaders);
    return sheet;
  }
  // Self-heal: if this sheet already existed (e.g. from an earlier
  // version of this script with a different column layout), make sure
  // row 1 always matches the CURRENT headers. This only touches row 1
  // — existing data rows below are never modified or reordered — so
  // it's always safe to run, and it's exactly what keeps listRecords()
  // reading the right columns after the schema below has changed.
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const matches = wantHeaders.length === currentHeaders.length &&
    wantHeaders.every((h, i) => h === currentHeaders[i]);
  if (!matches) {
    sheet.getRange(1, 1, 1, wantHeaders.length).setValues([wantHeaders]);
    sheet.setFrozenRows(1);
  }
  forceTextColumns_(sheet, name, wantHeaders);
  return sheet;
}

/**
 * Sets up (or re-checks) all four sheet tabs with the correct headers.
 * Called from the page's "Initialize / Verify Google Sheet" button.
 * Safe to run any time, including repeatedly — it never touches data
 * rows, only makes sure each tab exists with the right column headers.
 * Returns a per-type summary the page displays to the user.
 */
function initializeSheets() {
  const summary = [];
  Object.keys(SHEETS).forEach(function (type) {
    const existedBefore = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS[type]);
    const sheet = getOrCreateSheet_(type);
    const recordCount = Math.max(0, sheet.getLastRow() - 1);
    summary.push({
      type: type,
      sheetName: SHEETS[type],
      created: !existedBefore,
      recordCount: recordCount
    });
  });
  return summary;
}

function nextNumber_(type) {
  const sheet = getOrCreateSheet_(type);
  const lastRow = sheet.getLastRow();
  const prefix = PREFIXES[type];
  let maxN = 0;
  if (lastRow > 1) {
    const nums = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // Number column
    nums.forEach(r => {
      const m = String(r[0] || '').match(/-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    });
  }
  const n = maxN + 1;
  return prefix + '-' + String(n).padStart(3, '0');
}

// Turns an array of line-item objects (products / spare parts / faulty
// parts / appliances) into one readable text cell, e.g.:
// "Model: ABC-1, Desc: AC Unit, S/N: SN001, Warranty: No | Model: ..."
function readableList_(items, fields) {
  if (!items || !items.length) return '';
  return items.map(function (it) {
    return fields.map(function (f) {
      return f.label + ': ' + (it && it[f.key] !== undefined ? it[f.key] : '');
    }).join(', ');
  }).join('  |  ');
}

const PRODUCT_FIELDS = [
  { key: 'itemCode', label: 'Item Code' }, { key: 'description', label: 'Description' },
  { key: 'subGroup', label: 'Sub Group' }, { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' }, { key: 'desc', label: 'Desc' },
  { key: 'serial', label: 'S/N' }, { key: 'warranty', label: 'Warranty' }
];
const PARTS_FIELDS = [
  { key: 'desc', label: 'Item' }, { key: 'qty', label: 'Qty' }, { key: 'price', label: 'Unit Price' }
];
const FAULTY_FIELDS = [
  { key: 'desc', label: 'Item' }, { key: 'qty', label: 'Qty' }, { key: 'remarks', label: 'Remarks' }
];
const APPLIANCE_FIELDS = [
  { key: 'name', label: 'Type' }, { key: 'qty', label: 'Qty' },
  { key: 'price', label: 'Unit Price' }, { key: 'total', label: 'Total' }
];
const THOMSON_ITEM_FIELDS = [
  { key: 'name', label: 'Appliance' }, { key: 'qty', label: 'Qty' },
  { key: 'tier', label: 'Tier' }, { key: 'price', label: 'Unit Rate' }, { key: 'total', label: 'Subtotal' }
];
const JOB_CARD_PARTS_FIELDS = [
  { key: 'partNo', label: 'Part No' }, { key: 'description', label: 'Description' },
  { key: 'qty', label: 'Qty' }, { key: 'unitPrice', label: 'Unit Price' }, { key: 'total', label: 'Total' }
];
const JOB_FINAL_STATUS_OPTIONS = ['WIP', 'BER', 'Rejected', 'Repair Completed', 'Spare pending'];
const FINAL_JOB_STATUSES = new Set(['BER', 'Rejected', 'Repair Completed']);

function normalizeJobFinalStatus_(raw) {
  const value = String(raw == null ? 'WIP' : raw).trim();
  return JOB_FINAL_STATUS_OPTIONS.indexOf(value) >= 0 ? value : 'WIP';
}

function isFinalJobStatus_(raw) {
  return FINAL_JOB_STATUSES.has(String(raw || '').trim());
}

function isAdminCaller_(callerEmail, callerToken) {
  if (!callerEmail || !callerToken) return false;
  const session = validateSession(callerEmail, callerToken);
  return !!(session && session.ok && session.user && session.user.role === 'admin');
}

// Builds one row of values, in the same order as HEADERS_BY_TYPE[type],
// from the record the page collected. Must be kept in sync with
// HEADERS_BY_TYPE and with the *_FIELDS lists above.
function buildRowValues_(type, number, data) {
  data = data || {};
  const ts = new Date();
  const json = JSON.stringify(data);

  if (type === 'quotation') {
    return [
      ts, number, data.qDate || '', data.qCustomer || '', data.qContact || '',
      data.qProject || '', data.qSite || '', data.qCollectionDate || '', data.qTechnician || '',
      data.qComplaint || '', data.qDiagnosis || '',
      readableList_(data.products, PRODUCT_FIELDS), readableList_(data.parts, PARTS_FIELDS),
      data.labour || '0', data.grandTotal || '',
      data.qPreparedBy || '', data.qPreparedDate || '', data.qApprovedBy || '', data.qApprovedDate || '',
      data.qCustSign || '', data.qCustSignDate || '', json
    ];
  }
  if (type === 'inspection') {
    return [
      ts, number, data.iDate || '', data.iCustomer || '', data.iContact || '',
      data.iProject || '', data.iSite || '', data.iCollectionDate || '', data.iTechnician || '',
      data.iComplaint || '', data.iVisualFindings || '', data.iDiagnosis || '',
      readableList_(data.products, PRODUCT_FIELDS), readableList_(data.faultyParts, FAULTY_FIELDS),
      data.iRecommendedAction || '', data.iRefQuotation || '', data.iWarrantyStatus || '', data.iEstCost || '',
      data.iInspectedBy || '', data.iInspectedDate || '', data.iReviewedBy || '', data.iReviewedDate || '',
      data.iCustSign || '', data.iCustSignDate || '', json
    ];
  }
  if (type === 'amc-quote') {
    return [
      ts, number, data.amcQuoteDate || '', data.amcQuotePeriod || '', data.amcQuoteClient || '',
      data.amcQuoteAttention || '', data.amcQuoteLocation || '', data.amcQuoteValid || '',
      data.selectedPlan || '', data.totalAppliances || '', data.totalValue || '',
      readableList_(data.appliances, APPLIANCE_FIELDS), json
    ];
  }
  if (type === 'amc-contract') {
    return [
      ts, number, data.amcContractDate || '', data.amcContractPeriod || '', data.amcContractClient || '',
      data.amcContractAttention || '', data.amcContractLocation || '', data.status || '',
      data.amcContractPlan || '', data.amcContractInclVat || '', data.amcContractCommencement || '',
      data.selectedPlan || '', data.totalAppliances || '', data.totalValue || '',
      readableList_(data.appliances, APPLIANCE_FIELDS),
      data.amcSig1Name || '', data.amcSig1Designation || '', data.amcSig1Date || '',
      data.amcSig2Name || '', data.amcSig2Designation || '', data.amcSig2Date || '', json
    ];
  }
  if (type === 'thomson-proposal') {
    return [
      ts, number, data.thDate || '', data.thCustomer || '', data.thContact || '', data.thSite || '',
      data.thRegion || '', data.thTechCount || '', readableList_(data.items, THOMSON_ITEM_FIELDS),
      data.applianceSubtotal || '', data.addonSubtotal || '', data.customerTransport || '', data.totalPrice || '',
      data.totalCost || '', data.marginAED || '', data.marginPct || '', json
    ];
  }
  if (type === 'vas-sale') {
    return [
      ts, number, data.saleDate || '', data.custName || '', data.custContact || '', data.custAddress || '',
      data.invoiceNo || '', data.purchaseDate || '', data.itemCode || '', data.itemDesc || '',
      data.product || '', data.price || '', data.planAndPrice || '', data.deductible || '',
      data.serviceFee || '', data.contractRef || '', json
    ];
  }
  if (type === 'service-job-card') {
    if (Array.isArray(data.attachments) && data.attachments.length > JOB_CARD_MAX_ATTACHMENTS) {
      throw new Error('A maximum of 5 attachments is allowed per job card.');
    }
    const jobStatus = normalizeJobFinalStatus_(data.jobFinalStatus);
    return [
      ts, number, data.jcDate || '', data.sourceType || '', data.sourceRefNo || '', data.custName || '',
      data.custContact || '', data.custAddress || '', data.itemDesc || '', data.modelNo || '',
      data.warrantyStatus || '', data.complaint || '', data.serviceRendered || '',
      data.periodFrom || '', data.periodTo || '', data.timeConsumed || '',
      readableList_(data.parts, JOB_CARD_PARTS_FIELDS), data.totalCost || '', data.serviceCharge || '',
      data.grandTotal || '', data.amountChargeable || '', data.jcInvoiceNo || '', data.deliveryDate || '',
      data.technicianName || '', data.brand || '', jobStatus,
      // B2B-only, carried through from a Scheduler-origin job. Left blank when the source
      // is Quotation (which doesn't capture these) — the frontend treats a blank source
      // here as "not applicable", not an error, per the pre-mortem's #4 finding.
      data.schoolContactPerson || '', data.schoolContactNumber || '', data.customerNumber || '',
      json
    ];
  }
  throw new Error('Unknown type: ' + type);
}

// ------------------------------------------------------------------
// Functions called directly from Index.html via google.script.run
// ------------------------------------------------------------------

/** Returns a PREVIEW of the next number for this type, e.g. "QO-004". */
function getNextNumber(type) {
  return nextNumber_(type);
}

/** Returns every saved record for this type, oldest first, as objects
 *  keyed by column header (e.g. row['Customer Name'], row.Number). */
function listRecords(type) {
  const sheet = getOrCreateSheet_(type);
  const headers = HEADERS_BY_TYPE[type];
  const lastRow = sheet.getLastRow();
  console.log('listRecords(' + type + '): sheet="' + sheet.getName() + '", lastRow=' + lastRow + ', lastColumn=' + sheet.getLastColumn());
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (r) {
    const obj = {};
    headers.forEach(function (h, i) {
      // IMPORTANT: google.script.run cannot serialize real Date objects —
      // if any cell (e.g. the Timestamp column) comes back as a Date
      // instead of a plain string/number, the WHOLE response silently
      // turns into null on the browser side instead of throwing an
      // error. So every Date must be converted to a plain string here.
      let v = r[i];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      if (type === 'service-job-card' && h === 'Job Final Status' && (!v || String(v).trim() === '')) {
        v = 'WIP';
      }
      obj[h] = v;
    });
    return obj;
  });
}

/**
 * Saves one record as a readable row (see HEADERS_BY_TYPE) plus a
 * DataJSON column for the app's own use. Assigns the real number here
 * (server-side, under a lock) so two people saving at the same moment
 * can't get the same number. Returns the assigned number, e.g. "QO-004".
 */
function saveRecord(type, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (type === 'service-job-card') {
      data = data || {};
      data.jobFinalStatus = normalizeJobFinalStatus_(data.jobFinalStatus);
    }
    const number = nextNumber_(type);
    const sheet = getOrCreateSheet_(type);
    sheet.appendRow(buildRowValues_(type, number, data));
    // Invalidate dashboard snapshot so next fetch rebuilds
    if (SHEETS[type]) invalidateDashboardCache();
    return number;
  } finally {
    lock.releaseLock();
  }
}

/**
 * GENERIC update-in-place mechanism, works for ANY record type that already
 * has a SHEETS/HEADERS_BY_TYPE entry (quotation, inspection, amc-quote,
 * amc-contract, thomson-proposal, vas-sale — and any future type added the
 * same way). Rewrites the exact row in place instead of appending a new one,
 * so "pull from Dashboard, edit, Update" never creates a duplicate. Mirrors
 * the pattern already proven for the scheduler and Thomson proposals, but
 * generalized once instead of copy-pasted per type.
 */
function listRecordsWithIndex(type) {
  const sheet = getOrCreateSheet_(type);
  const headers = HEADERS_BY_TYPE[type];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (r, i) {
    const obj = { rowIndex: i + 2 };
    headers.forEach(function (h, j) {
      let v = r[j];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      obj[h] = v;
    });
    return obj;
  });
}

function updateRecordByRowIndex(type, rowIndex, data, callerEmail, callerToken) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet_(type);
    const headers = HEADERS_BY_TYPE[type];
    const existing = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const tsCol = headers.indexOf('Timestamp');
    const numCol = headers.indexOf('Number');
    const jobFinalStatusCol = headers.indexOf('Job Final Status');
    const number = existing[numCol];

    if (type === 'service-job-card') {
      const currentStatus = normalizeJobFinalStatus_(existing[jobFinalStatusCol]);
      const isAdmin = isAdminCaller_(callerEmail, callerToken);
      if (isFinalJobStatus_(currentStatus) && !isAdmin) {
        throw new Error('Closed job cannot be edited. Contact ADMIN.');
      }
      if (data) data.jobFinalStatus = normalizeJobFinalStatus_(data.jobFinalStatus);
    }

    const values = buildRowValues_(type, number, data);
    if (tsCol >= 0) values[tsCol] = existing[tsCol];
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
    // Invalidate dashboard snapshot so next fetch rebuilds
    if (SHEETS[type]) invalidateDashboardCache();
    return number;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns every saved Thomson proposal as an object keyed by column
 * header, plus rowIndex (its real sheet row) so the page can update it
 * in place later — same pattern as listSchedules()/updateSchedule().
 */
function listThomsonProposals() {
  const sheet = getOrCreateSheet_('thomson-proposal');
  const headers = HEADERS_BY_TYPE['thomson-proposal'];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (r, i) {
    const obj = { rowIndex: i + 2 };
    headers.forEach(function (h, j) {
      let v = r[j];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      obj[h] = v;
    });
    return obj;
  });
}

/**
 * Rewrites an EXISTING Thomson proposal row in place (used by the
 * "Update Proposal" button after loading one from the Dashboard),
 * instead of appending a new row — so editing a proposal never
 * creates a duplicate. The original Timestamp and Number are
 * preserved automatically. Mirrors updateSchedule().
 */
function updateThomsonProposal(rowIndex, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet_('thomson-proposal');
    const headers = HEADERS_BY_TYPE['thomson-proposal'];
    const existing = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const tsCol = headers.indexOf('Timestamp');
    const numCol = headers.indexOf('Number');
    const number = existing[numCol];
    const values = buildRowValues_('thomson-proposal', number, data);
    values[tsCol] = existing[tsCol];
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
    // Invalidate dashboard snapshot so next fetch rebuilds
    invalidateDashboardCache();
    return number;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SERVICE SCHEDULER (temporary stand-in for a proper CRM)
// ============================================================
const TECH_SHEET_NAME = 'Technicians';
const TECH_HEADERS = ['Name', 'Region', 'Phone', 'Email', 'Working Hours Start', 'Working Hours End', 'Active'];
const SCHEDULE_SHEET_NAME = 'Schedules';
const SCHEDULE_HEADERS = [
  'Timestamp', 'Appointment No', 'Customer Type', 'Customer Name', 'Contact No', 'Customer Email',
  'Location / Address', 'Region', 'Brand', 'Model', 'Fault Description', 'Job Warranty',
  'Appointment Date', 'Appointment Time', 'Assigned Technician', 'Sales Order No', 'Status',
  'Item Code', 'Sub Group', 'School Contact Person', 'School Contact Number', 'Customer Number',
  // Appended (not inserted) so existing rows/columns never shift — stores the B2B branch/school
  // name on its own, independent of Customer Name (previously the branch name was jammed into
  // Customer Name, which is exactly the confusion this column fixes).
  'B2B Branch / School', 'Closed Timestamp', 'Complaint No'
];

const CUSTOMER_COMPLAINTS_SHEET_NAME = 'Customer_Complaints';
const CUSTOMER_COMPLAINTS_HEADERS = [
  'Timestamp', 'Complaint No', 'Customer Type', 'Customer Name', 'Contact No', 'Customer Email',
  'Location / Address', 'Region', 'Brand', 'Model', 'Serial / Item Code', 'Complaint Description',
  'B2B Branch / School', 'School Contact Person', 'School Contact Number', 'Customer Number',
  'Sales Order No', 'Status', 'CCE Notes', 'Warranty Classification', 'Appointment Date',
  'Appointment Time', 'Assigned Technician', 'Final Status', 'Appointment No', 'Updated At', 'Updated By'
];
const CUSTOMER_COMPLAINT_STATUSES = ['New', 'Under Review', 'Pending Information', 'Ready for Scheduling', 'Scheduled', 'Closed', 'Cancelled'];

function complaintText_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return text.slice(0, maxLength || 5000);
}

function complaintPayload_(payload) {
  payload = payload || {};
  const allowed = [
    'customerType', 'customerName', 'contactNo', 'customerEmail', 'location', 'region',
    'brand', 'model', 'itemCode', 'faultDesc', 'b2bBranchSchool', 'schoolContactPerson',
    'schoolContactNumber', 'customerNumber', 'salesOrderNo'
  ];
  const maxLengths = {
    customerType: 40, customerName: 200, contactNo: 100, customerEmail: 200, location: 500,
    region: 100, brand: 500, model: 500, itemCode: 500, faultDesc: 5000,
    b2bBranchSchool: 500, schoolContactPerson: 500, schoolContactNumber: 100,
    customerNumber: 100, salesOrderNo: 100
  };
  const out = {};
  allowed.forEach(key => {
    const raw = String(payload[key] == null ? '' : payload[key]).trim();
    if (raw.length > maxLengths[key]) throw new Error(key === 'faultDesc' ? 'Complaint Description is too long.' : key + ' is too long.');
    out[key] = raw;
  });
  out.customerType = ['B2C', 'B2B', 'B2B-SalesChannel'].indexOf(out.customerType) >= 0 ? out.customerType : 'B2C';
  if (!out.customerName) throw new Error('Customer Name is required.');
  if (!out.contactNo) throw new Error('Contact No. is required.');
  if (!out.faultDesc) throw new Error('Complaint Description is required.');
  if (out.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.customerEmail)) throw new Error('Please enter a valid email address.');
  return out;
}

function complaintSheetRow_(payload, complaintNo, timestamp) {
  return [
    timestamp, complaintNo, payload.customerType || '', payload.customerName || '', payload.contactNo || '',
    payload.customerEmail || '', payload.location || '', payload.region || '', payload.brand || '', payload.model || '',
    payload.itemCode || '', payload.faultDesc || '', payload.b2bBranchSchool || '', payload.schoolContactPerson || '',
    payload.schoolContactNumber || '', payload.customerNumber || '', payload.salesOrderNo || '', 'New', '', '', '', '', '', '', '', '', ''
  ];
}

function nextComplaintNumber_() {
  const sheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
  const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
  const prefix = 'CMP-' + dateKey + '-';
  let maxN = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const numberCol = CUSTOMER_COMPLAINTS_HEADERS.indexOf('Complaint No') + 1;
    sheet.getRange(2, numberCol, lastRow - 1, 1).getValues().forEach(row => {
      const match = String(row[0] || '').match(new RegExp('^' + prefix + '(\\d+)$'));
      if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
    });
  }
  return prefix + String(maxN + 1).padStart(3, '0');
}

function submitCustomerComplaint(payload) {
  const clean = complaintPayload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
    const complaintNo = nextComplaintNumber_();
    sheet.appendRow(complaintSheetRow_(clean, complaintNo, new Date()));
    invalidateDashboardCache();
    return { ok: true, complaintNo: complaintNo };
  } finally {
    lock.releaseLock();
  }
}

function complaintObject_(row, rowIndex) {
  const obj = { rowIndex: rowIndex };
  CUSTOMER_COMPLAINTS_HEADERS.forEach((header, index) => {
    const value = row[index];
    if (header === 'Appointment Time') obj[header] = timeToPlain_(value);
    else if (header === 'Appointment Date' && Object.prototype.toString.call(value) === '[object Date]') {
      obj[header] = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else obj[header] = dateToPlain_(value);
  });
  return obj;
}

function listCustomerComplaints(email, token) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) return { ok: false, error: session.error || 'Scheduler access required.', rows: [] };
  const sheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, rows: [] };
  const rows = sheet.getRange(2, 1, lastRow - 1, CUSTOMER_COMPLAINTS_HEADERS.length).getValues();
  return { ok: true, rows: rows.map((row, index) => complaintObject_(row, index + 2)).reverse() };
}

function findComplaintRow_(sheet, rowIndex) {
  const index = Number(rowIndex);
  if (!Number.isInteger(index) || index < 2 || index > sheet.getLastRow()) throw new Error('Invalid complaint row.');
  return { rowIndex: index, row: sheet.getRange(index, 1, 1, CUSTOMER_COMPLAINTS_HEADERS.length).getValues()[0] };
}

function findComplaintByNumber_(sheet, complaintNo) {
  const wanted = String(complaintNo || '').trim();
  if (!wanted) return null;
  const col = CUSTOMER_COMPLAINTS_HEADERS.indexOf('Complaint No');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === wanted) return findComplaintRow_(sheet, i + 2);
  }
  return null;
}

function updateCustomerComplaint(email, token, rowIndex, update) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  update = update || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
    const found = findComplaintRow_(sheet, rowIndex);
    const row = found.row.slice();
    const writable = {
      'Location / Address': update.location,
      'Region': update.region,
      'Brand': update.brand,
      'Model': update.model,
      'Serial / Item Code': update.itemCode,
      'B2B Branch / School': update.b2bBranchSchool,
      'School Contact Person': update.schoolContactPerson,
      'School Contact Number': update.schoolContactNumber,
      'Customer Number': update.customerNumber,
      'Sales Order No': update.salesOrderNo,
      'Status': update.status,
      'CCE Notes': update.cceNotes,
      'Warranty Classification': update.warranty,
      'Appointment Date': update.apptDate,
      'Appointment Time': update.apptTime,
      'Assigned Technician': update.technician,
      'Final Status': update.finalStatus
    };
    Object.keys(writable).forEach(header => {
      if (writable[header] === undefined) return;
      if (header === 'Status' && CUSTOMER_COMPLAINT_STATUSES.indexOf(String(writable[header])) < 0) throw new Error('Invalid complaint status.');
      row[CUSTOMER_COMPLAINTS_HEADERS.indexOf(header)] = complaintText_(writable[header], header === 'CCE Notes' ? 5000 : 500);
    });
    row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Updated At')] = new Date();
    row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Updated By')] = session.user.email;
    sheet.getRange(found.rowIndex, 1, 1, CUSTOMER_COMPLAINTS_HEADERS.length).setValues([row]);
    invalidateDashboardCache();
    return { ok: true, row: complaintObject_(row, found.rowIndex) };
  } finally {
    lock.releaseLock();
  }
}

function completeComplaintAppointment_(complaintNo, apptNo, data) {
  if (!complaintNo) return;
  const sheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
  const found = findComplaintByNumber_(sheet, complaintNo);
  if (!found) throw new Error('Complaint not found: ' + complaintNo);
  const row = found.row.slice();
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Status')] = 'Scheduled';
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Appointment Date')] = data.apptDate || '';
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Appointment Time')] = data.apptTime || '';
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Assigned Technician')] = data.technician || '';
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Warranty Classification')] = data.warranty || '';
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Appointment No')] = apptNo;
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Updated At')] = new Date();
  row[CUSTOMER_COMPLAINTS_HEADERS.indexOf('Updated By')] = data.updatedBy || '';
  sheet.getRange(found.rowIndex, 1, 1, CUSTOMER_COMPLAINTS_HEADERS.length).setValues([row]);
  invalidateDashboardCache();
}

function getOrCreateNamedSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    forceTextColumns_(sheet, name, headers);
    return sheet;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const matches = headers.length === currentHeaders.length && headers.every((h, i) => h === currentHeaders[i]);
  if (!matches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  forceTextColumns_(sheet, name, headers);
  return sheet;
}

/**
 * Google Sheets auto-detects pure-digit values (like a phone number
 * typed without a leading "+" or letters) and silently stores them as
 * a Number instead of text. That breaks anything expecting a string
 * (e.g. WhatsApp link formatting) and can drop a leading 0. Setting
 * these columns to Plain Text format up front stops that auto-parsing
 * for every future row.
 */
function forceTextColumns_(sheet, sheetName, headers) {
  const textColumnsByType = {
    [SCHEDULE_SHEET_NAME]: ['Contact No', 'Sales Order No', 'School Contact Number', 'Customer Number', 'Complaint No'],
    [CUSTOMER_COMPLAINTS_SHEET_NAME]: ['Contact No', 'School Contact Number', 'Customer Number', 'Sales Order No', 'Complaint No', 'Appointment No'],
    [DRAFT_SCHEDULE_SHEET_NAME]: ['Contact No'],
    [TECH_SHEET_NAME]: ['Phone'],
    [SHEETS.quotation]: ['Contact No'],
    [SHEETS.inspection]: ['Contact No'],
    [SHEETS['thomson-proposal']]: ['Contact No'],
    [SHEETS['vas-sale']]: ['Contact No'],
    [SHEETS['service-job-card']]: ['Contact No', 'School Contact Number', 'Customer Number'],
    [B2B_CUSTOMERS_SHEET_NAME]: ['Contact Number', 'Customer Number']
  };
  const cols = textColumnsByType[sheetName];
  if (!cols) return;
  cols.forEach(colName => {
    const idx = headers.indexOf(colName);
    if (idx === -1) return;
    sheet.getRange(2, idx + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
  });
}

function dateToPlain_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return v;
}

/** Adds a technician. Region is used to help pick a suitable technician when scheduling. */
function saveTechnician(email, token, tech) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const sheet = getOrCreateNamedSheet_(TECH_SHEET_NAME, TECH_HEADERS);
  sheet.appendRow([tech.name || '', tech.region || '', tech.phone || '', tech.email || '', tech.startTime || '', tech.endTime || '', 'Yes']);
  return true;
}

function timeToPlain_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return v;
}

/** Returns all ACTIVE technicians as {row, name, region, phone, email, startTime, endTime}. */
function listTechnicians(email, token) {
  if (arguments.length) {
    const session = assertSessionPermission_(email, token, 'scheduler');
    if (!session || !session.ok) return [];
  }
  const sheet = getOrCreateNamedSheet_(TECH_SHEET_NAME, TECH_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, TECH_HEADERS.length).getValues();
  const out = [];
  values.forEach((r, i) => {
    if (r[6] === 'No') return; // soft-deleted
    out.push({
      row: i + 2,
      name: dateToPlain_(r[0]),
      region: dateToPlain_(r[1]),
      // Phone often comes back as a Number (Sheets auto-detects pure
      // digits), same issue as Contact No elsewhere \u2014 must coerce to text.
      phone: String(r[2] == null ? '' : r[2]),
      email: dateToPlain_(r[3]),
      // startTime/endTime often come back as real Date/Time objects even
      // though they were saved as "09:00" strings — google.script.run
      // can't serialize those, so they must be converted here.
      startTime: timeToPlain_(r[4]),
      endTime: timeToPlain_(r[5])
    });
  });
  return out;
}

/** Soft-deletes a technician (keeps their name on past schedules readable). */
function deactivateTechnician(email, token, rowNumber) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const sheet = getOrCreateNamedSheet_(TECH_SHEET_NAME, TECH_HEADERS);
  sheet.getRange(rowNumber, TECH_HEADERS.indexOf('Active') + 1).setValue('No');
  return true;
}

function nextAppointmentNumber_() {
  const sheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
  const year = new Date().getFullYear();
  const lastRow = sheet.getLastRow();
  let maxN = 0;
  if (lastRow > 1) {
    const nums = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    nums.forEach(r => {
      const m = String(r[0] || '').match(/-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    });
  }
  return 'APT-' + year + '-' + String(maxN + 1).padStart(5, '0');
}

/** Preview of the next appointment number, e.g. "APT-2026-00007". */
function getNextAppointmentNumber(email, token) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) return session;
  return nextAppointmentNumber_();
}

/**
 * Saves a new service request / appointment. Status always starts as
 * "Scheduled". Returns the assigned Appointment No.
 */
function scheduleRowValues_(data, apptNo, status, timestamp) {
  return [
    timestamp, apptNo, data.customerType || '', data.customerName || '', data.contactNo || '', data.customerEmail || '',
    data.location || '', data.region || '', data.brand || '', data.model || '', data.faultDesc || '',
    data.warranty || '', data.apptDate || '', data.apptTime || '', data.technician || '', data.salesOrderNo || '', status,
    data.itemCode || '', data.subGroup || '',
    // B2B-only, per the "select branch, rest of the form is the same as B2C" design — these stay
    // blank for B2C/B2B-SalesChannel, same as Sales Order No already does for non-channel types.
    data.schoolContactPerson || '', data.schoolContactNumber || '', data.customerNumber || '',
    data.b2bBranchSchool || '', '', data.complaintNo || ''
  ];
}

// ------------------------------------------------------------------
// B2B CUSTOMER MASTER — school/branch -> contact person, number, and
// (optional, filled in as it becomes known) customer number. This is a
// plain sheet tab the service head edits directly in Google Sheets, not
// an Excel-upload-and-parse flow like the Stock/Warranty masters — new
// branches get added as rows whenever a new one is encountered, and the
// dropdown picks them up on next load. No admin upload UI needed for this.
// ------------------------------------------------------------------
const B2B_CUSTOMERS_SHEET_NAME = 'B2BCustomers';
const B2B_CUSTOMERS_HEADERS = ['Branch / School Name', 'Contact Person', 'Contact Number', 'Customer Number'];

function getB2BCustomers(email, token) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) return [];
  const sheet = getOrCreateNamedSheet_(B2B_CUSTOMERS_SHEET_NAME, B2B_CUSTOMERS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, B2B_CUSTOMERS_HEADERS.length).getValues();
  return values
    .filter(r => String(r[0] || '').trim() !== '')
    .map(r => ({ branchName: r[0], contactPerson: r[1] || '', contactNumber: r[2] || '', customerNumber: r[3] || '' }));
}

function getTechnicianEmail_(name) {
  if (!name) return '';
  const tech = listTechnicians().find(t => t.name === name);
  return (tech && tech.email) || '';
}

/**
 * Sends confirmation / notification emails, if the relevant email
 * addresses are on file. Never throws — a missing/invalid email or a
 * mail quota issue should never stop the appointment itself from
 * saving, so every failure here is just logged.
 */
function sendScheduleEmails_(apptNo, data) {
  if (!SCHEDULER_EMAILS_ENABLED) return; // layer 1: early-exit guard — see the flag at the top of this file
  // ---------------------------------------------------------------
  // LAYER 2: the actual send calls are commented out below, not just
  // skipped by the flag above. Two independent layers on purpose —
  // if this flag ever gets flipped back to true by accident, no email
  // still goes out, because the code that would send it doesn't run
  // at all. Uncomment BOTH the flag (top of file) AND the blocks
  // below, together, only once a proper business email/domain is
  // wired up to send from instead of a personal Gmail address.
  // ---------------------------------------------------------------
  try {
    if (data.customerEmail) {
      /*
      MailApp.sendEmail({
        to: data.customerEmail,
        subject: 'Service Appointment Confirmed' + apptNo,
        body: 'Dear ' + (data.customerName || 'Customer') + ',\n\n' +
          'Your service request has been logged and scheduled.\n\n' +
          'Appointment No: ' + apptNo + '\n' +
          'Date: ' + (data.apptDate || 'TBC') + '\n' +
          'Time: ' + (data.apptTime || 'TBC') + '\n' +
          'Fault reported: ' + (data.faultDesc || '-') + '\n\n' +
          'Our technician will contact you ahead of the visit if needed.\n\n' +
          'Regards,\nJacky\'s Distribution LLC Service Center'
      });
      */
    }
  } catch (err) {
    console.error('Customer email failed: ' + err.message);
  }
  try {
    const techEmail = getTechnicianEmail_(data.technician);
    if (techEmail) {
      /*
      MailApp.sendEmail({
        to: techEmail,
        subject: 'New Job Assigned \u2014 ' + apptNo,
        body: 'Hi ' + data.technician + ',\n\n' +
          'You have been assigned a new service job.\n\n' +
          'Appointment No: ' + apptNo + '\n' +
          'Customer: ' + (data.customerName || '') + '\n' +
          'Contact: ' + (data.contactNo || '') + '\n' +
          'Location: ' + (data.location || '') + ' (' + (data.region || '') + ')\n' +
          'Date / Time: ' + (data.apptDate || '') + ' ' + (data.apptTime || '') + '\n' +
          'Brand / Model: ' + (data.brand || '') + ' ' + (data.model || '') + '\n' +
          'Warranty: ' + (data.warranty || '') + '\n' +
          'Fault reported: ' + (data.faultDesc || '-') + '\n\n' +
          'Please review the Scheduler for full details.'
      });
      */
    }
  } catch (err) {
    console.error('Technician email failed: ' + err.message);
  }
}

function saveSchedule(email, token, data) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  data = data || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let apptNo;
  let scheduleSheet;
  let scheduleRowIndex = 0;
  try {
    const complaintSheet = getOrCreateNamedSheet_(CUSTOMER_COMPLAINTS_SHEET_NAME, CUSTOMER_COMPLAINTS_HEADERS);
    if (data.complaintNo && !findComplaintByNumber_(complaintSheet, data.complaintNo)) throw new Error('Complaint not found: ' + data.complaintNo);
    apptNo = nextAppointmentNumber_();
    scheduleSheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
    scheduleSheet.appendRow(scheduleRowValues_(data, apptNo, 'Scheduled', new Date()));
    scheduleRowIndex = scheduleSheet.getLastRow();
    completeComplaintAppointment_(data.complaintNo, apptNo, { ...data, updatedBy: email });
  } catch (err) {
    if (scheduleSheet && scheduleRowIndex > 1) scheduleSheet.deleteRow(scheduleRowIndex);
    throw err;
  } finally {
    lock.releaseLock();
  }
  sendScheduleEmails_(apptNo, data);
  return apptNo;
}

/**
 * Rewrites an EXISTING schedule row in place (used by the "Update"
 * button in the All Service Requests list) instead of appending a new
 * row, so editing a request never creates a duplicate. The original
 * Timestamp, Appointment No and Status are preserved automatically.
 */
function updateSchedule(email, token, rowIndex, data) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
    const existing = sheet.getRange(rowIndex, 1, 1, SCHEDULE_HEADERS.length).getValues()[0];
    const tsCol = SCHEDULE_HEADERS.indexOf('Timestamp');
    const apptCol = SCHEDULE_HEADERS.indexOf('Appointment No');
    const statusCol = SCHEDULE_HEADERS.indexOf('Status');
    const closedTsCol = SCHEDULE_HEADERS.indexOf('Closed Timestamp');
    const complaintCol = SCHEDULE_HEADERS.indexOf('Complaint No');
    const apptNo = existing[apptCol];
    const status = existing[statusCol];
    const values = scheduleRowValues_(data, apptNo, status, existing[tsCol]);
    if (closedTsCol >= 0) values[closedTsCol] = existing[closedTsCol] || '';
    if (complaintCol >= 0 && !data.complaintNo) values[complaintCol] = existing[complaintCol] || '';
    sheet.getRange(rowIndex, 1, 1, SCHEDULE_HEADERS.length).setValues([values]);
    return apptNo;
  } finally {
    lock.releaseLock();
  }
}

/** Returns every schedule row as an object keyed by column header, plus rowIndex (its real sheet row, needed to update it later). */
function listSchedules(email, token) {
  if (arguments.length) {
    const session = assertSessionPermission_(email, token, 'scheduler');
    if (!session || !session.ok) return [];
  }
  const sheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, SCHEDULE_HEADERS.length).getValues();
  return values.map((r, i) => {
    const obj = { rowIndex: i + 2 };
    SCHEDULE_HEADERS.forEach((h, j) => {
      const v = r[j];
      if (h === 'Appointment Time') {
        obj[h] = timeToPlain_(v);
      } else if (h === 'Appointment Date' && Object.prototype.toString.call(v) === '[object Date]') {
        obj[h] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        obj[h] = dateToPlain_(v);
      }
    });
    return obj;
  });
}

/** Reassigns a schedule to a different technician (used by the drag-and-drop calendar). Emails the newly assigned technician, if they have an email on file. */
function updateScheduleTechnician(email, token, rowIndex, technicianName) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const sheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
  const col = SCHEDULE_HEADERS.indexOf('Assigned Technician') + 1;
  sheet.getRange(rowIndex, col).setValue(technicianName);
  if (technicianName) {
    try {
      const row = sheet.getRange(rowIndex, 1, 1, SCHEDULE_HEADERS.length).getValues()[0];
      const data = {};
      SCHEDULE_HEADERS.forEach((h, j) => { data[h] = row[j]; });
      sendScheduleEmails_(data['Appointment No'], {
        technician: technicianName, customerName: data['Customer Name'], contactNo: data['Contact No'],
        location: data['Location / Address'], region: data['Region'], brand: data['Brand'], model: data['Model'],
        warranty: data['Job Warranty'], apptDate: dateToPlain_(data['Appointment Date']), apptTime: timeToPlain_(data['Appointment Time']),
        faultDesc: data['Fault Description']
      });
    } catch (err) {
      console.error('Reassign email failed: ' + err.message);
    }
  }
  return true;
}

/** Updates a schedule's status (Scheduled / In Progress / Completed / Cancelled). */
function updateScheduleStatus(email, token, rowIndex, status) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const allowedStatuses = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
  if (allowedStatuses.indexOf(status) === -1) throw new Error('Invalid schedule status.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS);
    const statusCol = SCHEDULE_HEADERS.indexOf('Status');
    const closedTsCol = SCHEDULE_HEADERS.indexOf('Closed Timestamp');
    const row = sheet.getRange(rowIndex, 1, 1, SCHEDULE_HEADERS.length).getValues()[0];
    const previousStatus = row[statusCol];
    const previousClosedTimestamp = closedTsCol >= 0 ? row[closedTsCol] : '';
    let closedTimestamp = previousClosedTimestamp || '';

    if (status === 'Completed' || status === 'Cancelled') {
      if (!closedTimestamp) closedTimestamp = new Date();
    } else if (previousStatus === 'Completed' || previousStatus === 'Cancelled') {
      closedTimestamp = '';
    }

    sheet.getRange(rowIndex, statusCol + 1).setValue(status);
    if (closedTsCol >= 0) sheet.getRange(rowIndex, closedTsCol + 1).setValue(closedTimestamp);
    invalidateDashboardCache();
    return { ok: true, status: status, closedTimestamp: dateToPlain_(closedTimestamp) };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// AWAITING SCHEDULE JOBS (draft placeholders) — solves the "one customer visit,
// many items" problem. Previously staff had to fill out the whole Scheduler form
// N times by hand just to get N separate appointment rows (one per item) that
// batch print could then group together — slow, and error-prone re-typing the
// same customer details N times. Now the form is filled out ONCE, then
// "Duplicate" clones it into N placeholders here — nothing is scheduled yet,
// no Appointment No is handed out. Each placeholder is later opened individually
// from the Scheduler page, has its item-specific fields (Brand/Model/Stock Item/
// Fault) edited, and saved — which is the moment it actually becomes a real
// appointment (assigned the next Appointment No, same as any other save) and is
// removed from this sheet.
// ------------------------------------------------------------------
const DRAFT_SCHEDULE_SHEET_NAME = 'AwaitingSchedules';
const DRAFT_SCHEDULE_HEADERS = [
  'Timestamp', 'BatchId', 'Customer Type', 'Customer Name', 'Contact No',
  'B2B Branch / School', 'Location / Address', 'Region', 'Brand', 'Model', 'Item Code',
  'Appointment Date', 'Appointment Time', 'DataJSON'
];

function getOrCreateDraftScheduleSheet_() {
  return getOrCreateNamedSheet_(DRAFT_SCHEDULE_SHEET_NAME, DRAFT_SCHEDULE_HEADERS);
}

function draftScheduleRowValues_(data, batchId, timestamp) {
  data = data || {};
  return [
    timestamp, batchId, data.customerType || '', data.customerName || '', data.contactNo || '',
    data.b2bBranchSchool || '', data.location || '', data.region || '', data.brand || '', data.model || '',
    data.itemCode || '', data.apptDate || '', data.apptTime || '', JSON.stringify(data)
  ];
}

/**
 * Clones ONE filled-out Scheduler form into `count` awaiting placeholders, all sharing
 * one BatchId so the page can show them grouped together. Capped at 50 as a sanity
 * limit against an accidental huge number. Nothing here touches the real Schedules
 * sheet or hands out an Appointment No — see promoteDraftSchedule() for that.
 */
function createDraftSchedules(email, token, data, count) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const n = Math.max(1, Math.min(50, parseInt(count, 10) || 1));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateDraftScheduleSheet_();
    const batchId = Utilities.getUuid();
    const now = new Date();
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(draftScheduleRowValues_(data, batchId, now));
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DRAFT_SCHEDULE_HEADERS.length).setValues(rows);
    return { ok: true, batchId: batchId, count: n };
  } finally {
    lock.releaseLock();
  }
}

/** Every awaiting job, oldest first, with rowIndex so the page can load one into the
 *  Scheduler form or discard it individually. */
function listDraftSchedules(email, token) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) return [];
  const sheet = getOrCreateDraftScheduleSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, DRAFT_SCHEDULE_HEADERS.length).getValues();
  return values.map((r, i) => {
    const obj = { rowIndex: i + 2 };
    DRAFT_SCHEDULE_HEADERS.forEach((h, j) => {
      const v = r[j];
      // Sheets silently auto-converts a plain "14:30" / "2026-09-10" string typed via
      // setValues into a real Time/Date serial \u2014 same quirk handled in listSchedules(),
      // must be undone here too or the awaiting-jobs list shows a mangled timestamp.
      if (h === 'Appointment Time') {
        obj[h] = timeToPlain_(v);
      } else if (h === 'Appointment Date' && Object.prototype.toString.call(v) === '[object Date]') {
        obj[h] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        obj[h] = dateToPlain_(v);
      }
    });
    return obj;
  });
}

/** Discards one awaiting job outright — used both for a manual "discard" and,
 *  internally, right after promoteDraftSchedule() turns one into a real appointment. */
function deleteDraftSchedule(email, token, rowIndex) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getOrCreateDraftScheduleSheet_().deleteRow(rowIndex);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Turns one awaiting job into a real appointment: assigns the next Appointment No the
 * exact same way saveSchedule() does (re-checks the live Schedules sheet, so numbering
 * is correct no matter how many other awaiting jobs are still pending), appends it to
 * the Schedules sheet, then removes the awaiting row so it stops showing up as pending.
 */
function promoteDraftSchedule(email, token, rowIndex, data) {
  const session = assertSessionPermission_(email, token, 'scheduler');
  if (!session || !session.ok) throw new Error(session.error || 'Scheduler access required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let apptNo;
  try {
    apptNo = nextAppointmentNumber_();
    getOrCreateNamedSheet_(SCHEDULE_SHEET_NAME, SCHEDULE_HEADERS)
      .appendRow(scheduleRowValues_(data, apptNo, 'Scheduled', new Date()));
    getOrCreateDraftScheduleSheet_().deleteRow(rowIndex);
  } finally {
    lock.releaseLock();
  }
  sendScheduleEmails_(apptNo, data);
  invalidateDashboardCache();
  return apptNo;
}


/**
 * ---------------------------------------------------------------
 * SETUP — do this once
 * ---------------------------------------------------------------
 * 1. Create (or open) the Google Sheet you want this to live in, e.g.
 *    "Jacky's Service Records".
 * 2. In the Sheet, go to Extensions > Apps Script.
 * 3. Delete any starter code in Code.gs and paste in this entire file.
 * 4. In the Apps Script editor, add a new HTML file:
 *      File > New > HTML file, name it exactly:  Index
 *    (it will appear as Index.html). Delete its starter content and
 *    paste in the Index.html file provided alongside this one.
 * 5. Click the disk icon to save both files.
 * 6. Click "Deploy" (top right) > "New deployment".
 * 7. Click the gear icon next to "Select type" and choose "Web app".
 * 8. Set:
 *      - Description: anything, e.g. "Service forms"
 *      - Execute as: Me
 *      - Who has access: Anyone (or "Anyone within [your org]")
 * 9. Click "Deploy". The first time, Google will ask you to authorize
 *    the script — approve it and click through the "unverified app"
 *    warning (it's your own script).
 * 10. Copy the "Web app URL" (ends in /exec) it gives you — THIS is the
 *     link to bookmark and share with your team.
 *
 * The four tabs (Quotations, Inspections, AMCQuotes, AMCContracts) are
 * created automatically the first time each type is saved, or you can
 * create/verify them upfront using the "Initialize / Verify Google
 * Sheet" button on the page's Dashboard tab, which calls
 * initializeSheets() below.
 *
 * If a tab already exists from an older version of this script with a
 * different set of columns, getOrCreateSheet_() automatically fixes
 * row 1 (the headers) to match the  new current layout below — it never
 * touches or reorders your existing data rows, so it's always safe.
 *
 * Whenever you edit Code.gs or Index.html afterwards, go to Deploy >
 * Manage deployments > (pencil/edit icon) > New version > Deploy, so
 * your changes actually reach the published /exec URL.
 *
 * ---------------------------------------------------------------
 * YOUR LOGO IMAGE
 * ---------------------------------------------------------------
 * The logo is NOT handled in this file anymore — it's a plain image
 * URL directly in Index.html's <img class="logo"> tags, pointing at
 * https://lh3.googleusercontent.com/d/YOUR_DRIVE_FILE_ID. See the
 * comment above those tags in Index.html for the exact steps
 * (uploading to Drive, sharing it, and getting that URL).
 */
// ============================================================
// AUTHENTICATION & USER MANAGEMENT — added for the standalone
// login portal build. Purely additive: nothing above this point
// was changed. Users sheet + ActivityLog sheet are separate from
// SHEETS/HEADERS_BY_TYPE above and are self-created on first use.
// ============================================================

const USERS_SHEET_NAME = 'Users';
const USERS_HEADERS = ['Email','Name','Role','PasswordHash','Salt','MustChangePassword','SessionTokenHash','SessionExpiry','Created','LastLogin'];
const ACTIVITY_SHEET_NAME = 'ActivityLog';
const ACTIVITY_HEADERS = ['Timestamp','Email','Action','Details'];
const ROLE_ACCESS_SHEET_NAME = 'RoleAccess';
const ROLE_ACCESS_HEADERS = ['Role', 'PermissionsJSON', 'UpdatedAt', 'UpdatedBy'];
const ACCESSIBLE_ROLES = ['user', 'sales', 'management', 'admin'];
const ROLE_ACCESS_KEYS = [
  'quotation', 'inspection', 'scheduler', 'service-job-card', 'dashboard',
  'amc-quote', 'amc-contract', 'vas-pricing', 'vas-sales', 'rate-card',
  'dandi-installation-pricing', 'thomson-proposal', 'revenue-dashboard'
];

const ADMIN_SEED_EMAIL = 'veethreevysakh@gmail.com';
const DEFAULT_ADMIN_PASSWORD = 'Jackys@Admin1';
const DEFAULT_USER_PASSWORD = 'Jackys@2026';
const SESSION_DAYS = 30;

function hashWithSalt_(text, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text + '::' + salt, Utilities.Charset.UTF_8);
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}
function randomSalt_() { return Utilities.getUuid(); }
function randomToken_() { return Utilities.getUuid() + Utilities.getUuid(); }

function defaultRolePermissions_(role) {
  const permissions = {};
  ROLE_ACCESS_KEYS.forEach(key => { permissions[key] = true; });
  if (role === 'sales') permissions['revenue-dashboard'] = false;
  return permissions;
}

function getOrCreateRoleAccessSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ROLE_ACCESS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ROLE_ACCESS_SHEET_NAME);
    sheet.appendRow(ROLE_ACCESS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getRolePermissions_(role) {
  if (role === 'admin') return defaultRolePermissions_('admin');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROLE_ACCESS_SHEET_NAME);
  if (!sheet) return defaultRolePermissions_(role);
  const values = sheet.getDataRange().getValues();
  const row = values.slice(1).find(item => String(item[0]).trim() === String(role).trim());
  if (!row) return defaultRolePermissions_(role);
  try {
    const saved = JSON.parse(String(row[1] || '{}'));
    const permissions = defaultRolePermissions_(role);
    ROLE_ACCESS_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(saved, key)) permissions[key] = saved[key] === true;
    });
    return permissions;
  } catch (e) {
    return defaultRolePermissions_(role);
  }
}

function assertSessionPermission_(email, token, key) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };
  if (session.user.role !== 'admin' && !getRolePermissions_(session.user.role)[key]) {
    return { ok: false, error: 'You do not have access to this section.' };
  }
  return session;
}

function getOrCreateUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.appendRow(USERS_HEADERS);
    sheet.setFrozenRows(1);
    // Seed the one admin account so the portal is usable on first deploy.
    const salt = randomSalt_();
    sheet.appendRow([
      ADMIN_SEED_EMAIL, 'Admin', 'admin', hashWithSalt_(DEFAULT_ADMIN_PASSWORD, salt), salt,
      true, '', '', new Date(), ''
    ]);
    return sheet;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const matches = USERS_HEADERS.length === currentHeaders.length && USERS_HEADERS.every((h,i) => h === currentHeaders[i]);
  if (!matches) { sheet.getRange(1,1,1,USERS_HEADERS.length).setValues([USERS_HEADERS]); sheet.setFrozenRows(1); }
  return sheet;
}

function getOrCreateActivitySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ACTIVITY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACTIVITY_SHEET_NAME);
    sheet.appendRow(ACTIVITY_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findUserRow_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  const emailLower = String(email || '').trim().toLowerCase();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim().toLowerCase() === emailLower) return { rowIndex: r + 1, row: data[r] };
  }
  return null;
}

function userToClientObject_(row) {
  return { email: row[0], name: row[1], role: row[2], mustChangePassword: !!row[5], permissions: getRolePermissions_(row[2]) };
}

/** Verifies caller is an admin by re-checking their role server-side — never trusts a client-claimed role. */
function assertAdmin_(callerEmail) {
  const sheet = getOrCreateUsersSheet_();
  const found = findUserRow_(sheet, callerEmail);
  if (!found || found.row[2] !== 'admin') throw new Error('Admin access required.');
  return found;
}

function loginUser(email, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateUsersSheet_();
    const found = findUserRow_(sheet, email);
    if (!found) return { ok: false, error: 'No account found for that email.' };
    const [ , , , storedHash, salt ] = found.row;
    if (hashWithSalt_(password, salt) !== storedHash) return { ok: false, error: 'Incorrect password.' };

    const token = randomToken_();
    const tokenSalt = randomSalt_();
    const expiry = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    sheet.getRange(found.rowIndex, 7, 1, 3).setValues([[hashWithSalt_(token, tokenSalt) + '::' + tokenSalt, expiry, new Date()]]);
    // LastLogin column (10th) updated separately since column 9 (Created) must stay untouched
    sheet.getRange(found.rowIndex, 10).setValue(new Date());

    return { ok: true, user: userToClientObject_(found.row), sessionToken: token };
  } finally {
    lock.releaseLock();
  }
}

function validateSession(email, token) {
  const sheet = getOrCreateUsersSheet_();
  const found = findUserRow_(sheet, email);
  if (!found) return { ok: false };
  const stored = found.row[6]; // SessionTokenHash::salt
  const expiry = found.row[7];
  if (!stored || !expiry) return { ok: false };
  if (new Date(expiry).getTime() < Date.now()) return { ok: false };
  const [storedHash, tokenSalt] = String(stored).split('::');
  if (hashWithSalt_(token, tokenSalt) !== storedHash) return { ok: false };
  return { ok: true, user: userToClientObject_(found.row) };
}

function logoutUser(email) {
  const sheet = getOrCreateUsersSheet_();
  const found = findUserRow_(sheet, email);
  if (found) sheet.getRange(found.rowIndex, 7, 1, 2).setValues([['', '']]);
  return { ok: true };
}

function changeMyPassword(email, oldPassword, newPassword) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!newPassword || newPassword.length < 6) return { ok: false, error: 'New password must be at least 6 characters.' };
    const sheet = getOrCreateUsersSheet_();
    const found = findUserRow_(sheet, email);
    if (!found) return { ok: false, error: 'Account not found.' };
    const [ , , , storedHash, salt ] = found.row;
    if (hashWithSalt_(oldPassword, salt) !== storedHash) return { ok: false, error: 'Current password is incorrect.' };
    const newSalt = randomSalt_();
    sheet.getRange(found.rowIndex, 4, 1, 3).setValues([[hashWithSalt_(newPassword, newSalt), newSalt, false]]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function adminListUsers(callerEmail) {
  assertAdmin_(callerEmail);
  const sheet = getOrCreateUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    out.push({
      email: row[0], name: row[1], role: row[2], mustChangePassword: !!row[5],
      created: row[8] ? Utilities.formatDate(new Date(row[8]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      lastLogin: row[9] ? Utilities.formatDate(new Date(row[9]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : 'Never'
    });
  }
  return out;
}

function adminGetRolePermissions(callerEmail) {
  assertAdmin_(callerEmail);
  getOrCreateRoleAccessSheet_();
  return ACCESSIBLE_ROLES.reduce((out, role) => {
    out[role] = getRolePermissions_(role);
    return out;
  }, {});
}

function adminSaveRolePermissions(callerEmail, permissionsByRole) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateRoleAccessSheet_();
    const rows = sheet.getDataRange().getValues();
    ACCESSIBLE_ROLES.forEach(role => {
      const input = permissionsByRole && permissionsByRole[role];
      const permissions = defaultRolePermissions_(role);
      if (role !== 'admin') {
        ROLE_ACCESS_KEYS.forEach(key => {
          if (input && Object.prototype.hasOwnProperty.call(input, key)) permissions[key] = input[key] === true;
        });
      }
      const rowOffset = rows.slice(1).findIndex(row => String(row[0]).trim() === role);
      const values = [role, JSON.stringify(permissions), new Date(), callerEmail];
      if (rowOffset >= 0) sheet.getRange(rowOffset + 2, 1, 1, ROLE_ACCESS_HEADERS.length).setValues([values]);
      else sheet.appendRow(values);
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

const PHONE_REPAIR_FIELDS = [
  { sheetName: SCHEDULE_SHEET_NAME, field: 'Contact No', sourceKey: 'contactNo' },
  { sheetName: SCHEDULE_SHEET_NAME, field: 'School Contact Number', sourceKey: 'schoolContactNumber' },
  { sheetName: SHEETS.quotation, field: 'Contact No', sourceKey: 'qContact' },
  { sheetName: SHEETS.inspection, field: 'Contact No', sourceKey: 'iContact' },
  { sheetName: SHEETS['thomson-proposal'], field: 'Contact No', sourceKey: 'thContact' },
  { sheetName: SHEETS['vas-sale'], field: 'Contact No', sourceKey: 'custContact' },
  { sheetName: SHEETS['service-job-card'], field: 'Contact No', sourceKey: 'custContact' },
  { sheetName: SHEETS['service-job-card'], field: 'School Contact Number', sourceKey: 'schoolContactNumber' }
];

function inferredUaeMobile_(value) {
  const text = String(value == null ? '' : value).trim();
  const digits = text.replace(/[^\d]/g, '');
  if (text.indexOf('+') === 0 || digits.indexOf('971') === 0 || digits.length !== 9 || digits.charAt(0) !== '5') return '';
  return '0' + digits;
}

function phoneRepairCandidates_() {
  const candidates = [];
  PHONE_REPAIR_FIELDS.forEach(spec => {
    const sheet = getOrCreateNamedSheet_(spec.sheetName, spec.sheetName === SCHEDULE_SHEET_NAME ? SCHEDULE_HEADERS :
      spec.sheetName === SHEETS['service-job-card'] ? HEADERS_BY_TYPE['service-job-card'] :
      Object.keys(SHEETS).map(type => SHEETS[type] === spec.sheetName ? HEADERS_BY_TYPE[type] : null).find(Boolean));
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const fieldIndex = headers.indexOf(spec.field);
    const numberIndex = headers.indexOf('Appointment No') >= 0 ? headers.indexOf('Appointment No') : headers.indexOf('Number');
    if (fieldIndex < 0 || sheet.getLastRow() < 2) return;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    values.forEach((row, index) => {
      const current = String(row[fieldIndex] == null ? '' : row[fieldIndex]).trim();
      if (!current || /^0\d{9}$/.test(current) || /^\+?971/.test(current)) return;
      let proposed = '';
      let reason = '';
      if (spec.sheetName === SHEETS['service-job-card']) {
        try {
          const parsed = JSON.parse(String(row[headers.indexOf('DataJSON')] || '{}'));
          const original = String(parsed[spec.sourceKey] || '').trim();
          if (/^0\d{9}$/.test(original)) {
            proposed = original;
            reason = 'Recovered original value from DataJSON';
          }
        } catch (e) { /* use pattern inference below */ }
      }
      if (!proposed) {
        proposed = inferredUaeMobile_(current);
        reason = proposed ? 'Added missing UAE mobile prefix 0' : '';
      }
      if (proposed && proposed !== current) {
        candidates.push({
          sheetName: spec.sheetName, rowIndex: index + 2, field: spec.field,
          record: numberIndex >= 0 ? String(row[numberIndex] || '') : String(index + 2),
          current: current, proposed: proposed, reason: reason
        });
      }
    });
  });
  return candidates;
}

function adminPreviewPhoneRepairs(callerEmail) {
  assertAdmin_(callerEmail);
  return phoneRepairCandidates_();
}

function adminApplyPhoneRepairs(callerEmail) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const candidates = phoneRepairCandidates_();
    candidates.forEach(item => {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(item.sheetName);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const col = headers.indexOf(item.field) + 1;
      sheet.getRange(item.rowIndex, col).setNumberFormat('@').setValue(item.proposed);
    });
    return { ok: true, repaired: candidates.length };
  } finally {
    lock.releaseLock();
  }
}

function adminAddUser(callerEmail, name, email, role) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateUsersSheet_();
    if (findUserRow_(sheet, email)) return { ok: false, error: 'A user with that email already exists.' };
    const salt = randomSalt_();
    sheet.appendRow([
      String(email).trim(), name || '', (['admin','management','sales'].includes(role) ? role : 'user'),
      hashWithSalt_(DEFAULT_USER_PASSWORD, salt), salt, true, '', '', new Date(), ''
    ]);
    return { ok: true, defaultPassword: DEFAULT_USER_PASSWORD };
  } finally {
    lock.releaseLock();
  }
}

function adminResetPassword(callerEmail, targetEmail) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateUsersSheet_();
    const found = findUserRow_(sheet, targetEmail);
    if (!found) return { ok: false, error: 'User not found.' };
    const salt = randomSalt_();
    sheet.getRange(found.rowIndex, 4, 1, 3).setValues([[hashWithSalt_(DEFAULT_USER_PASSWORD, salt), salt, true]]);
    return { ok: true, defaultPassword: DEFAULT_USER_PASSWORD };
  } finally {
    lock.releaseLock();
  }
}

function adminDeleteUser(callerEmail, targetEmail) {
  const admin = assertAdmin_(callerEmail);
  if (String(targetEmail).toLowerCase() === String(callerEmail).toLowerCase()) {
    return { ok: false, error: "You can't delete your own account while signed in." };
  }
  const sheet = getOrCreateUsersSheet_();
  const found = findUserRow_(sheet, targetEmail);
  if (!found) return { ok: false, error: 'User not found.' };
  if (found.row[2] === 'admin') {
    const data = sheet.getDataRange().getValues();
    const adminCount = data.slice(1).filter(r => r[2] === 'admin').length;
    if (adminCount <= 1) return { ok: false, error: 'Cannot delete the last remaining admin.' };
  }
  sheet.deleteRow(found.rowIndex);
  return { ok: true };
}

function logActivity(email, action, details) {
  try {
    const usersSheet = getOrCreateUsersSheet_();
    if (!findUserRow_(usersSheet, email)) return { ok: false }; // ignore log attempts from unknown emails
    const sheet = getOrCreateActivitySheet_();
    sheet.appendRow([new Date(), email, action || '', details || '']);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function adminListActivity(callerEmail, fromDate, toDate) {
  assertAdmin_(callerEmail);
  const sheet = getOrCreateActivitySheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  let values = sheet.getRange(2, 1, lastRow - 1, ACTIVITY_HEADERS.length).getValues();
  const from = String(fromDate || '').trim();
  const to = String(toDate || '').trim();

  if (from || to) {
    const startValue = from || to;
    const endValue = to || from;
    const start = new Date(startValue + 'T00:00:00');
    const end = new Date(endValue + 'T23:59:59.999');

    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      values = values.filter(r => {
        const ts = r[0];
        if (!ts) return false;
        const dt = ts instanceof Date ? ts : new Date(ts);
        return !isNaN(dt.getTime()) && dt >= start && dt <= end;
      });
    }
  }

  const numRows = Math.min(values.length, 500); // most recent 500 entries
  return values.slice(-numRows).reverse().map(r => ({
    timestamp: Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    email: r[1], action: r[2], details: r[3]
  }));
}

// ============================================================
// MASTER EXCEL — admin uploads once, every signed-in user gets
// it automatically. The file is stored as-is in Google Drive
// (not converted) and served back as base64 bytes, which the
// client feeds into the SAME XLSX.read() pipeline it already
// uses for a locally-picked file — so none of the existing
// extraction logic (VAS/Thomson/AMC parsing) needed to change.
// ============================================================

const MASTER_EXCEL_FOLDER_NAME = 'Service Portal — Master Data';
const MASTER_EXCEL_FILENAME = 'Master_Service_Budget.xlsx';

function getOrCreateMasterFolder_() {
  const it = DriveApp.getFoldersByName(MASTER_EXCEL_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(MASTER_EXCEL_FOLDER_NAME);
}

/** Admin uploads (or replaces) the master Excel. base64Data is the raw file bytes, base64-encoded. */
function adminUploadMasterExcel(callerEmail, base64Data, filename) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = getOrCreateMasterFolder_();
    // Remove any previous copy so there's only ever one live master file.
    const existing = folder.getFilesByName(MASTER_EXCEL_FILENAME);
    while (existing.hasNext()) existing.next().setTrashed(true);

    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', MASTER_EXCEL_FILENAME);
    const file = folder.createFile(blob);

    const props = PropertiesService.getScriptProperties();
    props.setProperty('MASTER_EXCEL_FILE_ID', file.getId());
    props.setProperty('MASTER_EXCEL_UPLOADED_AT', new Date().toISOString());
    props.setProperty('MASTER_EXCEL_UPLOADED_BY', callerEmail);
    props.setProperty('MASTER_EXCEL_ORIGINAL_NAME', filename || MASTER_EXCEL_FILENAME);

    return { ok: true, uploadedAt: props.getProperty('MASTER_EXCEL_UPLOADED_AT') };
  } finally {
    lock.releaseLock();
  }
}

/** Metadata only (no file bytes) — safe to show in the UI without re-checking auth every time. */
function getMasterExcelInfo() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MASTER_EXCEL_FILE_ID');
  if (!id) return { exists: false };
  return {
    exists: true,
    uploadedAt: props.getProperty('MASTER_EXCEL_UPLOADED_AT') || '',
    uploadedBy: props.getProperty('MASTER_EXCEL_UPLOADED_BY') || '',
    originalName: props.getProperty('MASTER_EXCEL_ORIGINAL_NAME') || MASTER_EXCEL_FILENAME
  };
}

/**
 * Returns the master Excel file as base64 bytes — requires a valid, still-live session
 * (not just a claimed email), so only someone who has actually signed in successfully
 * can pull the confidential data, even though the underlying Apps Script function is
 * technically callable directly. This is a lightweight, not enterprise-grade, gate —
 * consistent with the whole portal's stated security level.
 */
function getMasterExcelData(email, token) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MASTER_EXCEL_FILE_ID');
  if (!id) return { ok: false, error: 'No master file has been uploaded yet.' };
  try {
    const file = DriveApp.getFileById(id);
    const bytes = file.getBlob().getBytes();
    return { ok: true, base64: Utilities.base64Encode(bytes), filename: props.getProperty('MASTER_EXCEL_ORIGINAL_NAME') || MASTER_EXCEL_FILENAME };
  } catch (e) {
    return { ok: false, error: 'Could not read the master file: ' + e.message };
  }
}


// ============================================================
// REVENUE DASHBOARD DATA — a SECOND, independent master file
// (Service_Dashboard_Master_ACC.xlsm), uploaded and replaced by the
// admin the same way as the pricing workbook, stored separately in
// its own Drive folder/properties so the two never collide.
// ============================================================
const DASHBOARD_EXCEL_FOLDER_NAME = 'Service Portal — Dashboard Data';
const DASHBOARD_EXCEL_FILENAME = 'Service_Dashboard_Master.xlsm';

function getOrCreateDashboardFolder_() {
  const it = DriveApp.getFoldersByName(DASHBOARD_EXCEL_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(DASHBOARD_EXCEL_FOLDER_NAME);
}

function adminUploadDashboardExcel(callerEmail, base64Data, filename) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = getOrCreateDashboardFolder_();
    const existing = folder.getFilesByName(DASHBOARD_EXCEL_FILENAME);
    while (existing.hasNext()) existing.next().setTrashed(true);

    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, 'application/vnd.ms-excel.sheet.macroEnabled.12', DASHBOARD_EXCEL_FILENAME);
    const file = folder.createFile(blob);

    const props = PropertiesService.getScriptProperties();
    props.setProperty('DASHBOARD_EXCEL_FILE_ID', file.getId());
    props.setProperty('DASHBOARD_EXCEL_UPLOADED_AT', new Date().toISOString());
    props.setProperty('DASHBOARD_EXCEL_UPLOADED_BY', callerEmail);
    props.setProperty('DASHBOARD_EXCEL_ORIGINAL_NAME', filename || DASHBOARD_EXCEL_FILENAME);

    return { ok: true, uploadedAt: props.getProperty('DASHBOARD_EXCEL_UPLOADED_AT') };
  } finally {
    lock.releaseLock();
  }
}

function getDashboardExcelInfo() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DASHBOARD_EXCEL_FILE_ID');
  if (!id) return { exists: false };
  return {
    exists: true,
    uploadedAt: props.getProperty('DASHBOARD_EXCEL_UPLOADED_AT') || '',
    uploadedBy: props.getProperty('DASHBOARD_EXCEL_UPLOADED_BY') || '',
    originalName: props.getProperty('DASHBOARD_EXCEL_ORIGINAL_NAME') || DASHBOARD_EXCEL_FILENAME
  };
}

function getDashboardExcelData(email, token) {
  const session = assertSessionPermission_(email, token, 'revenue-dashboard');
  if (!session || !session.ok) return session;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DASHBOARD_EXCEL_FILE_ID');
  if (!id) return { ok: false, error: 'No dashboard file has been uploaded yet.' };
  try {
    const file = DriveApp.getFileById(id);
    const bytes = file.getBlob().getBytes();
    return { ok: true, base64: Utilities.base64Encode(bytes), filename: props.getProperty('DASHBOARD_EXCEL_ORIGINAL_NAME') || DASHBOARD_EXCEL_FILENAME };
  } catch (e) {
    return { ok: false, error: 'Could not read the dashboard file: ' + e.message };
  }
}

// ============================================================
// DASHBOARD SNAPSHOT CACHE — single call returns all 7 record types
// from a server-side CacheService entry refreshed every 15 seconds.
// This replaces the 7 sequential listRecordsWithIndex calls the client
// used to make on every Dashboard click/save.
// ============================================================
const DASH_CACHE_KEY = 'service_dashboard_snapshot';
const DASH_CACHE_TTL = 60; // seconds

const DASH_SUMMARY_CACHE_KEY = 'service_dashboard_summary';
const DASH_SUMMARY_CACHE_TTL = 60; // seconds

/**
 * Background refresh for the dashboard cache. This is intentionally lightweight:
 * it only rebuilds the cached snapshot/overview used by the dashboard tiles and
 * scheduler counts, so the data stays fresh even when the user is not actively
 * on the dashboard tab. This is the server-side equivalent of a 60-second refresh.
 */
function refreshDashboardCacheInBackground() {
  try {
    const types = Object.keys(SHEETS);
    const snapshot = { _ts: Date.now() };
    types.forEach(type => {
      const sheet = getOrCreateSheet_(type);
      const headers = HEADERS_BY_TYPE[type];
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        snapshot[type] = [];
        return;
      }
      const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      snapshot[type] = values.map(function (r, i) {
        const obj = { rowIndex: i + 2 };
        headers.forEach(function (h, j) {
          let v = r[j];
          if (Object.prototype.toString.call(v) === '[object Date]') {
            v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
          }
          obj[h] = v;
        });
        return obj;
      });
    });

    snapshot.schedules = listSchedules();
    const cache = CacheService.getScriptCache();
    try {
      cache.put(DASH_CACHE_KEY, JSON.stringify(snapshot), DASH_CACHE_TTL);
    } catch (cacheErr) {
      console.warn('Dashboard snapshot cache skipped:', cacheErr && cacheErr.message ? cacheErr.message : cacheErr);
    }

    const overview = { _ts: Date.now(), counts: {}, schedules: snapshot.schedules || [] };
    types.forEach(type => {
      overview.counts[type] = Array.isArray(snapshot[type]) ? snapshot[type].length : 0;
    });
    const scheduleCounts = { Scheduled: 0, 'In Progress': 0, Completed: 0, Cancelled: 0 };
    overview.schedules.forEach(row => {
      const status = scheduleCounts[row.Status] !== undefined ? row.Status : 'Scheduled';
      scheduleCounts[status] += 1;
    });
    overview.schedulerCounts = scheduleCounts;
    cache.put(DASH_SUMMARY_CACHE_KEY, JSON.stringify(overview), DASH_SUMMARY_CACHE_TTL);
    return { ok: true, cached: true, ageSec: 0 };
  } catch (err) {
    console.error('refreshDashboardCacheInBackground failed:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/** Hook to install a minute-based background refresh trigger for the dashboard cache. */
function installDashboardBackgroundRefreshTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === 'refreshDashboardCacheInBackground');
  if (exists) return { ok: true, alreadyInstalled: true };
  ScriptApp.newTrigger('refreshDashboardCacheInBackground')
    .timeBased()
    .everyMinutes(1)
    .create();
  return { ok: true, alreadyInstalled: false };
}

function getDashboardOverview(email, token) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };

  const cache = CacheService.getScriptCache();
  const cached = cache.get(DASH_SUMMARY_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return { ok: true, data: parsed, cached: true, ageSec: Math.floor((Date.now() - parsed._ts) / 1000) };
    } catch (e) {
      // fall through to rebuild
    }
  }

  const types = Object.keys(SHEETS);
  const overview = { _ts: Date.now(), counts: {}, schedules: [] };
  types.forEach(type => {
    const sheet = getOrCreateSheet_(type);
    overview.counts[type] = Math.max(0, sheet.getLastRow() - 1);
  });
  overview.schedules = listSchedules();
  const scheduleCounts = { Scheduled: 0, 'In Progress': 0, Completed: 0, Cancelled: 0 };
  overview.schedules.forEach(row => {
    const status = scheduleCounts[row.Status] !== undefined ? row.Status : 'Scheduled';
    scheduleCounts[status] += 1;
  });
  overview.schedulerCounts = scheduleCounts;

  cache.put(DASH_SUMMARY_CACHE_KEY, JSON.stringify(overview), DASH_SUMMARY_CACHE_TTL);
  return { ok: true, data: overview, cached: false, ageSec: 0 };
}

function getReportRows(email, token, type) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };
  if (type === 'scheduler') return { ok: true, type: type, rows: listSchedules(), cached: false, ageSec: 0 };
  if (!type || !SHEETS[type]) return { ok: false, error: 'Unknown report type.' };

  const sheet = getOrCreateSheet_(type);
  const headers = HEADERS_BY_TYPE[type].filter(function (header) {
    return header !== 'DataJSON' && header.indexOf('_') !== 0;
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, type: type, rows: [], cached: false, ageSec: 0 };

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS_BY_TYPE[type].length).getValues();
  const sourceHeaders = HEADERS_BY_TYPE[type];
  const rows = values.map(function (row, index) {
    const result = { rowIndex: index + 2 };
    headers.forEach(function (header) {
      const columnIndex = sourceHeaders.indexOf(header);
      let value = row[columnIndex];
      if (Object.prototype.toString.call(value) === '[object Date]') {
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      result[header] = value;
    });
    return result;
  });

  return { ok: true, type: type, rows: rows, cached: false, ageSec: 0 };
}

function getDashboardSnapshot(email, token) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };

  const cache = CacheService.getScriptCache();
  const cached = cache.get(DASH_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return { ok: true, data: parsed, cached: true, ageSec: Math.floor((Date.now() - parsed._ts) / 1000) };
    } catch (e) {
      // fall through to rebuild
    }
  }

  // Build fresh snapshot (single multi-sheet read, no locks needed for reads)
  const types = Object.keys(SHEETS);
  const snapshot = { _ts: Date.now() };
  types.forEach(type => {
    const sheet = getOrCreateSheet_(type);
    const headers = HEADERS_BY_TYPE[type];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      snapshot[type] = [];
      return;
    }
    const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    snapshot[type] = values.map(function (r, i) {
      const obj = { rowIndex: i + 2 };
      headers.forEach(function (h, j) {
        let v = r[j];
        if (Object.prototype.toString.call(v) === '[object Date]') {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        }
        obj[h] = v;
      });
      return obj;
    });
  });
  snapshot.schedules = listSchedules();

  try {
    cache.put(DASH_CACHE_KEY, JSON.stringify(snapshot), DASH_CACHE_TTL);
  } catch (cacheErr) {
    console.warn('Dashboard snapshot cache skipped:', cacheErr && cacheErr.message ? cacheErr.message : cacheErr);
  }
  return { ok: true, data: snapshot, cached: false, ageSec: 0 };
}

function invalidateDashboardCache() {
  CacheService.getScriptCache().remove(DASH_CACHE_KEY);
  CacheService.getScriptCache().remove(DASH_SUMMARY_CACHE_KEY);
  return { ok: true };
}

// ============================================================
// VAS PRICE BANDING & PROFIT SPLIT — admin-editable overrides.
// The Excel workbook is always the DEFAULT (read on the client from
// the already-loaded VAS Pricing / GP Split sheets); the moment an
// admin saves a change here, that becomes the live source of truth
// instead, stored in its own sheet so it survives independently of
// whatever Excel gets uploaded next. Whole-table replace, not
// per-row records — these are small config tables, not growing logs.
// ============================================================
const VAS_BANDS_SHEET_NAME = 'VAS_PriceBands_Admin';
const VAS_BANDS_HEADERS = ['Band Label', 'Band Start', 'Band End', 'Midpoint'];
const VAS_SPLIT_SHEET_NAME = 'VAS_ProfitSplit_Admin';
const VAS_SPLIT_HEADERS = ['Plan', 'Service %', 'Sales %'];

function getVasPriceBandsOverride() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(VAS_BANDS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, bands: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, VAS_BANDS_HEADERS.length).getValues();
  const bands = values
    .filter(r => String(r[0] || '').trim() !== '')
    .map(r => ({ label: r[0], start: Number(r[1]) || 0, end: Number(r[2]) || 0, midpoint: Number(r[3]) || 0 }));
  return { exists: bands.length > 0, bands: bands };
}

function adminSaveVasPriceBands(callerEmail, bands) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(VAS_BANDS_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(VAS_BANDS_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, VAS_BANDS_HEADERS.length).setValues([VAS_BANDS_HEADERS]);
    sheet.setFrozenRows(1);
    if (bands && bands.length) {
      const rows = bands.map(b => [b.label || '', b.start || 0, b.end || 0, b.midpoint || 0]);
      sheet.getRange(2, 1, rows.length, VAS_BANDS_HEADERS.length).setValues(rows);
    }
    return { ok: true, savedAt: new Date().toISOString(), savedBy: callerEmail, count: (bands || []).length };
  } finally {
    lock.releaseLock();
  }
}

function getVasProfitSplitOverride() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(VAS_SPLIT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, split: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, VAS_SPLIT_HEADERS.length).getValues();
  const split = values
    .filter(r => String(r[0] || '').trim() !== '')
    .map(r => ({ plan: r[0], servicePct: Number(r[1]) || 0, salesPct: Number(r[2]) || 0 }));
  return { exists: split.length > 0, split: split };
}

function adminSaveVasProfitSplit(callerEmail, split) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(VAS_SPLIT_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(VAS_SPLIT_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, VAS_SPLIT_HEADERS.length).setValues([VAS_SPLIT_HEADERS]);
    sheet.setFrozenRows(1);
    if (split && split.length) {
      const rows = split.map(s => [s.plan || '', s.servicePct || 0, s.salesPct || 0]);
      sheet.getRange(2, 1, rows.length, VAS_SPLIT_HEADERS.length).setValues(rows);
    }
    return { ok: true, savedAt: new Date().toISOString(), savedBy: callerEmail, count: (split || []).length };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// VAS PRICING PARAMETERS — the actual master calculator inputs
// (rate %, minimum fee floor, rounding step, deductible, service fee
// tiers per plan) that drive the whole 16-band price card, exactly
// like the "EDIT ANY VALUE AND THE WHOLE CARD REPRICES" block in the
// Excel. A simple key/value table — the client recomputes every
// band's fee from these the same way the Excel formula does.
// ============================================================
const VAS_PARAMS_SHEET_NAME = 'VAS_PricingParams_Admin';
const VAS_PARAMS_HEADERS = ['Key', 'Value'];

function getVasPricingParamsOverride() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(VAS_PARAMS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, params: {} };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, VAS_PARAMS_HEADERS.length).getValues();
  const params = {};
  values.forEach(r => { if (String(r[0] || '').trim() !== '') params[r[0]] = Number(r[1]) || 0; });
  return { exists: Object.keys(params).length > 0, params: params };
}

function adminSaveVasPricingParams(callerEmail, paramsObj) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(VAS_PARAMS_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(VAS_PARAMS_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, VAS_PARAMS_HEADERS.length).setValues([VAS_PARAMS_HEADERS]);
    sheet.setFrozenRows(1);
    const keys = Object.keys(paramsObj || {});
    if (keys.length) {
      const rows = keys.map(k => [k, paramsObj[k]]);
      sheet.getRange(2, 1, rows.length, VAS_PARAMS_HEADERS.length).setValues(rows);
    }
    return { ok: true, savedAt: new Date().toISOString(), savedBy: callerEmail, count: keys.length };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// STOCK REPORT MASTER — separate from the service budget workbook.
// The browser parses the uploaded workbook so the accepted report layout can
// vary; only the normalized stock rows are kept in the page cache.
// ============================================================
const STOCK_EXCEL_FOLDER_NAME = 'Service Portal — Stock Data';
const STOCK_EXCEL_FILENAME = 'CurrentStockValuation.xlsx';

// Admin override for the Service Rate Card. The Excel remains the default;
// this single JSON row becomes the live source only after an admin saves it.
const RATE_CARD_OVERRIDE_SHEET_NAME = 'ServiceRateCard_Admin';
const RATE_CARD_OVERRIDE_HEADERS = ['Updated At', 'Updated By', 'SectionsJSON'];

function getRateCardOverride() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RATE_CARD_OVERRIDE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, sections: [] };
  const row = sheet.getRange(sheet.getLastRow(), 1, 1, RATE_CARD_OVERRIDE_HEADERS.length).getValues()[0];
  try {
    const sections = JSON.parse(String(row[2] || '[]'));
    return { exists: Array.isArray(sections) && sections.length > 0, sections: Array.isArray(sections) ? sections : [] };
  } catch (e) {
    return { exists: false, sections: [] };
  }
}

function adminSaveRateCardOverride(callerEmail, sections) {
  assertAdmin_(callerEmail);
  if (!Array.isArray(sections)) throw new Error('Invalid Rate Card data.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(RATE_CARD_OVERRIDE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(RATE_CARD_OVERRIDE_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, RATE_CARD_OVERRIDE_HEADERS.length).setValues([RATE_CARD_OVERRIDE_HEADERS]);
    if (sections.length) {
      sheet.getRange(2, 1, 1, RATE_CARD_OVERRIDE_HEADERS.length).setValues([[new Date(), callerEmail, JSON.stringify(sections)]]);
    }
    return { ok: true, savedAt: new Date().toISOString(), count: sections.length };
  } finally {
    lock.releaseLock();
  }
}

const AMC_CONFIG_SHEET_NAME = 'AMC_Pricing_Admin';
const AMC_CONFIG_HEADERS = ['Updated At', 'Updated By', 'ConfigJSON'];

function getAmcPricingConfig(email, token) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, exists: false, config: null, error: 'Not signed in.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(AMC_CONFIG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, config: null };
  const row = sheet.getRange(sheet.getLastRow(), 1, 1, AMC_CONFIG_HEADERS.length).getValues()[0];
  try {
    const config = JSON.parse(String(row[2] || ''));
    const updatedAt = row[0] instanceof Date ? row[0].toISOString() : String(row[0] || '');
    return { exists: !!config && typeof config === 'object' && !Array.isArray(config), config: config || null, updatedAt: updatedAt, updatedBy: String(row[1] || '') };
  } catch (e) {
    return { exists: false, config: null };
  }
}

function validateAmcPricingConfig_(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid AMC pricing configuration.');
  const percentages = ['basicPct', 'standardPct', 'premiumPct', 'riskUplift', 'overhead', 'profitMarkup', 'standardPartsReserve', 'premiumPartsReserve'];
  percentages.forEach(function (key) {
    if (typeof config[key] !== 'number' || config[key] < 0 || config[key] > 1) throw new Error('AMC percentage values must be between 0 and 1.');
  });
  const nonNegative = ['handledPerVisit', 'transportPerVisit', 'salary', 'technicians', 'workingDays', 'hoursPerDay', 'visitHours', 'standardVisits', 'premiumVisits'];
  nonNegative.forEach(function (key) {
    if (typeof config[key] !== 'number' || config[key] < 0) throw new Error('AMC operating values must be zero or greater.');
  });
  if (!Array.isArray(config.basicVisitTiers) || !config.basicVisitTiers.length) throw new Error('AMC reactive visit tiers are required.');
  let previousMin = 0;
  config.basicVisitTiers.forEach(function (tier) {
    if (!tier || !Number.isInteger(Number(tier[0])) || !Number.isInteger(Number(tier[1])) || Number(tier[0]) < 1 || Number(tier[1]) < 0 || Number(tier[0]) <= previousMin) throw new Error('AMC reactive visit tiers must be ordered positive integers.');
    previousMin = Number(tier[0]);
  });
  if (!Array.isArray(config.appliances) || !config.appliances.length) throw new Error('At least one AMC appliance is required.');
  const names = {};
  config.appliances.forEach(function (item) {
    const name = String(item && item.name || '').trim().toLowerCase();
    if (!name || names[name] || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 0 || typeof item.active !== 'boolean' || typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) throw new Error('AMC appliances must have unique names and valid defaults.');
    names[name] = true;
  });
  return config;
}

function adminSaveAmcPricingConfig(callerEmail, callerToken, config) {
  const session = validateSession(callerEmail, callerToken);
  if (!session || !session.ok || session.user.role !== 'admin') throw new Error('Admin access required.');
  validateAmcPricingConfig_(config);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(AMC_CONFIG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(AMC_CONFIG_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, AMC_CONFIG_HEADERS.length).setValues([AMC_CONFIG_HEADERS]);
    sheet.getRange(2, 1, 1, AMC_CONFIG_HEADERS.length).setValues([[new Date(), callerEmail, JSON.stringify(config)]]);
    return { ok: true, savedAt: new Date().toISOString(), savedBy: callerEmail };
  } finally {
    lock.releaseLock();
  }
}

function adminResetAmcPricingConfig(callerEmail, callerToken) {
  const session = validateSession(callerEmail, callerToken);
  if (!session || !session.ok || session.user.role !== 'admin') throw new Error('Admin access required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AMC_CONFIG_SHEET_NAME);
    if (sheet) sheet.clear();
    return { ok: true, resetAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

const DANDI_CONFIG_SHEET_NAME = 'DandI_Pricing_Admin';
const DANDI_CONFIG_HEADERS = ['Updated At', 'Updated By', 'ConfigJSON'];

function getDandiPricingConfigOverride() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DANDI_CONFIG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { exists: false, config: null };
  const row = sheet.getRange(sheet.getLastRow(), 1, 1, DANDI_CONFIG_HEADERS.length).getValues()[0];
  try {
    const config = JSON.parse(String(row[2] || ''));
    return { exists: !!config && typeof config === 'object', config: config || null, updatedAt: row[0], updatedBy: row[1] };
  } catch (e) {
    return { exists: false, config: null };
  }
}

function adminSaveDandiPricingConfig(callerEmail, config) {
  assertAdmin_(callerEmail);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid D+I pricing configuration.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(DANDI_CONFIG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(DANDI_CONFIG_SHEET_NAME);
      sheet.setFrozenRows(1);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, DANDI_CONFIG_HEADERS.length).setValues([DANDI_CONFIG_HEADERS]);
    sheet.getRange(2, 1, 1, DANDI_CONFIG_HEADERS.length).setValues([[new Date(), callerEmail, JSON.stringify(config)]]);
    return { ok: true, savedAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function adminResetDandiPricingConfig(callerEmail) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DANDI_CONFIG_SHEET_NAME);
    if (sheet) sheet.clear();
    return { ok: true, resetAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateStockFolder_() {
  const it = DriveApp.getFoldersByName(STOCK_EXCEL_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(STOCK_EXCEL_FOLDER_NAME);
}

function adminUploadStockExcel(callerEmail, base64Data, filename) {
  assertAdmin_(callerEmail);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = getOrCreateStockFolder_();
    const existing = folder.getFilesByName(STOCK_EXCEL_FILENAME);
    while (existing.hasNext()) existing.next().setTrashed(true);
    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', STOCK_EXCEL_FILENAME);
    const file = folder.createFile(blob);
    const props = PropertiesService.getScriptProperties();
    props.setProperty('STOCK_EXCEL_FILE_ID', file.getId());
    props.setProperty('STOCK_EXCEL_UPLOADED_AT', new Date().toISOString());
    props.setProperty('STOCK_EXCEL_UPLOADED_BY', callerEmail);
    props.setProperty('STOCK_EXCEL_ORIGINAL_NAME', filename || STOCK_EXCEL_FILENAME);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getStockExcelInfo() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('STOCK_EXCEL_FILE_ID');
  if (!id) return { exists: false };
  return {
    exists: true,
    uploadedAt: props.getProperty('STOCK_EXCEL_UPLOADED_AT') || '',
    uploadedBy: props.getProperty('STOCK_EXCEL_UPLOADED_BY') || '',
    originalName: props.getProperty('STOCK_EXCEL_ORIGINAL_NAME') || STOCK_EXCEL_FILENAME
  };
}

function getStockExcelData(email, token) {
  const session = validateSession(email, token);
  if (!session || !session.ok) return { ok: false, error: 'Not signed in.' };
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('STOCK_EXCEL_FILE_ID');
  if (!id) return { ok: false, error: 'No stock report has been uploaded yet.' };
  try {
    const file = DriveApp.getFileById(id);
    return {
      ok: true,
      base64: Utilities.base64Encode(file.getBlob().getBytes()),
      filename: props.getProperty('STOCK_EXCEL_ORIGINAL_NAME') || STOCK_EXCEL_FILENAME
    };
  } catch (e) {
    return { ok: false, error: 'Could not read the stock report: ' + e.message };
  }
}

// Job Card receipt evidence is stored in a dedicated Drive folder. The
// record itself keeps only file metadata and links inside DataJSON.
const JOB_CARD_ATTACHMENTS_FOLDER = 'Service Portal - Job Card Attachments';
const JOB_CARD_MAX_ATTACHMENTS = 5;
const JOB_CARD_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function uploadJobCardAttachments(email, token, jobCardRef, attachments) {
  const session = validateSession(email, token);
  if (!session || !session.ok) throw new Error('Not signed in.');
  if (!Array.isArray(attachments) || attachments.length > JOB_CARD_MAX_ATTACHMENTS) {
    throw new Error('A maximum of 5 attachments is allowed per job card.');
  }
  const it = DriveApp.getFoldersByName(JOB_CARD_ATTACHMENTS_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(JOB_CARD_ATTACHMENTS_FOLDER);
  return attachments.map(function (attachment) {
    const name = String(attachment && attachment.name || '').trim();
    const base64 = String(attachment && attachment.base64 || '');
    if (!name || !base64) throw new Error('Invalid attachment.');
    const bytes = Utilities.base64Decode(base64);
    if (bytes.length > JOB_CARD_MAX_ATTACHMENT_BYTES) throw new Error('Each attachment must be 10 MB or smaller.');
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const file = folder.createFile(Utilities.newBlob(bytes, attachment.type || 'application/octet-stream', safeName));
    file.setDescription('Job Card receipt evidence: ' + String(jobCardRef || 'pending'));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {name: safeName, type: attachment.type || 'application/octet-stream', size: bytes.length, fileId: file.getId(), url: file.getUrl()};
  });
}