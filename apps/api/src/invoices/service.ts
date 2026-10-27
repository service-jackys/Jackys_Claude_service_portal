import type { Pool } from 'pg';
import { invoiceSummary, listJobInvoices } from '../../../../packages/db/src/invoices.js';
import {
  insertBillingRule,
  listBillingRules,
  updateBillingRule,
} from '../../../../packages/db/src/billing-rules.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import {
  billingRuleWriteSchema,
  taxInvoiceIssueSchema,
  taxInvoiceUpdateSchema,
} from '../../../../packages/contracts/src/index.js';
import { findServiceJobCardById } from '../../../../packages/db/src/job-cards.js';
import { saveInvoiceRecord, saveIssuedInvoice } from '../../../../packages/db/src/invoices.js';
import { allocateTaxInvoiceReference } from '../../../../packages/db/src/references.js';
import { billedAmount, deliveryBlockReason, gateInvoiceNo } from '../job-cards/billing.js';
import { amountInWords, buildInvoiceLines, invoiceTotals } from './tax-invoice.js';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  BILLING_STAGES,
  billToParties,
  billingTotals,
  channelStatement,
  costAllocation,
  queryBillingLedger,
  type BillingLedgerQuery,
} from '../../../../packages/db/src/billing-ledger.js';

export class InvoiceServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'blocked',
    message: string,
  ) {
    super(message);
  }
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const isoDay = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

function ledgerQuery(query: Record<string, unknown>): BillingLedgerQuery {
  return {
    from: isoDay(query.from),
    to: isoDay(query.to),
    type: text(query.type),
    payer: text(query.payer),
    billTo: text(query.billTo),
    stage: text(query.stage),
    search: text(query.search),
  };
}

type JobRecord = NonNullable<Awaited<ReturnType<typeof findServiceJobCardById>>>;

/** Today's date in the business time zone (Dubai), as YYYY-MM-DD. */
function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Dubai',
  }).format(new Date());
}

function jobAmount(job: JobRecord): number {
  return billedAmount({
    amountChargeable: job.amountChargeable === null ? null : Number(job.amountChargeable),
    grandTotal: Number(job.grandTotal),
  });
}

/** What the invoice shows. Built from the job at the moment of issue and then frozen. */
function buildSnapshot(
  job: JobRecord,
  extra: {
    invoiceNo: string | null;
    invoiceDate: string;
    customerTrn: string | null;
    remarks: string | null;
  },
) {
  const lines = buildInvoiceLines({
    itemDescription: job.itemDescription,
    modelNo: job.modelNo,
    serviceCharge: Number(job.serviceCharge) || 0,
    parts: job.parts,
    amount: jobAmount(job),
  });
  const channelBilled = job.paymentBy === 'Sales channel';
  return {
    invoiceNo: extra.invoiceNo,
    invoiceDate: extra.invoiceDate,
    dueDate: extra.invoiceDate,
    currency: 'AED',
    customerName: (channelBilled ? job.billToChannel : null) || job.customerName || '-',
    customerCode: job.customerNumber,
    customerTrn: extra.customerTrn,
    customerType: job.customerType,
    billedToChannel: channelBilled,
    contact: job.customerContact,
    address: job.customerAddress,
    jobCardReference: job.jobCardReference,
    salesman: job.salesman,
    paymentTerm: channelBilled ? 'ON ACCOUNT' : 'CASH IN ADVANCE',
    itemDescription: job.itemDescription,
    modelNo: job.modelNo,
    serialNo: job.serialNo,
    deliveryDate: job.deliveryDate,
    remarks:
      extra.remarks ??
      [
        job.jobCardReference,
        job.itemDescription,
        job.modelNo,
        job.serialNo && `S/N ${job.serialNo}`,
      ]
        .filter(Boolean)
        .join(' | '),
    lines,
    totals: invoiceTotals(lines),
    amountInWords: amountInWords(invoiceTotals(lines).gross),
  };
}

