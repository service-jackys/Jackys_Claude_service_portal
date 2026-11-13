import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  quotationWriteSchema,
  quotationListQuerySchema,
  quotationReportQuerySchema,
  computeQuotationTotals,
  type QuotationWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findQuotationById,
  insertQuotation,
  listQuotationMonths,
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
    erpInvoiceNo: '',
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
    erpInvoiceNo: (input.erpInvoiceNo ?? base.erpInvoiceNo ?? '').trim(),
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
  // An Invoiced quotation needs the ERP / ORION invoice number so it can be checked against the
  // master workbook. A quotation already Invoiced before this rule (blank number) may be edited
  // without one; clearing the status clears the number.
  const legacyInvoiced = base.erpStatus === 'Invoiced' && !base.erpInvoiceNo;
  if (merged.erpStatus !== 'Invoiced') merged.erpInvoiceNo = '';
  else if (!merged.erpInvoiceNo && !legacyInvoiced) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['erpInvoiceNo'],
        message: 'The ERP / ORION invoice number is required when the status is Invoiced.',
      },
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
        erpInvoiceNo: current.erpInvoiceNo,
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
        month: data.month,
        page: data.page,
        pageSize: data.pageSize,
      });
    } finally {
      client.release();
    }
  }

  async function months() {
    const client = await pool.connect();
    try {
      return listQuotationMonths(client);
    } finally {
      client.release();
    }
  }

  /** Management report: every quotation in the chosen month (or all), as a formatted Excel workbook. */
  async function exportReport(query: Record<string, unknown>) {
    const data = quotationReportQuerySchema.parse(query);
    const client = await pool.connect();
    let result;
    try {
      result = await listQuotations(client, { ...data, page: 1, pageSize: 100000 });
    } finally {
      client.release();
    }
    // Oldest first reads better in a report than most recently edited first.
    const rows = [...result.items].sort((a, b) =>
      `${a.quotationDate ?? ''}${a.quotationReference}`.localeCompare(
        `${b.quotationDate ?? ''}${b.quotationReference}`,
      ),
    );
    const money = '#,##0.00';
    const navy = 'FF1F3A5F';
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Jacky's Service Portal";
    workbook.created = new Date();
    const fillOf = (argb: string) => ({
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb },
    });
    const n = rows.length;

    // The Summary tab comes first; its formulas point at the Quotations tab added next.
    const summary = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    const sheet = workbook.addWorksheet('Quotations');
    const columns: [string, number, (q: (typeof rows)[number]) => unknown, boolean?][] = [
      ['Reference', 18, (q) => q.quotationReference],
      ['Quotation date', 15, (q) => q.quotationDate],
      ['Customer', 40, (q) => q.customerName],
      ['Contact', 18, (q) => q.contactNumber],
      ['Type', 16, (q) => q.customerType],
      ['Units', 8, (q) => q.unitCount],
      ['Subtotal (AED)', 16, (q) => Number(q.subtotalAmount), true],
      ['VAT (AED)', 14, (q) => Number(q.vatAmount), true],
      ['Total incl. VAT (AED)', 20, (q) => Number(q.grandTotal), true],
      ['Status', 14, (q) => q.quotationStatus],
      ['ERP / ORION', 16, (q) => q.erpStatus],
      ['ORION Ref', 18, (q) => q.erpInvoiceNo ?? ''],
    ];
    sheet.columns = columns.map(([header, width]) => ({ header, width }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = fillOf(navy);
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 30;
    const hair = { style: 'hair' as const, color: { argb: 'FFCBD5E1' } };
    rows.forEach((q, i) => {
      const row = sheet.addRow(columns.map(([, , get]) => get(q)));
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { bottom: hair };
        if (i % 2 === 1) cell.fill = fillOf('FFF4F7FB');
      });
    });
    columns.forEach(([h, , , isMoney], i) => {
      const col = sheet.getColumn(i + 1);
      col.alignment = {
        vertical: 'middle',
        horizontal: isMoney || h === 'Units' ? 'right' : 'left',
        indent: 1,
      };
      if (isMoney) col.numFmt = money;
    });
    // The total row uses SUBTOTAL, so it recalculates when the list is filtered in Excel.
    const letter = (name: string) =>
      String.fromCharCode(65 + columns.findIndex(([h]) => h === name));
    const sum = (name: string, value: number) => ({
      formula: `SUBTOTAL(109,${letter(name)}2:${letter(name)}${n + 1})`,
      result: Math.round(value * 100) / 100,
    });
    const totalRow = sheet.addRow(
      columns.map(([h]) =>
        h === 'Reference'
          ? 'Total'
          : h === 'Units'
            ? sum(
                h,
                rows.reduce((t, q) => t + q.unitCount, 0),
              )
            : h === 'Subtotal (AED)'
              ? sum(h, result.totalSubtotal)
              : h === 'VAT (AED)'
                ? sum(h, result.totalAmount - result.totalSubtotal)
                : h === 'Total incl. VAT (AED)'
                  ? sum(h, result.totalAmount)
                  : '',
      ),
    );
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: 'thin' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    // Summary sheet: overall and by quotation status. Formulas read the visible (filtered) rows.
    summary.columns = [{ width: 34 }, { width: 14 }, { width: 20 }, { width: 26 }];
    summary.mergeCells('A1:D1');
    const title = summary.getCell('A1');
    title.value = 'Service Quotations Report';
    title.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = fillOf(navy);
    title.alignment = { vertical: 'middle', indent: 1 };
    summary.getRow(1).height = 34;
    let r = 2;
    const head = (label: string) => {
      ['', 'Quotations', 'Subtotal (AED)', 'Total incl. VAT (AED)'].forEach((c, i) => {
        const cell = summary.getCell(r, i + 1);
        cell.value = i === 0 ? label : c;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = fillOf(navy);
        cell.alignment = { horizontal: i === 0 ? 'left' : 'right' };
      });
      r += 1;
    };
    const last = n + 1;
    const rng = (name: string) => `Quotations!$${letter(name)}$2:$${letter(name)}$${last}`;
    const visible = `SUBTOTAL(103,OFFSET(Quotations!$A$2,ROW(${rng('Reference')})-ROW(Quotations!$A$2),0))`;
    const visibleSum = (name: string) =>
      `SUBTOTAL(109,OFFSET(Quotations!$${letter(name)}$2,ROW(${rng(name)})-ROW(Quotations!$A$2),0))`;
    const line = (
      label: string,
      match: string | null,
      stats: { n: number; sub: number; tot: number },
      bold = false,
    ) => {
      const cond = match === null ? '' : `*(${rng('Status')}="${match}")`;
      const cells: [number, ExcelJS.CellValue][] = [
        [1, label],
        [2, { formula: `SUMPRODUCT(${visible}${cond})`, result: stats.n }],
        [3, { formula: `SUMPRODUCT(${visibleSum('Subtotal (AED)')}${cond})`, result: stats.sub }],
        [
          4,
          {
            formula: `SUMPRODUCT(${visibleSum('Total incl. VAT (AED)')}${cond})`,
            result: stats.tot,
          },
        ],
      ];
      for (const [c, v] of cells) {
        const cell = summary.getCell(r, c);
        cell.value = v;
        if (c > 2) cell.numFmt = money;
        if (bold) cell.font = { bold: true };
      }
      r += 1;
    };
    const stat = (list: typeof rows) => ({
      n: list.length,
      sub: Math.round(list.reduce((t, q) => t + Number(q.subtotalAmount), 0) * 100) / 100,
      tot: Math.round(list.reduce((t, q) => t + Number(q.grandTotal), 0) * 100) / 100,
    });
    head('Overall');
    line('All quotations in this report', null, stat(rows), true);
    r += 1;
    head('By quotation status');
    for (const status of [...new Set(rows.map((q) => q.quotationStatus))].sort()) {
      line(status, status, stat(rows.filter((q) => q.quotationStatus === status)));
    }
    line('Total', null, stat(rows), true);
    summary.getRow(r - 1).border = { top: { style: 'thin' } };
    summary.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1 };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileName = `quotations-report-${data.month ?? 'all-months'}.xlsx`;
    return { buffer, fileName, rows: rows.length };
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

  return { create, update, list, detail, months, exportReport };
}

export type QuotationService = ReturnType<typeof createQuotationService>;
