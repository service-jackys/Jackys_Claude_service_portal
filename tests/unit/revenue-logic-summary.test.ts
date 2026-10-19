import assert from 'node:assert/strict';
import test from 'node:test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';
import {
  buildLogicSummary,
  buildWorkedExample,
  rulesOfBatch,
  type LogicSummaryLine,
} from '../../apps/api/src/revenue-dashboard/logic-summary.js';

const batch = {
  id: 'b1',
  fileName: 'master.xlsm',
  uploadedAt: new Date('2026-10-16T00:00:00Z'),
  summary: {},
} as never;

const line = (over: Partial<LogicSummaryLine>): LogicSummaryLine => ({
  jobType: 'CSIDO',
  invDelNo: '1',
  customer: 'ACME',
  orderDate: '2026-08-02',
  qty: 1,
  unitPrice: 0,
  revenue: 0,
  remarks: null,
  billingCode: null,
  pricing: null,
  ...over,
});

test('buildLogicSummary explains extra CSIDO lines under one paid line', () => {
  {
    const lines = [
      line({ jobType: 'CSIDI', revenue: 57, qty: 1 }),
      line({ revenue: 100 }),
      line({ revenue: 0 }),
      line({ revenue: 0 }),
      line({ jobType: 'CSIJW', invDelNo: '2', revenue: 0 }),
    ];
    const out = buildLogicSummary(batch, lines, dandiPricingDefault);
    assert.equal(out.totals.lines, 5);
    assert.equal(out.totals.revenue, 157);
    assert.equal(out.zeroRevenue.lines, 3);
    assert.equal(out.zeroRevenue.explainedLines, 2);
    assert.equal(out.zeroRevenue.otherLines, 1);
    assert.deepEqual(out.zeroRevenue.byMonth, [{ period: '2026-08', lines: 3 }]);
    assert.equal(out.example?.invoice, '1');
    assert.equal(out.example?.total, 157);
  }
});

test('master rates come from the D+I pricing master, VAT-inclusive, CSIJO 125', () => {
  const out = buildLogicSummary(batch, [line({})], dandiPricingDefault);
  const m = out.master;
  assert.equal(m.vatIncluded, true);
  assert.deepEqual(
    m.deliveryInstall.categories.map((c) => c.standardRate),
    [100, 100, 120],
  );
  assert.deepEqual(
    m.jobRates.map((r) => [r.jobType, r.price]),
    [
      ['CSIJW', 100],
      ['CSIDO', 80],
      ['CSIJO', 125],
      ['RWR', 60],
    ],
  );
});

test('buildWorkedExample covers any job type and orders lines by type', () => {
  const rules = rulesOfBatch(batch);
  const ex = buildWorkedExample(rules, '77', [
    line({ jobType: 'CSIJO', invDelNo: '77', qty: 2, unitPrice: 125, revenue: 250 }),
    line({ jobType: 'CSIJW', invDelNo: '77', qty: 1, unitPrice: 100, revenue: 100 }),
  ]);
  assert.deepEqual(
    ex.lines.map((l) => l.jobType),
    ['CSIJW', 'CSIJO'],
  );
  assert.equal(ex.lines[1]?.how, '2 x AED 125 per job');
  assert.equal(ex.total, 350);
});

test('CSIDI tier and batch rate use the invoice total; transport sits on the first line', () => {
  const rules = { ...rulesOfBatch(batch), logicVersion: 3 as const };
  const pricing = (cat: string, base: number, net: number, transport: number, first: boolean) =>
    ({
      applianceCategory: cat,
      baseUnitRate: base,
      netUnitRate: net,
      discountRate: 0,
      transportCharge: transport,
      invoiceCsidiQty: 5,
      invoiceHasCsido: false,
      firstOfType: first,
      crewSize: 2,
      city: 'DXB',
      before: {},
    }) as never;
  const ex = buildWorkedExample(rules, '16101385', [
    line({
      jobType: 'CSIDI',
      invDelNo: '16101385',
      qty: 1,
      unitPrice: 57,
      revenue: 117,
      pricing: pricing('Freestanding Refrigerator', 60, 57, 60, true),
    }),
    line({
      jobType: 'CSIDI',
      invDelNo: '16101385',
      qty: 4,
      unitPrice: 76,
      revenue: 304,
      pricing: pricing('Freestanding Cooker', 80, 76, 0, false),
    }),
  ]);
  assert.equal(ex.total, 421);
  assert.match(ex.lines[1]?.how ?? '', /1 x AED 57 \(batch rate AED 60 less 5% volume discount\)/);
  assert.equal(ex.lines[0]?.check, undefined);
  assert.equal(ex.lines[1]?.check, undefined);
  assert.match(ex.notes[0] ?? '', /5 delivery \+ installation units.*batch rate.*2–5 units: 5%/);
  assert.match(ex.notes[1] ?? '', /AED 60 is charged once.*first/);
});
