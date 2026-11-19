import assert from 'node:assert/strict';
import test from 'node:test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';
import { DEFAULT_PRICING_RULES } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';
import {
  computeRevenue,
  diffRates,
  mastersFromRates,
  overlayRates,
  ratesFromMasters,
  ratesOf,
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
