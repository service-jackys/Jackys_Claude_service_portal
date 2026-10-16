import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { revenueViewExportQuerySchema } from '../../packages/contracts/src/index.js';
import {
  buildRevenueViewWorkbook,
  describeFilters,
  dimensionLabel,
  whyFlagged,
  type RevenueViewData,
} from '../../apps/api/src/revenue-dashboard/view-export.js';

const names = new Map([
  ['CSIDI', 'Delivery + Installations'],
  ['CSIJO', 'Non-Warranty Repairs'],
]);

function lines() {
  return [
    {
      orderDate: '2026-09-29',
      jobType: 'CSIJO',
      invDelNo: '16100978',
      csoscOrderNo: null,
      customer: 'ACME LLC',
      salesChannel: '3PTY',
      salesPerson: 'SHIVA',
      orderStatus: null,
      jobSheetStatus: null,
      billingCode: 'MC-SERVICE-CHARGES',
      costStatus: 'WITH COST',
      qty: 2,
      unitPrice: 119,
      revenue: 175,
      remarks: '=1+1 not a formula',
      pricing: null,
    },
    {
      orderDate: '2026-10-01',
      jobType: 'CSIJO',
      invDelNo: '16100979',
      csoscOrderNo: '1',
      customer: 'BETA LLC',
      salesChannel: 'INS',
      salesPerson: 'SHIVA',
      orderStatus: 'Pending',
      jobSheetStatus: null,
      billingCode: 'MC-SERVICE-CHARGES',
      costStatus: 'WITH COST',
      qty: 1,
      unitPrice: 119,
      revenue: 119,
      remarks: null,
      pricing: null,
    },
  ];
}

function data(over: Partial<RevenueViewData> = {}): RevenueViewData {
  const l = lines();
  return {
    batch: {
      id: '1',
      kind: 'revenue',
      fileName: 'master.xlsm',
      uploadedAt: new Date('2026-10-16T05:00:00Z'),
      summary: { rates: [{ jobType: 'CSIJO', description: 'Non-Warranty Repairs' }] },
    } as never,
    filters: { exception: 'notApproved', year: '2026' },
    groupBy: 'period',
    viewPath: 'All data > Year: 2026 > Exception: Order not Approved',
    totals: { revenue: 294, jobs: 2, qty: 3 },
    grandTotals: { revenue: 1000, jobs: 10, qty: 12 },
    breakdown: {
      totals: { revenue: 294, jobs: 2, qty: 3 },
      rows: [
        { key: '2026-10', revenue: 119, jobs: 1, qty: 1 },
        { key: '2026-09', revenue: 175, jobs: 1, qty: 2 },
      ],
    },
    jobTypeMix: {
      totals: { revenue: 294, jobs: 2, qty: 3 },
      rows: [{ key: 'CSIJO', revenue: 294, jobs: 2, qty: 3 }],
    },
    exception: { key: 'notApproved', label: 'Order not Approved', description: 'Not approved.' },
    lines: l,
    truncated: false,
    ...over,
  };
}

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

test('view export builds Summary, Breakdown and Jobs with the right totals', async () => {
  const wb = await open(await buildRevenueViewWorkbook(data()));
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ['Summary', 'Breakdown', 'Jobs'],
  );
  const summary = wb.getWorksheet('Summary')!;
  assert.equal(summary.getCell('A5').value, 294);
  assert.equal(summary.getCell('B5').value, 2);

  const breakdown = wb.getWorksheet('Breakdown')!;
  // time dimensions are listed oldest first and labelled as months
  assert.equal(breakdown.getCell('A5').value, 'Sep 2026');
  assert.equal(breakdown.getCell('A6').value, 'Oct 2026');
  const total = breakdown.getCell('D7').value as { result: number };
  assert.equal(total.result, 294);

  const jobs = wb.getWorksheet('Jobs')!;
  const headers = (jobs.getRow(4).values as unknown[]).slice(1);
  assert.equal(headers[2], 'Why it is flagged');
  assert.ok(!headers.includes('ERP brand'), 'empty ERP columns are left out');
  assert.equal(jobs.getCell('C5').value, 'CSOSC order status is blank (not Approved)');
  assert.equal(jobs.getCell('C6').value, 'CSOSC order status is Pending (not Approved)');
  // a remark that looks like a formula stays text
  const remarks = headers.indexOf('Remarks') + 1;
  assert.equal(jobs.getRow(5).getCell(remarks).value, '=1+1 not a formula');
  const revenueCol = headers.indexOf('Revenue (AED)') + 1;
  const sum = jobs.getRow(7).getCell(revenueCol).value as { formula: string; result: number };
  assert.match(sum.formula, /^SUBTOTAL\(109,/);
  assert.equal(sum.result, 294);
});

test('a jobs-only view has no Breakdown sheet and an empty view has no circular total', async () => {
  const wb = await open(
    await buildRevenueViewWorkbook(
      data({ groupBy: 'jobs', breakdown: null, exception: null, filters: {}, lines: [] }),
    ),
  );
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ['Summary', 'Jobs'],
  );
  assert.equal(wb.getWorksheet('Jobs')!.getCell('A5').value, 'No jobs match this view.');
});

test('labels and reasons are readable', () => {
  assert.equal(dimensionLabel('period', '2026-07', names), 'Jul 2026');
  assert.equal(dimensionLabel('yearWeek', '2026-W41', names), '2026 W41');
  assert.equal(dimensionLabel('month', '10', names), 'October');
  assert.equal(dimensionLabel('jobType', 'CSIDI', names), 'CSIDI - Delivery + Installations');
  assert.equal(
    whyFlagged('zeroRevenue', { costStatus: 'ZERO COST' }),
    'Revenue is 0 (cost status ZERO COST)',
  );
  assert.deepEqual(
    describeFilters({ jobType: 'CSIDI', search: 'acme' }, names, {
      key: 'noCustomer',
      label: 'Missing customer',
      description: '',
    }),
    [
      ['Job type', 'CSIDI - Delivery + Installations'],
      ['Search text', 'acme'],
      ['Exception', 'Missing customer'],
    ],
  );
});

test('the view export query accepts filters, groupBy and a path, and rejects strangers', () => {
  const ok = revenueViewExportQuerySchema.parse({
    exception: 'notApproved',
    groupBy: 'jobs',
    viewPath: 'All data > Exception: Order not Approved',
    month: '',
  });
  assert.equal(ok.groupBy, 'jobs');
  assert.equal(ok.month, undefined);
  assert.equal(revenueViewExportQuerySchema.parse({ groupBy: 'period' }).groupBy, 'period');
  assert.throws(() => revenueViewExportQuerySchema.parse({ groupBy: 'nope' }));
  assert.throws(() => revenueViewExportQuerySchema.parse({ other: '1' }));
});
