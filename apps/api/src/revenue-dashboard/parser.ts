import ExcelJS from 'exceljs';
import {
  DEFAULT_PRICING_RULES,
  type PricingMaster,
  type PricingRules,
  type SheetPricing,
} from './pricing-logic.js';

export class WorkbookParseError extends Error {}

export type ParsedRevenueLine = {
  sourceRow: number | null;
  jobType: string;
  description: string | null;
  invDelNo: string | null;
  csoscOrderNo: string | null;
  orderDate: string | null;
  year: number | null;
  weekNo: number | null;
  monthNo: number | null;
  customer: string | null;
  lpoNo: string | null;
  csoscStatus: string | null;
  jobSheetStatus: string | null;
  salesPerson: string | null;
  qty: number;
  unitPrice: number;
  revenue: number;
  originalJobValue: number;
  billingCode: string | null;
  salesChannel: string | null;
  costStatus: string | null;
  remarks: string | null;
  pricing: SheetPricing | null;
};

export type ParsedRevenueWorkbook = {
  lines: ParsedRevenueLine[];
  rates: { jobType: string; description: string; price: number }[];
  pricingRules: PricingRules;
  pricingMatched: number;
  selectedYear: number | null;
  totalRevenue: number;
};

export type ParsedBudgetLine = {
  section: 'volume' | 'revenue' | 'cost' | 'opex' | 'nop' | 'below' | 'np';
  lineItem: string;
  period: string;
  amount: number;
  sortOrder: number;
};

export type ParsedBudgetWorkbook = {
  lines: ParsedBudgetLine[];
  periods: string[];
  totalRevenue: number;
};

// Excel formula cells arrive as { formula, result }; rich text as
// { richText: [...] }; errors as { error }. Collapse all of them to a plain
// JS value -- the cached Excel result is the canonical figure.
function plain(value: ExcelJS.CellValue | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return plain(v.result as ExcelJS.CellValue);
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((part) => part.text).join('');
    }
    if ('text' in v) return v.text;
    if ('error' in v) return null;
    return null;
  }
  return value;
}

function text(value: ExcelJS.CellValue | undefined): string | null {
  const v = plain(value);
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
    .replace(/_x000D_/g, '')
    .replace(/\r/g, '')
    .trim();
  return s === '' ? null : s;
}

function num(value: ExcelJS.CellValue | undefined): number {
  const v = plain(value);
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function intOrNull(value: ExcelJS.CellValue | undefined): number | null {
  const v = plain(value);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isoDate(value: ExcelJS.CellValue | undefined): string | null {
  const v = plain(value);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new WorkbookParseError(
      'The file could not be read as an Excel workbook (.xlsx / .xlsm).',
    );
  }
  return workbook;
}

function headerIndex(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const label = text(cell.value);
    if (label && !map.has(label.toLowerCase())) map.set(label.toLowerCase(), col);
  });
  return map;
}

