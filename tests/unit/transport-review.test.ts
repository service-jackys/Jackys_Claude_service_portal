import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTransportReview,
  type SheetRow,
} from '../../apps/api/src/revenue-dashboard/transport-review.js';

const S = { dubai: 60, sharjah: 90, csidoFee: 100, maxTrips: 2 };
let n = 0;
function line(
  invoice: number,
  type: 'CSIDI' | 'CSIDO' | 'CSIII',
  revenue: number,
  extra: { transport?: number; date?: string; sm?: string; city?: string; qty?: number } = {},
): SheetRow {
  n += 1;
  return {
    rowNo: n,
    data: {
      'Inv/Del No': invoice,
      Date: extra.date ?? '2026-11-03',
      Salesman: extra.sm ?? 'RENEESH JOSE',
      'Pricing Type': type,
      'ERP City / Region': extra.city ?? 'DUBAI',
      'Calc Qty': extra.qty ?? 1,
      'Proposed Revenue': revenue,
      'Transport Charge': extra.transport ?? 0,
    },
  };
}
const trip = (r: ReturnType<typeof buildTransportReview>, invoice: string) =>
  r.days.flatMap((d) => d.list).find((t) => t.invoice === invoice)!;

test('third Dubai invoice of the day is not charged; its unit price still is (the 544 example)', () => {
  const rows = [
    line(1001, 'CSIDI', 60 * 0.95, { qty: 1 }),
    line(1001, 'CSIDI', 60 * 0.95),
    line(1001, 'CSIDI', 80 * 0.95),
    line(1002, 'CSIDI', 57),
    line(1002, 'CSIDI', 57),
    line(1003, 'CSIDI', 120),
  ];
  const r = buildTransportReview(rows, S);
  assert.equal(trip(r, '1001').charged, true);
  assert.equal(trip(r, '1002').charged, true);
  assert.equal(trip(r, '1003').charged, false);
  assert.equal(trip(r, '1003').rank, 3);
  assert.equal(r.kpis.transportNew, 120);
  assert.equal(r.kpis.newTotal, 544);
  assert.equal(r.kpis.tripsNotCharged, 1);
  assert.equal(r.kpis.droppedCharges, 60);
  assert.equal(r.kpis.daysOverCap, 1);
  assert.equal(r.days[0].overCap, true);
});

test('a Sharjah trip outranks Dubai trips; equal charges go to the lower invoice number', () => {
  const rows = [
    line(2001, 'CSIDI', 100),
    line(2002, 'CSIDI', 100),
    line(2003, 'CSIDI', 100, { city: 'SHARJAH' }),
  ];
  const r = buildTransportReview(rows, S);
  assert.deepEqual(
    r.days[0].list.map((t) => [t.invoice, t.charge, t.charged]),
    [
      ['2003', 90, true],
      ['2001', 60, true],
      ['2002', 60, false],
    ],
  );
  assert.equal(r.kpis.transportNew, 150);
});

test('mixed trip (60) + delivery-only trip (100) = 160; a further Dubai invoice that day is not charged', () => {
  const rows = [
    line(3001, 'CSIDI', 100),
    line(3001, 'CSIDO', 60), // today the CSIDO line on a mixed invoice carries the regional transport
    line(3002, 'CSIDO', 100),
    line(3003, 'CSIDI', 100),
  ];
  const r = buildTransportReview(rows, S);
  assert.deepEqual(
    r.days[0].list.map((t) => [t.invoice, t.invoiceType, t.charge, t.charged]),
    [
      ['3002', 'CSIDO only', 100, true],
      ['3001', 'CSIDI + CSIDO', 60, true],
      ['3003', 'CSIDI', 60, false],
    ],
  );
  const by = Object.fromEntries(r.byJobType.map((x) => [x.key, x]));
  assert.equal(by.TRANSPORT.current, 60); // old: the mixed CSIDO line
  assert.equal(by.TRANSPORT.new, 60);
  assert.equal(by.CSIDO.current, 100);
  assert.equal(by.CSIDO.new, 100);
  assert.equal(r.kpis.newTotal, 360); // units 100 + 100, trips 100 + 60
});

