import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { queryReportRows } from '../../../../packages/db/src/reports.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import {
  REPORT_DEFINITIONS,
  findReportDefinition,
  type ReportColumn,
  type ReportDefinition,
} from './definitions.js';

export class ReportServiceError extends Error {
  constructor(
    public readonly code: 'unknown-report' | 'forbidden-report' | 'invalid-range' | 'no-rows',
    message: string,
  ) {
    super(message);
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date.');

export const reportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

const EXPORT_ROW_LIMIT = 50000;

function selectSql(columns: ReportColumn[]): string {
  return columns
    .map((column, index) => {
      const alias = `"c${index}"`;
      switch (column.kind) {
        case 'date':
          return `to_char(${column.expr}, 'YYYY-MM-DD') AS ${alias}`;
        case 'datetime':
          return `to_char(${column.expr} AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') AS ${alias}`;
        case 'money':
        case 'number':
          return `${column.expr}::float8 AS ${alias}`;
        case 'json':
          return `${column.expr}::text AS ${alias}`;
        default:
          return `${column.expr} AS ${alias}`;
      }
    })
    .join(', ');
}

// Flattens the jsonb payloads (products, parts, line items, appliances) into
// one readable cell: "name: X, qty: 2; name: Y, qty: 1".
function flattenJson(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  const scalar = (value: unknown): string =>
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const item = (value: unknown): string =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
          .map(([key, entry]) => `${key}: ${scalar(entry)}`)
          .join(', ')
      : scalar(value);
  return Array.isArray(parsed) ? parsed.map(item).filter(Boolean).join('; ') : item(parsed);
}

function cell(column: ReportColumn, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (column.kind === 'json') return flattenJson(value);
  if ((column.kind === 'money' || column.kind === 'number') && typeof value === 'number') {
    return value;
  }
  return String(value);
}

export function createReportService(pool: Pool) {
  function listTypes(permissions: readonly string[]) {
    const all = permissions.includes('*');
    return REPORT_DEFINITIONS.filter(
      (definition) => all || permissions.includes(definition.permission),
    ).map((definition) => ({
      type: definition.type,
      label: definition.label,
      description: definition.description,
      dateLabel: definition.dateLabel,
      columns: definition.columns.map((column) => column.label),
    }));
  }

  function definitionFor(type: string, permissions: readonly string[]): ReportDefinition {
    const definition = findReportDefinition(type);
    if (!definition) throw new ReportServiceError('unknown-report', 'Unknown report type.');
    if (!permissions.includes('*') && !permissions.includes(definition.permission)) {
      throw new ReportServiceError(
        'forbidden-report',
        'Your role cannot download this kind of record.',
      );
    }
    return definition;
  }

  function checkRange(from?: string, to?: string) {
    if (from && to && to < from) {
      throw new ReportServiceError(
        'invalid-range',
        'The To date must be on or after the From date.',
      );
    }
  }

  async function query(
    definition: ReportDefinition,
    filters: { from?: string; to?: string; search?: string },
    paging: { limit: number; offset: number },
  ) {
    const client = await pool.connect();
    try {
      return await queryReportRows(
        client,
        {
          selectSql: selectSql(definition.columns),
          fromSql: definition.from,
          dateExpr: definition.dateExpr,
          searchExprs: definition.searchExprs,
          orderBy: definition.orderBy,
        },
        filters,
        paging,
      );
    } finally {
      client.release();
    }
  }

  async function preview(type: string, rawQuery: unknown, permissions: readonly string[]) {
    const definition = definitionFor(type, permissions);
    const params = reportQuerySchema.parse(rawQuery);
    checkRange(params.from, params.to);
    const { rows, total } = await query(
      definition,
      { from: params.from, to: params.to, search: params.search },
      { limit: params.pageSize, offset: (params.page - 1) * params.pageSize },
    );
    return {
      type: definition.type,
      label: definition.label,
      dateLabel: definition.dateLabel,
      columns: definition.columns.map((column) => ({
        label: column.label,
        kind: column.kind ?? 'text',
      })),
      rows: rows.map((row) =>
        definition.columns.map((column, index) => cell(column, row[`c${index}`])),
      ),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async function exportWorkbook(
    type: string,
    rawQuery: unknown,
    permissions: readonly string[],
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const definition = definitionFor(type, permissions);
    const params = reportQuerySchema.parse(rawQuery);
    checkRange(params.from, params.to);
    const { rows, total } = await query(
      definition,
      { from: params.from, to: params.to, search: params.search },
      { limit: EXPORT_ROW_LIMIT, offset: 0 },
    );
    if (rows.length === 0) {
      throw new ReportServiceError(
        'no-rows',
        'No records found for the selected report and date range.',
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Jacky's Service Portal";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(definition.label.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31));
    sheet.columns = definition.columns.map((column) => ({
      header: column.label,
      width: Math.min(Math.max(column.label.length + 4, 14), 60),
    }));
    for (const row of rows) {
      sheet.addRow(definition.columns.map((column, index) => cell(column, row[`c${index}`])));
    }
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 28;
    definition.columns.forEach((column, index) => {
      if (column.kind === 'money') sheet.getColumn(index + 1).numFmt = '#,##0.00';
      if (column.kind === 'json')
        sheet.getColumn(index + 1).alignment = { wrapText: true, vertical: 'top' };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: definition.columns.length },
    };

    const rangeLabel =
      params.from || params.to ? `${params.from ?? 'start'}_to_${params.to ?? 'today'}` : 'All';
    const fileName = `Report_${definition.label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_${rangeLabel}.xlsx`;

    await withTransaction(pool, async (client) => {
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'report.exported',
        targetType: 'report',
        metadata: {
          report: definition.label,
          reportType: definition.type,
          from: params.from ?? null,
          to: params.to ?? null,
          search: params.search ?? null,
          rows: rows.length,
          totalMatching: total,
          fileName,
        },
        requestId,
      });
    });

    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName, rows: rows.length };
  }

  return { listTypes, preview, exportWorkbook };
}

export type ReportService = ReturnType<typeof createReportService>;