export async function parseRevenueWorkbook(buffer: Buffer): Promise<ParsedRevenueWorkbook> {
  const workbook = await load(buffer);
  const sheet = workbook.getWorksheet('Revenue Source');
  if (!sheet) {
    throw new WorkbookParseError(
      'This workbook has no "Revenue Source" sheet. Upload the Service Dashboard master (.xlsm).',
    );
  }
  const col = headerIndex(sheet);
  const need = ['job type', 'revenue', 'order date'];
  for (const label of need) {
    if (!col.has(label)) {
      throw new WorkbookParseError(`The "Revenue Source" sheet is missing the "${label}" column.`);
    }
  }
  const at = (row: ExcelJS.Row, label: string) => {
    const c = col.get(label.toLowerCase());
    return c ? row.getCell(c).value : undefined;
  };

  const lines: ParsedRevenueLine[] = [];
  let totalRevenue = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const jobType = text(at(row, 'Job Type'));
    // The sheet is pre-filled with formula rows that evaluate to "" -- a row
    // with no job type is an empty slot, not a transaction.
    if (!jobType) return;
    const revenue = num(at(row, 'Revenue'));
    totalRevenue += revenue;
    lines.push({
      sourceRow: intOrNull(at(row, 'Source Row')),
      jobType: jobType.toUpperCase(),
      description: text(at(row, 'Description')),
      invDelNo: text(at(row, 'Inv/Del No')),
      csoscOrderNo: text(at(row, 'CSOSC Order No')),
      orderDate: isoDate(at(row, 'Order Date')),
      year: intOrNull(at(row, 'Year')),
      weekNo: intOrNull(at(row, 'Week No')),
      monthNo: intOrNull(at(row, 'Month No')),
      customer: text(at(row, 'Customer')),
      lpoNo: text(at(row, 'CSOSC LPO No')),
      csoscStatus: text(at(row, 'CSOSC Status')),
      jobSheetStatus: text(at(row, 'Job Sheet Status')),
      salesPerson: text(at(row, 'Sales Person')),
      qty: num(at(row, 'Qty')),
      unitPrice: num(at(row, 'Proposed Price / Job')),
      revenue,
      originalJobValue: num(at(row, 'Original Job Value')),
      billingCode: text(at(row, 'Billing Code')),
      salesChannel: text(at(row, 'Sales Channel')),
      costStatus: text(at(row, 'Cost Status')),
      remarks: text(at(row, 'Remarks')),
      pricing: null,
    });
  });
  if (!lines.length) {
    throw new WorkbookParseError('The "Revenue Source" sheet has no job rows to import.');
  }

  const rates: ParsedRevenueWorkbook['rates'] = [];
  let selectedYear: number | null = null;
  const calc = workbook.getWorksheet('Calculation');
  if (calc) {
    selectedYear = intOrNull(calc.getRow(5).getCell(6).value);
    for (let r = 6; r <= 20; r += 1) {
      const row = calc.getRow(r);
      const jobType = text(row.getCell(1).value);
      const price = plain(row.getCell(3).value);
      // The rate table is followed by an unrelated month table -- only
      // job-type codes (letters) are rates.
      if (jobType && /^[A-Za-z]{3,6}$/.test(jobType) && typeof price === 'number') {
        rates.push({ jobType, description: text(row.getCell(2).value) ?? '', price });
      }
    }
  }
  const pricingRules = readPricingRules(workbook, rates);
  const pricingMatched = attachSheetPricing(workbook, lines);
  return { lines, rates, pricingRules, pricingMatched, selectedYear, totalRevenue };
}

