import assert from 'node:assert/strict';
import test from 'node:test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';
import { DEFAULT_PRICING_RULES } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';
import { rulesOfBatch } from '../../apps/api/src/revenue-dashboard/logic-summary.js';
import {
  computeRevenue,
  diffRates,
  mastersFromRates,
  overlayRates,
  ratesFromMasters,
  ratesOf,
  reasonOf,
  singleChange,
  type RateSet,
} from '../../apps/api/src/revenue-dashboard/rate-overrides.js';
import type { RateLine } from '../../packages/db/src/revenue-rate-overrides.js';
import type { TransportRules } from '../../apps/api/src/revenue-dashboard/transport-rules.js';

const base = DEFAULT_PRICING_RULES;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const line = (id: string, jobType: string, qty: number, wb: number): RateLine =>
  ({
    id,
    jobType,
    invDelNo: id,
    qty,
    unitPrice: wb / qty,
    workbookRevenue: wb,
    remarks: null,
    billingCode: null,
    originalJobValue: 0,
    year: 2026,
    monthNo: 10,
    pricing: null,
  }) as unknown as RateLine;
const { CSIJW: jw, CSIJO: jo } = ratesOf(base).jobRates;
const noTransport: TransportRules = {
  dailyCap: false,
  deliveryOnlyCap: false,
  mixedInvoiceTransport: true,
  maxTrips: 4,
} as TransportRules;

test('rates equal to the workbook change nothing', () => {
  const inputs = {
    lines: [line('1', 'CSIJW', 2, 2 * jw), line('2', 'CSIJO', 1, jo)],
    transportLines: [],
    sheetRows: [],
    transportRules: noTransport,
  };
  const set = ratesOf(base);
  assert.deepEqual(diffRates(ratesOf(base), set), []);
  const r = computeRevenue(inputs, base, overlayRates(base, set)).revenue;
  assert.equal(r.get('1'), 2 * jw);
  assert.equal(r.get('2'), jo);
});

test('a repair rate change moves revenue by quantity times the difference only', () => {
  const inputs = {
    lines: [line('1', 'CSIJW', 3, 3 * jw), line('2', 'CSIJO', 1, jo)],
    transportLines: [],
    sheetRows: [],
    transportRules: noTransport,
  };
  const set = clone(ratesOf(base));
  set.jobRates.CSIJO += 10;
  const next = overlayRates(base, set);
  const r = computeRevenue(inputs, base, next).revenue;
  assert.equal(r.get('1'), 3 * jw);
  assert.equal(r.get('2'), jo + 10);
  assert.deepEqual(
    diffRates(ratesOf(base), set).map((d) => d.key),
    ['jobRates.CSIJO'],
  );
});

test('the pricing master round-trips the rate card values it holds', () => {
  const set: RateSet = clone(ratesOf(base));
  set.jobRates.CSIJW = 111;
  const { payload } = mastersFromRates(dandiPricingDefault, set, base);
  assert.equal(payload.flatRates?.CSIJW, 111);
  assert.equal(ratesFromMasters(payload, base).jobRates.CSIJW, 111);
});

test('singleChange applies exactly one rate and leaves the rest at the workbook value', () => {
  const set = clone(ratesOf(base));
  set.jobRates.CSIJO += 7;
  set.jobRates.CSIJW += 3;
  const one = singleChange(ratesOf(base), set, 'jobRates.CSIJO');
  assert.equal(one.jobRates.CSIJO, jo + 7);
  assert.equal(one.jobRates.CSIJW, jw);
});

test('reasonOf explains a repair line with the old and new rate', () => {
  const set = clone(ratesOf(base));
  set.jobRates.CSIJO += 10;
  const text = reasonOf(line('9', 'CSIJO', 2, 2 * jo), base, overlayRates(base, set));
  assert.match(text, /CSIJO rate/);
  assert.match(text, /x 2$/);
});

// Installation-only discount tier basis (modification #314).
const installLine = (
  id: string,
  inv: string,
  qty: number,
  wb: number,
  category: string,
): RateLine =>
  ({
    ...line(id, 'CSIII', qty, wb),
    invDelNo: inv,
    pricing: {
      applianceCategory: category,
      crewSize: 2,
      city: 'DUBAI',
      before: { revenue: null, transport: null },
    },
  }) as unknown as RateLine;

