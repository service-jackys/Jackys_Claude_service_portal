import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLogicSummary,
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
    const out = buildLogicSummary(batch, lines);
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