function nOrNull(value: ExcelJS.CellValue | undefined): number | null {
  const v = plain(value);
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// The pricing masters sit at fixed cells on "Del+Install Pricing" and
// "Install Pricing" (category master J18:M22, discounts B25:E32, transport
// G25:J27, crew factors G31:H34, defaults L25:M31).
function readPricingMaster(sheet: ExcelJS.Worksheet | undefined): PricingMaster | null {
  if (!sheet) return null;
  const cell = (r: number, c: number) => sheet.getRow(r).getCell(c).value;
  const categories: PricingMaster['categories'] = [];
  for (let r = 19; r <= 30; r += 1) {
    const category = text(cell(r, 10));
    if (!category) break;
    categories.push({
      category,
      batchRate: num(cell(r, 11)),
      standardRate: num(cell(r, 12)),
      minimumRate: num(cell(r, 13)),
    });
  }
  const discounts: PricingMaster['discounts'] = [];
  for (let r = 26; r <= 40; r += 1) {
    const minimum = nOrNull(cell(r, 2));
    if (minimum === null) break;
    discounts.push({
      minimum,
      maximum: num(cell(r, 3)),
      tier: text(cell(r, 4)) ?? '',
      discount: num(cell(r, 5)),
    });
  }
  const transport: PricingMaster['transport'] = [];
  for (let r = 26; r <= 29; r += 1) {
    const region = text(cell(r, 7));
    if (region) transport.push({ region, roundTrip: num(cell(r, 10)) });
  }
  const crew: PricingMaster['crew'] = [];
  for (let r = 32; r <= 36; r += 1) {
    const size = nOrNull(cell(r, 7));
    if (size !== null) crew.push({ size, loading: num(cell(r, 8)) });
  }
  if (!categories.length || !discounts.length) return null;
  return {
    categories,
    discounts,
    transport,
    crew,
    defaults: {
      customerGrouping: text(cell(26, 13)) ?? 'Same customer / same site',
      sites: nOrNull(cell(27, 13)) ?? 1,
      crewSize: nOrNull(cell(28, 13)) ?? 2,
      tripThreshold: nOrNull(cell(29, 13)) ?? 20,
      tripsAtOrBelow: nOrNull(cell(30, 13)) ?? 1,
      tripsAbove: nOrNull(cell(31, 13)) ?? 2,
    },
  };
}

function readPricingRules(workbook: ExcelJS.Workbook, rates: PricingRules['rates']): PricingRules {
  const di = readPricingMaster(workbook.getWorksheet('Del+Install Pricing'));
  const install = readPricingMaster(workbook.getWorksheet('Install Pricing'));
  if (!di || !install) {
    return { ...DEFAULT_PRICING_RULES, rates: rates.length ? rates : DEFAULT_PRICING_RULES.rates };
  }
  return {
    source: 'workbook',
    rates: rates.length ? rates : DEFAULT_PRICING_RULES.rates,
    deliveryInstall: di,
    install,
  };
}

// CSIDI sheet = source of every CSIDI / CSIDO / CSIII line. Its pricing
// columns are joined to Revenue Source on Inv/Del No (+ matching job type).
function attachSheetPricing(workbook: ExcelJS.Workbook, lines: ParsedRevenueLine[]): number {
  const sheet = workbook.getWorksheet('CSIDI');
  if (!sheet) return 0;
  const col = headerIndex(sheet);
  if (!col.has('inv/del no') || !col.has('pricing type')) return 0;
  const get = (row: ExcelJS.Row, label: string) => {
    const c = col.get(label.toLowerCase());
    return c ? row.getCell(c).value : undefined;
  };
  const byInvoice = new Map<string, SheetPricing>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const inv = text(get(row, 'Inv/Del No'));
    const pricingType = text(get(row, 'Pricing Type'));
    if (!inv || !pricingType) return;
    byInvoice.set(inv, {
      tranc: text(get(row, 'Tranc')),
      custCode: text(get(row, 'Cust_Code')),
      trnNo: text(get(row, 'TRN_No')),
      currency: text(get(row, 'Cur')),
      location: text(get(row, 'Location')),
      delLoc: text(get(row, 'Del_Loc')),
      rawQty: nOrNull(get(row, 'Qty')),
      value: nOrNull(get(row, 'Value')),
      items: nOrNull(get(row, 'No. of Items')),
      invoiceStatus: text(get(row, 'Status')),
      salesman: text(get(row, 'Salesman')),
      refDocNo: text(get(row, 'Ref DocNo.')),
      refDocDt: text(get(row, 'Ref DocDt.')),
      delDate: text(get(row, 'Del. Date')),
      lpoNo: text(get(row, 'LPO_NO')),
      derivedType: text(get(row, 'Derived Type')),
      calcQty: nOrNull(get(row, 'Calc Qty')),
      originalType: text(get(row, 'Original Type')),
      applianceCategory: text(get(row, 'Appliance Category')),
      categorySource: text(get(row, 'Category Source')),
      pricingType,
      customerGrouping: text(get(row, 'Customer Grouping')),
      sites: nOrNull(get(row, 'Number of Sites')),
      plannedTrips: nOrNull(get(row, 'Planned Trips')),
      crewSize: nOrNull(get(row, 'Crew Size')),
      discountTier: text(get(row, 'Discount Tier')),
      discountRate: nOrNull(get(row, 'Discount Rate')),
      baseUnitRate: nOrNull(get(row, 'Base Unit Rate')),
      netUnitRate: nOrNull(get(row, 'Net Unit Rate')),
      transportCharge: nOrNull(get(row, 'Transport Charge')),
      billingQty: nOrNull(get(row, 'Proposed Billing Qty')),
      proposedRevenue: nOrNull(get(row, 'Proposed Revenue')),
      pricingStatus: text(get(row, 'Pricing Status')),
      reviewNote: text(get(row, 'Review Note')),
      before: {
        applianceCategory: text(get(row, 'Appliance Category (Before Fix)')),
        pricingType: text(get(row, 'Pricing Type (Before Fix)')),
        discountRate: nOrNull(get(row, 'Discount Rate (Before Fix)')),
        baseUnitRate: nOrNull(get(row, 'Base Unit Rate (Before Fix)')),
        netUnitRate: nOrNull(get(row, 'Net Unit Rate (Before Fix)')),
        transport: nOrNull(get(row, 'Transport (Before Fix)')),
        billingQty: nOrNull(get(row, 'Billing Qty (Before Fix)')),
        revenue: nOrNull(get(row, 'Revenue (Before Fix)')),
      },
    });
  });
  let matched = 0;
  for (const line of lines) {
    if (!line.invDelNo) continue;
    const hit = byInvoice.get(line.invDelNo);
    if (hit && (hit.pricingType ?? '').toUpperCase() === line.jobType) {
      line.pricing = hit;
      matched += 1;
    }
  }
  return matched;
}