test('installation-only tiers: the whole invoice sets the tier when the basis is "invoice"', () => {
  const lines = [
    installLine('c', '1001', 1, 80, 'Freestanding Cooker'),
    installLine('w', '1001', 1, 60, 'Freestanding Washing Machine'),
    installLine('x', '1002', 1, 60, 'Freestanding Washing Machine'),
  ];
  const mk = (basis?: 'invoice' | 'line') => ({
    lines,
    transportLines: [],
    sheetRows: [],
    transportRules: noTransport,
    installTierBasis: basis,
  });
  const v3 = { ...base, logicVersion: 3 as const };
  const wbRules = overlayRates(v3, ratesOf(v3));
  const own = computeRevenue(mk('line'), v3, wbRules).revenue;
  assert.equal(own.get('c'), 80);
  assert.equal(own.get('w'), 60);
  const inv = computeRevenue(mk('invoice'), v3, wbRules).revenue;
  // Invoice 1001 has 2 installation units: batch rate less the 2-5 unit tier (5%).
  assert.equal(inv.get('c'), 66.5);
  assert.equal(inv.get('w'), 52.25);
  // A single-line, single-unit invoice is untouched.
  assert.equal(inv.get('x'), 60);
});

test('installation-only tiers: lines skipped for the fridge logic keep their figure', () => {
  const lines = [
    installLine('c', '1001', 1, 80, 'Freestanding Cooker'),
    installLine('f', '1001', 1, 60, 'Freestanding Refrigerator'),
  ];
  const inputs = {
    lines,
    transportLines: [],
    sheetRows: [],
    transportRules: noTransport,
    installTierBasis: 'invoice' as const,
  };
  const v3 = { ...base, logicVersion: 3 as const };
  const r = computeRevenue(inputs, v3, overlayRates(v3, ratesOf(v3)), {
    skipTier: new Set(['f']),
  }).revenue;
  assert.equal(r.get('c'), 66.5);
  assert.equal(r.get('f'), 60);
});

// Re-price older rows at current rates (modification #327).
test('re-price older rows: a cooker booked at 90 is rebuilt at the current rate; live and fridge rows are left alone', () => {
  const v3 = { ...base, logicVersion: 3 as const };
  const mk = (id: string, source: string, category: string, wb: number): RateLine =>
    ({
      ...installLine(id, id, 1, wb, category),
      pricing: {
        applianceCategory: category,
        crewSize: 2,
        city: 'DUBAI',
        sourceName: source,
        invoiceCsidiQty: 1,
        before: { revenue: null, transport: null },
      },
    }) as unknown as RateLine;
  const lines = [
    mk('old', 'Locked history', 'Freestanding Cooker', 90),
    mk('live', 'Net Sale Current (Live Feed)', 'Freestanding Cooker', 90),
    mk('fr', 'Locked history', 'Freestanding Refrigerator', 90),
  ];
  const mkIn = (repriceOlder: boolean) => ({
    lines,
    transportLines: [],
    sheetRows: [],
    transportRules: noTransport,
    repriceOlder,
  });
  const rules = overlayRates(v3, ratesOf(v3));
  const off = computeRevenue(mkIn(false), v3, rules).revenue;
  assert.equal(off.get('old'), 90);
  const on = computeRevenue(mkIn(true), v3, rules, { skipTier: new Set(['fr']) }).revenue;
  const rebuilt = on.get('old')!;
  assert.notEqual(rebuilt, 90);
  assert.equal(on.get('live'), 90);
  assert.equal(on.get('fr'), 90);
  // Switching it off again gives back exactly the workbook figure.
  assert.equal(computeRevenue(mkIn(false), v3, rules).revenue.get('old'), 90);
});

test('an upload made before Dishwasher existed still shows the Dishwasher row in the Rate card', () => {
  const old = clone(DEFAULT_PRICING_RULES);
  for (const m of [old.deliveryInstall, old.install])
    m.categories = m.categories.filter((c) => !/dishwasher/i.test(c.category));
  const rules = rulesOfBatch({ summary: { pricingRules: old } } as never);
  for (const m of [rules.deliveryInstall, rules.install]) {
    const names = m.categories.map((c) => c.category);
    assert.ok(names.includes('Freestanding Dishwasher'));
    assert.equal(names[names.length - 1], 'Default');
  }
  const set = ratesFromMasters(dandiPricingDefault, rules);
  const di = set.deliveryInstall.categories.find((c) => c.category === 'Freestanding Dishwasher')!;
  const inst = set.install.categories.find((c) => c.category === 'Freestanding Dishwasher')!;
  assert.deepEqual([di.batchRate, di.standardRate, di.minimumRate], [60, 100, 35]);
  assert.deepEqual([inst.batchRate, inst.standardRate, inst.minimumRate], [60, 60, 35]);
  // A workbook that already has the row is left alone.
  const again = rulesOfBatch({ summary: { pricingRules: rules } } as never);
  assert.equal(again.deliveryInstall.categories.length, rules.deliveryInstall.categories.length);
});
