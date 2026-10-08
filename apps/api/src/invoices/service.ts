import type { Pool } from 'pg';
import { invoiceSummary, listJobInvoices } from '../../../../packages/db/src/invoices.js';
import {
  insertBillingRule,
  listBillingRules,
  updateBillingRule,
} from '../../../../packages/db/src/billing-rules.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { billingRuleWriteSchema } from '../../../../packages/contracts/src/index.js';
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
    public readonly code: 'not-found',
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
      ['Job Card', 'jobCardReference'],
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

  return { list, summary, rules, createRule, updateRule, ledger, exportLedger };
}

export type InvoiceService = ReturnType<typeof createInvoiceService>;
