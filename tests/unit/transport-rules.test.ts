import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTransport,
  lineAdjustments,
  NEW_MASTER_RULES,
  presetOf,
  summarise,
  type SheetRow,
} from '../../apps/api/src/revenue-dashboard/transport-rules.js';

const NEW = NEW_MASTER_RULES;
const OFF = { ...NEW, dailyCap: false };
let n = 0;
// An OLD master row: Transport Charge / Proposed Revenue are the old (uncapped) figures.
function row(
  inv: number,
  type: string,
  revenue: number,
  o: { t?: number; qty?: number; date?: string; sm?: string } = {},
): SheetRow {
  n += 1;
  return {
    rowNo: n,
    data: {
      'Inv/Del No': inv,
      Date: o.date ?? '2026-11-03',
      Salesman: o.sm ?? 'A',
      'Pricing Type': type,
      'Calc Qty': o.qty ?? 1,
      'Transport Charge': o.t ?? 0,
      'Proposed Revenue': revenue,
    },
  };
}
const inv = (c: ReturnType<typeof computeTransport>, k: string) =>
  c.invoices.find((i) => i.invoice === k)!;

test('presets: new master, old master and custom', () => {
  assert.equal(presetOf(NEW), 'new_master');
  assert.equal(presetOf(OFF), 'old_master');
  assert.equal(presetOf({ ...OFF, deliveryOnlyCap: true }), 'old_master'); // delivery-only cap only works with the cap
  assert.equal(presetOf({ ...NEW, deliveryOnlyCap: true }), 'custom');
  assert.equal(presetOf({ ...OFF, mixedInvoiceTransport: false }), 'custom');
});

test('the cap keeps the 2 highest installation trips; single units and delivery-only are not capped', () => {
  const rows = [
    row(1001, 'CSIDI', 174, { t: 60, qty: 2 }), // batch, 60
    row(1002, 'CSIDI', 174, { t: 60, qty: 2 }), // batch, 60
    row(1003, 'CSIDI', 204, { t: 90, qty: 2 }), // Sharjah batch, 90 (highest)
    row(1004, 'CSIDI', 100), // single unit: no transport, not a trip
    row(1005, 'CSIDO', 100), // delivery-only
    row(1006, 'CSIDO', 100),
    row(1007, 'CSIDO', 100),
  ];
  const c = computeTransport(rows, NEW);
  assert.equal(c.workbookRule, 'old');
  assert.deepEqual(
    [1003, 1001, 1002].map((k) => [inv(c, String(k)).rank, inv(c, String(k)).charged]),
    [
      [1, true],
      [2, true],
      [3, false],
    ],
  );
  assert.equal(inv(c, '1002').delta, -60);
  assert.equal(inv(c, '1004').kind, 'none');
  for (const k of ['1005', '1006', '1007']) assert.equal(inv(c, k).delta, 0);
  const s = summarise(c, { CSIJW: 0, CSIJO: 0 }, () => true, 2);
  assert.equal(s.workbookTotal, 952);
  assert.equal(s.currentTotal, 892);
  assert.equal(s.tripsNotCharged, 1);
  assert.equal(s.daysOverCap, 1);
  // cap off = old master logic: nothing changes
  assert.ok(computeTransport(rows, OFF).invoices.every((i) => i.delta === 0));
  // strict: delivery-only trips (100) compete too and outrank the 60s
  const strict = computeTransport(rows, { ...NEW, deliveryOnlyCap: true });
  assert.deepEqual(
    strict.invoices.filter((i) => i.charged && i.rank !== null).map((i) => i.invoice),
    ['1005', '1006'],
  );
  assert.equal(
    summarise(strict, { CSIJW: 0, CSIJO: 0 }, () => true, 2).currentTotal,
    952 - 60 - 60 - 90 - 100,
  );
});

test('mixed invoices: one regional charge on the CSIDO line; the mixed-invoice toggle drops it for a single CSIDI unit', () => {
  const rows = [
    row(2001, 'CSIDI', 100), // 1 CSIDI unit ...
    row(2001, 'CSIDO', 60), // ... + delivery-only item: regional 60 on the CSIDO line
    row(2002, 'CSIDI', 114, { qty: 2 }),
    row(2002, 'CSIDO', 60),
  ];
  const c = computeTransport(rows, NEW);
  assert.equal(inv(c, '2001').carrier, 'CSIDO');
  assert.equal(inv(c, '2001').mixedSingle, true);
  assert.equal(inv(c, '2002').mixedSingle, false);
  const off = computeTransport(rows, { ...NEW, mixedInvoiceTransport: false });
  assert.equal(inv(off, '2001').scenario, 0);
  assert.equal(inv(off, '2001').delta, -60);
  assert.equal(inv(off, '2002').scenario, 60);
});

test('a NEW master (before-cap columns) is read correctly; cap off restores the old figures', () => {
  const r = (
    inv_: number,
    t: number,
    before: number,
    rev: number,
    beforeRev: number,
  ): SheetRow => ({
    rowNo: inv_,
    data: {
      'Inv/Del No': inv_,
      Date: '2026-07-10',
      Salesman: 'S',
      'Pricing Type': 'CSIDI',
      'Calc Qty': 2,
      'Transport Charge': t,
      'Proposed Revenue': rev,
      'Transport Before Cap': before,
      'Revenue Before Cap': beforeRev,
    },
  });
  const rows = [r(1, 60, 60, 174, 174), r(2, 60, 60, 174, 174), r(3, 0, 60, 114, 174)]; // 3rd already capped by Excel
  const c = computeTransport(rows, NEW);
  assert.equal(c.workbookRule, 'new');
  assert.ok(c.invoices.every((i) => i.delta === 0));
  const back = computeTransport(rows, OFF);
  assert.equal(inv(back, '3').delta, 60);
});

test('line adjustments use the stored revenue lines, also when Revenue Source was not recalculated', () => {
  const rows = [
    row(3001, 'CSIDI', 174, { t: 60, qty: 2 }),
    row(3002, 'CSIDI', 174, { t: 60, qty: 2 }),
    row(3003, 'CSIDI', 174, { t: 60, qty: 2 }),
    row(3004, 'CSIDO', 100),
    row(3004, 'CSIDO', 0),
  ];
  const c = computeTransport(rows, NEW);
  const lines = [
    { id: '1', invDelNo: '3001', jobType: 'CSIDI', workbookRevenue: 174 },
    { id: '2', invDelNo: '3002', jobType: 'CSIDI', workbookRevenue: 174 },
    { id: '3', invDelNo: '3003', jobType: 'CSIDI', workbookRevenue: 174 },
    { id: '4', invDelNo: '3004', jobType: 'CSIDO', workbookRevenue: 100 },
    { id: '5', invDelNo: '3004', jobType: 'CSIDO', workbookRevenue: 0 },
  ];
  assert.deepEqual(lineAdjustments(c, lines), {
    updates: [{ id: '3', revenue: 114 }],
    unmatched: 0,
  });
  // the same lines already capped by Excel need no change
  const capped = lines.map((l) => (l.id === '3' ? { ...l, workbookRevenue: 114 } : l));
  assert.deepEqual(lineAdjustments(c, capped).updates, []);
  // cap off on capped lines puts the 60 back
  assert.deepEqual(lineAdjustments(computeTransport(rows, OFF), capped).updates, [
    { id: '3', revenue: 174 },
  ]);
  // a missing revenue line is counted, never guessed
  assert.equal(lineAdjustments(c, lines.slice(0, 2)).unmatched, 2);
});