test('a delivery-only invoice beyond the 2 charged trips pays nothing (its fee is the trip)', () => {
  const rows = [line(3101, 'CSIDO', 100), line(3102, 'CSIDO', 100), line(3103, 'CSIDO', 100)];
  const r = buildTransportReview(rows, S);
  const by = Object.fromEntries(r.byJobType.map((x) => [x.key, x]));
  assert.equal(by.CSIDO.current, 300);
  assert.equal(by.CSIDO.new, 200);
  assert.equal(trip(r, '3103').charged, false);
  assert.equal(trip(r, '3103').newTransportAndFee, 0);
});

test('CSIII is never a trip and never takes a slot; current CSIDI transport moves to its own line', () => {
  const rows = [
    line(4001, 'CSIII', 150),
    line(4002, 'CSIDI', 174, { transport: 60, qty: 2 }),
    line(4003, 'CSIDI', 100),
  ];
  const r = buildTransportReview(rows, S);
  assert.equal(r.kpis.tripsCharged, 2);
  assert.equal(r.kpis.tripsNotCharged, 0);
  const by = Object.fromEntries(r.byJobType.map((x) => [x.key, x]));
  assert.equal(by.CSIII.new, 150);
  assert.equal(by.CSIDI.current, 214); // 174 - 60 + 100
  assert.equal(by.TRANSPORT.current, 60);
  assert.equal(by.TRANSPORT.new, 120); // single-unit invoice 4003 now pays a trip too
});

test('salesperson-days, months, period filter, repairs and settings', () => {
  const rows = [
    line(5001, 'CSIDI', 100, { date: '2026-10-31', sm: 'A' }),
    line(5002, 'CSIDI', 100, { date: '2026-11-01', sm: 'A' }),
    line(5003, 'CSIDI', 100, { date: '2026-11-01', sm: 'B' }),
    line(5004, 'CSIDI', 100, { date: '2026-11-01', sm: 'A' }),
    line(5005, 'CSIDI', 100, { date: '2026-11-01', sm: 'A' }),
  ];
  const repairs = [
    { jobType: 'CSIJW' as const, month: 202611, revenue: 1000 },
    { jobType: 'CSIJO' as const, month: 202610, revenue: 500 },
  ];
  const all = buildTransportReview(rows, S, { repairs });
  assert.deepEqual(
    all.months.map((m) => [m.month, m.current, m.new, m.daysOverCap]),
    [
      [202610, 600, 660, 0],
      [202611, 1400, 1580, 1],
    ],
  );
  const nov = buildTransportReview(rows, S, { repairs, month: 202611 });
  assert.equal(nov.kpis.currentTotal, 1400);
  assert.equal(nov.kpis.newTotal, 1580); // A: 2 of 3 trips charged, B: 1 charged = 3 x 60
  assert.deepEqual(
    nov.salespeople.map((p) => [
      p.name,
      p.invoices,
      p.tripsCharged,
      p.tripsNotCharged,
      p.daysOverCap,
    ]),
    [
      ['A', 3, 2, 1, 1],
      ['B', 1, 1, 0, 0],
    ],
  );
  const three = buildTransportReview(rows, { ...S, maxTrips: 3 }, { month: 202611 });
  assert.equal(three.kpis.tripsNotCharged, 0);
  const rows2 = buildTransportReview(rows, { ...S, dubai: 75 }, { month: 202611 });
  assert.equal(rows2.kpis.transportNew, 225);
});

test('rows without an invoice number or a valid date are ignored', () => {
  const r = buildTransportReview(
    [
      { rowNo: 1, data: { 'Inv/Del No': '', Date: '2026-11-01', 'Pricing Type': 'CSIDI' } },
      { rowNo: 2, data: { 'Inv/Del No': 9, Date: 'not a date', 'Pricing Type': 'CSIDI' } },
    ],
    S,
  );
  assert.equal(r.kpis.currentTotal, 0);
  assert.equal(r.days.length, 0);
});