export function createInvoiceService(pool: Pool) {
  async function ledger(query: Record<string, unknown>) {
    const filters = ledgerQuery(query);
    const page = Number(query.page ?? 1) || 1;
    const pageSize = Number(query.pageSize ?? 50) || 50;
    const client = await pool.connect();
    try {
      const [list, totals, statement, allocation, parties] = await Promise.all([
        queryBillingLedger(client, filters, { page, pageSize }),
        billingTotals(client, filters),
        channelStatement(client, filters),
        costAllocation(client, filters),
        billToParties(client),
      ]);
      return {
        rows: list.rows,
        total: list.total,
        page,
        pageSize,
        totals,
        statement,
        allocation,
        billToOptions: parties,
        stages: BILLING_STAGES,
      };
    } finally {
      client.release();
    }
  }

  async function exportLedger(
    query: Record<string, unknown>,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const filters = ledgerQuery(query);
    const client = await pool.connect();
    let data;
    try {
      const [list, totals, statement, allocation] = await Promise.all([
        queryBillingLedger(client, filters),
        billingTotals(client, filters),
        channelStatement(client, filters),
        costAllocation(client, filters),
      ]);
      data = { rows: list.rows, totals, statement, allocation };
    } finally {
      client.release();
    }
    if (data.rows.length === 0) {
      throw new InvoiceServiceError('not-found', 'No billed jobs match these filters.');
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Jacky's Service Portal";
    workbook.created = new Date();
    const style = (sheet: ExcelJS.Worksheet, moneyCols: number[]) => {
      const header = sheet.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
      header.alignment = { vertical: 'middle', wrapText: true };
      header.height = 28;
      moneyCols.forEach((c) => (sheet.getColumn(c).numFmt = '#,##0.00'));
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    };

    const ledgerCols: [string, keyof (typeof data.rows)[number], boolean?][] = [
      ['Job Card / D&I Job', 'jobCardReference'],
      ['Source', 'source'],
      ['Job Card Date', 'jobCardDate'],
      ['Delivery Date', 'deliveryDate'],
      ['Job Type', 'billingJobType'],
      ['Registered Warranty', 'registeredWarranty'],
      ['Final Warranty', 'finalWarranty'],
      ['Warranty Change Reason', 'warrantyChangeReason'],
      ['Payment By', 'payer'],
      ['Bill To', 'billTo'],
      ['Customer', 'customerName'],
      ['Customer Type', 'customerType'],
      ['B2B Branch / School', 'b2bBranchSchool'],
      ['Salesman', 'salesman'],
      ['Sales Channel', 'salesChannel'],
      ['Region', 'region'],
      ['Sales Order No', 'salesOrderNumber'],
      ['Item Code', 'itemCode'],
      ['Brand', 'brand'],
      ['Main Group', 'mainGroup'],
      ['Group', 'groupName'],
      ['Sub Group', 'subGroup'],
      ['Model No', 'modelNo'],
      ['Serial No', 'serialNo'],
      ['Technician', 'technicianName'],
      ['Service Charge (AED)', 'serviceCharge', true],
      ['Parts (AED)', 'partsCost', true],
      ['Grand Total (AED)', 'grandTotal', true],
      ['Adjustment (AED)', 'adjustment', true],
      ['Billed Amount (AED)', 'billedAmount', true],
      ['ERP Invoice No', 'invoiceNo'],
      ['Invoice Date', 'invoiceDate'],
      ['Payment Mode', 'paymentMode'],
      ['Payment Reference', 'paymentReference'],
      ['Billing Stage', 'stage'],
      ['Job Status', 'jobFinalStatus'],
    ];
    const sheet = workbook.addWorksheet('Billing ledger');
    sheet.columns = ledgerCols.map(([label]) => ({
      header: label,
      width: Math.max(label.length + 4, 14),
    }));
    for (const row of data.rows) {
      sheet.addRow(ledgerCols.map(([, key]) => (row[key] as string | number | null) ?? ''));
    }
    const total = sheet.addRow(
      ledgerCols.map(([label, key]) => {
        if (label === 'Job Card') return 'TOTAL';
        const money = ['serviceCharge', 'partsCost', 'adjustment', 'billedAmount'];
        if (money.includes(key as string))
          return data.totals[key as 'serviceCharge' | 'partsCost' | 'adjustment' | 'billedAmount'];
        if (key === 'grandTotal') return data.totals.serviceCharge + data.totals.partsCost;
        return '';
      }),
    );
    total.font = { bold: true };
    style(sheet, ledgerCols.map(([, , m], i) => (m ? i + 1 : 0)).filter(Boolean));

    const statementSheet = workbook.addWorksheet('Bill-to statement');
    statementSheet.columns = [
      'Bill To',
      'Jobs',
      'Warranty CSIJW (AED)',
      'Non-warranty CSIJO (AED)',
      'Billed (AED)',
      'Invoiced (AED)',
      'Not invoiced (AED)',
      'Paid (AED)',
    ].map((header) => ({ header, width: 24 }));
    for (const r of data.statement) {
      statementSheet.addRow([
        r.billTo,
        r.jobs,
        r.warrantyAmount,
        r.nonWarrantyAmount,
        r.billedAmount,
        r.invoicedAmount,
        r.notInvoicedAmount,
        r.paidAmount,
      ]);
    }
    style(statementSheet, [3, 4, 5, 6, 7, 8]);

    const allocationSheet = workbook.addWorksheet('Cost allocation');
    allocationSheet.columns = [
      'Brand',
      'Main Group',
      'Group',
      'Jobs',
      'Service Charge (AED)',
      'Parts (AED)',
      'Billed (AED)',
    ].map((header) => ({ header, width: 24 }));
    for (const r of data.allocation) {
      allocationSheet.addRow([
        r.brand,
        r.mainGroup,
        r.groupName,
        r.jobs,
        r.serviceCharge,
        r.partsCost,
        r.billedAmount,
      ]);
    }
    style(allocationSheet, [5, 6, 7]);

    const label =
      filters.from || filters.to ? `${filters.from ?? 'start'}_to_${filters.to ?? 'today'}` : 'All';
    const fileName = `Billing_${label}.xlsx`;
    await withTransaction(pool, async (client) => {
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'report.exported',
        targetType: 'report',
        metadata: {
          report: 'Billing ledger',
          reportType: 'billing-ledger',
          ...filters,
          rows: data.rows.length,
          fileName,
        },
        requestId,
      });
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName,
      rows: data.rows.length,
    };
  }

  async function list(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return await listJobInvoices(client, {
        type: text(query.type),
        paymentBy: text(query.paymentBy),
        paymentStatus: text(query.paymentStatus),
        search: text(query.search),
        page: Number(query.page ?? 1) || 1,
        pageSize: Number(query.pageSize ?? 50) || 50,
      });
    } finally {
      client.release();
    }
  }

  async function summary() {
    const client = await pool.connect();
    try {
      return await invoiceSummary(client);
    } finally {
      client.release();
    }
  }

  async function rules() {
    const client = await pool.connect();
    try {
      return await listBillingRules(client);
    } finally {
      client.release();
    }
  }

  async function createRule(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = billingRuleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const rule = await insertBillingRule(client, data);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'billing_rule.created',
        targetType: 'billing_rule',
        targetId: rule.id,
        metadata: { billToChannel: rule.billToChannel },
        requestId,
      });
      return rule;
    });
  }

  async function updateRule(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = billingRuleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const rule = await updateBillingRule(client, id, data);
      if (!rule) throw new InvoiceServiceError('not-found', 'The billing rule was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'billing_rule.updated',
        targetType: 'billing_rule',
        targetId: rule.id,
        metadata: { billToChannel: rule.billToChannel, active: rule.active },
        requestId,
      });
      return rule;
    });
  }

  function presentInvoice(job: JobRecord) {
    const amount = jobAmount(job);
    const stored = job.invoiceSnapshot as ReturnType<typeof buildSnapshot> | null;
    const issued = Boolean(job.portalInvoiceNo && stored);
    const preview =
      issued && stored
        ? stored
        : buildSnapshot(job, {
            invoiceNo: null,
            invoiceDate: businessToday(),
            customerTrn: job.customerTrn,
            remarks: null,
          });
    return {
      job: {
        id: job.id,
        jobCardReference: job.jobCardReference,
        jobFinalStatus: job.jobFinalStatus,
        customerName: job.customerName,
        customerType: job.customerType,
        billingJobType: job.billingJobType,
        paymentBy: job.paymentBy,
        billToChannel: job.billToChannel,
        amount,
        deliveryDate: job.deliveryDate,
      },
      issued,
      // The job amount changed after the invoice was issued.
      stale: issued && stored ? Math.abs(stored.totals.gross - amount) >= 0.01 : false,
      invoice: preview,
      erpReference: job.invoiceNo,
      customerTrn: job.customerTrn,
      portalInvoiceNo: job.portalInvoiceNo,
      portalInvoiceIssuedAt: job.portalInvoiceIssuedAt,
      paymentMode: job.paymentMode,
      paymentReference: job.paymentReference,
      paymentConfirmedAt: job.paymentConfirmedAt,
      deliveryBlockReason: deliveryBlockReason({
        amount,
        billingJobType: job.billingJobType,
        paymentBy: job.paymentBy,
        invoiceNo: gateInvoiceNo(job),
        paymentConfirmed: Boolean(job.paymentConfirmedAt),
      }),
    };
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const job = await findServiceJobCardById(client, id);
      if (!job) throw new InvoiceServiceError('not-found', 'The service job card was not found.');
      return presentInvoice(job);
    } finally {
      client.release();
    }
  }

  async function issue(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = taxInvoiceIssueSchema.parse(input ?? {});
    return withTransaction(pool, async (client) => {
      const job = await findServiceJobCardById(client, id, true);
      if (!job) throw new InvoiceServiceError('not-found', 'The service job card was not found.');
      if (job.portalInvoiceNo) {
        throw new InvoiceServiceError(
          'blocked',
          `Invoice ${job.portalInvoiceNo} was already issued for this job.`,
        );
      }
      if (job.jobFinalStatus === 'Cancelled') {
        throw new InvoiceServiceError('blocked', 'A cancelled job cannot be invoiced.');
      }
      if (job.jobFinalStatus === 'Customer approval pending') {
        throw new InvoiceServiceError(
          'blocked',
          'The customer has not approved this job yet. Invoice it after the approval.',
        );
      }
      if (!(jobAmount(job) > 0)) {
        throw new InvoiceServiceError(
          'blocked',
          'This job has no amount to invoice (internal billing).',
        );
      }
      if (job.billingJobType === 'CSIJO' && !job.paymentBy) {
        throw new InvoiceServiceError(
          'blocked',
          'Choose who pays (Payment by) on the service job card before invoicing.',
        );
      }
      const invoiceDate = data.invoiceDate ?? businessToday();
      const portalInvoiceNo = await allocateTaxInvoiceReference(client, invoiceDate);
      const customerTrn = data.customerTrn || job.customerTrn || null;
      const snapshot = buildSnapshot(job, {
        invoiceNo: portalInvoiceNo,
        invoiceDate,
        customerTrn,
        remarks: data.remarks ?? null,
      });
      await saveIssuedInvoice(client, job.id, {
        portalInvoiceNo,
        invoiceDate,
        customerTrn,
        erpReference: data.erpReference ?? null,
        snapshot,
        issuedBy: profileId,
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'tax_invoice.issued',
        targetType: 'service_job_card',
        targetId: job.id,
        metadata: { portalInvoiceNo, amount: snapshot.totals.gross },
        requestId,
      });
      return presentInvoice((await findServiceJobCardById(client, job.id)) ?? job);
    });
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = taxInvoiceUpdateSchema.parse(input ?? {});
    return withTransaction(pool, async (client) => {
      const job = await findServiceJobCardById(client, id, true);
      if (!job) throw new InvoiceServiceError('not-found', 'The service job card was not found.');
      const stored = job.invoiceSnapshot as ReturnType<typeof buildSnapshot> | null;
      const issued = Boolean(job.portalInvoiceNo && stored);
      if (data.paymentConfirmed === true) {
        if (job.paymentBy !== 'Customer') {
          throw new InvoiceServiceError(
            'blocked',
            'Only a job paid by the customer needs a payment confirmation.',
          );
        }
        if (!issued) {
          throw new InvoiceServiceError(
            'blocked',
            'Issue the tax invoice before confirming the payment.',
          );
        }
        if (!(data.paymentMode ?? job.paymentMode)) {
          throw new InvoiceServiceError(
            'blocked',
            'Select the payment mode (cash, online, bank transfer or card) before confirming the payment.',
          );
        }
      }
      let snapshot: unknown;
      if (issued && stored && (data.customerTrn !== undefined || data.remarks !== undefined)) {
        snapshot = {
          ...stored,
          ...(data.customerTrn !== undefined ? { customerTrn: data.customerTrn || null } : {}),
          ...(data.remarks !== undefined && data.remarks ? { remarks: data.remarks } : {}),
        };
      }
      await saveInvoiceRecord(client, job.id, {
        customerTrn: data.customerTrn === undefined ? undefined : data.customerTrn || null,
        erpReference: data.erpReference === undefined ? undefined : data.erpReference || null,
        snapshot,
        paymentMode: data.paymentMode,
        paymentReference:
          data.paymentReference === undefined ? undefined : data.paymentReference || null,
        paymentConfirmed: data.paymentConfirmed,
        profileId,
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'tax_invoice.updated',
        targetType: 'service_job_card',
        targetId: job.id,
        metadata: {
          portalInvoiceNo: job.portalInvoiceNo,
          paymentConfirmed: data.paymentConfirmed ?? null,
        },
        requestId,
      });
      return presentInvoice((await findServiceJobCardById(client, job.id)) ?? job);
    });
  }

  return {
    list,
    summary,
    rules,
    createRule,
    updateRule,
    ledger,
    exportLedger,
    detail,
    issue,
    update,
  };
}

export type InvoiceService = ReturnType<typeof createInvoiceService>;