const BUDGET_SECTIONS: Record<string, ParsedBudgetLine['section']> = {
  'SERVICE VOLUME': 'volume',
  REVENUE: 'revenue',
  OPEX: 'opex',
  NOP: 'nop',
  'FINANCE COST': 'below',
  'P&L INVESTMENT': 'below',
  TAX: 'below',
  NP: 'np',
};

export async function parseBudgetWorkbook(buffer: Buffer): Promise<ParsedBudgetWorkbook> {
  const workbook = await load(buffer);
  const sheet = workbook.getWorksheet('P&L -YTD');
  if (!sheet) {
    throw new WorkbookParseError(
      'This workbook has no "P&L -YTD" sheet. Upload the Service Budget workbook (.xlsx).',
    );
  }
  // Layout: line labels in column B, the 12 budget months in columns C..N
  // (row 2 holds the month dates; column B's own row-2 date is a stray).
  const header = sheet.getRow(2);
  const periodCols: { col: number; period: string }[] = [];
  for (let c = 3; c <= 14; c += 1) {
    const iso = isoDate(header.getCell(c).value);
    if (iso) periodCols.push({ col: c, period: iso.slice(0, 7) + '-01' });
  }
  if (periodCols.length < 12) {
    throw new WorkbookParseError('The "P&L -YTD" sheet does not have 12 month columns in row 2.');
  }
  const months = periodCols.slice(0, 12);

  const lines: ParsedBudgetLine[] = [];
  let totalRevenue = 0;
  let sort = 0;
  let inBudgetBlock = true;
  for (let r = 3; r <= 40 && inBudgetBlock; r += 1) {
    const row = sheet.getRow(r);
    const label = text(row.getCell(2).value);
    if (!label) continue;
    // Everything from the "LIVE ACTUALS" banner down is the old stale
    // actuals block -- the dashboard replaces it with real revenue_lines.
    if (label.toUpperCase().startsWith('LIVE ACTUALS')) {
      inBudgetBlock = false;
      break;
    }
    const upper = label.toUpperCase();
    const section = BUDGET_SECTIONS[upper] ?? 'cost';
    sort += 1;
    for (const { col, period } of months) {
      const amount = num(row.getCell(col).value);
      lines.push({ section, lineItem: label, period, amount, sortOrder: sort });
      if (section === 'revenue') totalRevenue += amount;
    }
  }
  if (!lines.some((line) => line.section === 'revenue')) {
    throw new WorkbookParseError('The "P&L -YTD" sheet has no REVENUE row.');
  }
  return { lines, periods: months.map((m) => m.period), totalRevenue };
}
