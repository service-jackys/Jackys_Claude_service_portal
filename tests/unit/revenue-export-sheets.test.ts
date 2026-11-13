import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildRevenueReportWorkbook,
  type RevenueReportData,
} from '../../apps/api/src/revenue-dashboard/export.js';

const group = (revenue: number, jobs: number) => ({
  totals: { revenue, jobs, qty: jobs },
  rows: [],
});

const line = (over: Record<string, unknown>) => ({
  orderDate: '2026-08-02',
  year: 2026,
  month: 8,
  weekNo: 31,
  jobType: 'CSIJW',
  invDelNo: '1',
  csoscOrderNo: '16100001',
  customer: 'ACME',
  salesChannel: 'INS',
  salesPerson: 'SHIVA',
  orderStatus: 'Approved',
  jobSheetStatus: '',
  billingCode: 'SERV-REPAIR-WAR',
  costStatus: 'READY',
  qty: 2,
  unitPrice: 100,
  originalJobValue: 0,
  revenue: 200,
  remarks: 'HISENSE WASHING MACHINE\nWFVB7012MT NOT WORKING',
  pricing: null,
  ...over,
});

test('export splits jobs into repair and delivery & install sheets', async () => {
  const lines = [
    line({ refDocNo: 'CSOSC - 16100001' }),
    line({ jobType: 'CSIJO', invDelNo: '2', qty: 1, unitPrice: 119, revenue: 119 }),
    line({
      jobType: 'CSIDO',
      invDelNo: '3',
      qty: 1,
      unitPrice: 0,
      revenue: 100,
      pricing: {
        erpCategory: 'Cooking',
        pricingType: 'Delivery',
        refDocNo: 'CSOSC - 16100003',
        before: {},
      },
    }),
  ];
  const data = {
    batch: { fileName: 'x.xlsm', uploadedAt: new Date(), summary: {} },
    filters: {},
    total: group(419, 3),
    monthly: { totals: group(419, 3).totals, cells: [] },
    weekly: { totals: group(419, 3).totals, cells: [] },
    channel: group(419, 3),
    salesPerson: group(419, 3),
    customer: group(419, 3),
    billingCode: group(419, 3),
    exceptions: { totals: group(419, 3).totals, exceptions: [] },
    lines,
  } as unknown as RevenueReportData;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildRevenueReportWorkbook(data)) as unknown as ArrayBuffer);
  const names = wb.worksheets.map((w) => w.name);
  for (const n of ['Jobs', 'Delivery & Install', 'Source detail']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('What-ifs'));
  const jobs = wb.getWorksheet('Jobs')!;
  const di = wb.getWorksheet('Delivery & Install')!;
  // band row + header row + data rows + total row
  assert.equal(jobs.rowCount, 2 + 2 + 1);
  assert.equal(di.rowCount, 2 + 1 + 1);
  const header = (ws: ExcelJS.Worksheet) => (ws.getRow(2).values as unknown[]).slice(1);
  assert.ok(header(jobs).includes('Appliance (from remarks)'));
  assert.ok(header(di).includes('Parent category'));
  const rev = header(jobs).indexOf('Revenue (AED)') + 1;
  assert.equal(Number(jobs.getRow(3).getCell(rev).value), 200);
  assert.equal(
    jobs.getRow(3).getCell(header(jobs).indexOf('Appliance (from remarks)') + 1).value,
    'Washing machine / dryer',
  );
  // Accounts need the workbook's Ref doc no on the review sheets too.
  const refCol = (ws: ExcelJS.Worksheet) => header(ws).indexOf('Ref doc no') + 1;
  assert.ok(refCol(jobs) > 0, 'Jobs has Ref doc no');
  assert.ok(refCol(di) > 0, 'Delivery & Install has Ref doc no');
  assert.equal(jobs.getRow(3).getCell(refCol(jobs)).value, 'CSOSC - 16100001');
  assert.equal(di.getRow(3).getCell(refCol(di)).value, 'CSOSC - 16100003');
});

test('export: a trip the daily cap left uncharged is not listed as a transport pricing difference', async () => {
  const { enrichLine } = await import('../../apps/api/src/revenue-dashboard/pricing-logic.js');
  const { DEFAULT_PRICING_RULES } =
    await import('../../apps/api/src/revenue-dashboard/pricing-logic.js');
  const rules = { ...DEFAULT_PRICING_RULES, logicVersion: 3 as const };
  const pricing = {
    erpCategory: 'Refrigerator',
    applianceCategory: 'Freestanding Refrigerator',
    invoiceCsidiQty: 2,
    invoiceHasCsido: false,
    invoiceHasCsidi: true,
    firstOfType: true,
    transportCharge: 0,
    refDocNo: 'CSOSC - 1',
    before: {},
  };
  const base = {
    jobType: 'CSIDI',
    qty: 2,
    unitPrice: 0,
    revenue: 0,
    remarks: null,
    billingCode: null,
    pricing,
  } as never;
  const full = enrichLine(rules, base);
  assert.ok(full.rebuilt !== null && full.transport !== null && full.transport > 0);
  // The workbook row has the labour but no transport (the cap left it uncharged).
  const revenue = full.rebuilt - full.transport;
  const lines = [
    line({ jobType: 'CSIDI', invDelNo: '77', qty: 2, unitPrice: 0, revenue, pricing }),
  ];
  const mk = (cappedTrips?: Map<string, number>) =>
    ({
      batch: { fileName: 'x.xlsm', uploadedAt: new Date(), summary: { pricingRules: rules } },
      filters: {},
      total: group(revenue, 1),
      monthly: { totals: group(revenue, 1).totals, cells: [] },
      weekly: { totals: group(revenue, 1).totals, cells: [] },
      channel: group(revenue, 1),
      salesPerson: group(revenue, 1),
      customer: group(revenue, 1),
      billingCode: group(revenue, 1),
      exceptions: { totals: group(revenue, 1).totals, exceptions: [] },
      lines,
      cappedTrips,
    }) as unknown as RevenueReportData;
  const cause = async (data: RevenueReportData) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildRevenueReportWorkbook(data)) as unknown as ArrayBuffer);
    const di = wb.getWorksheet('Delivery & Install')!;
    const col = (di.getRow(2).values as unknown[]).slice(1).indexOf('Why they differ') + 1;
    return di.getRow(3).getCell(col).value;
  };
  assert.equal(await cause(mk()), 'CSIDI transport');
  assert.equal(await cause(mk(new Map([['77', full.transport!]]))), 'Daily trip cap');
  // A capped invoice whose difference is something else keeps its own cause.
  assert.equal(await cause(mk(new Map([['77', full.transport! + 50]]))), 'CSIDI transport');
});
