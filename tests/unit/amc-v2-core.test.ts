import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { amcPricingV2Schema } from '../../packages/contracts/src/index.js';
import {
  amcPricingDefault,
  amcPricingV2Default,
} from '../../packages/db/src/pricing-config-defaults.js';

// amc-v2-core.js is a browser script (UMD); evaluate it with a stand-in module.
const source = readFileSync(new URL('../../apps/web/src/amc-v2-core.js', import.meta.url), 'utf8');
const mod: { exports: Record<string, any> } = { exports: {} };
new Function('module', source)(mod);
const core = mod.exports as {
  costPerVisit(cfg: unknown): number;
  visitCostPerAppliance(cfg: unknown): number;
  visitBreakdown(cfg: any): Record<string, number>;
  exampleRate(cfg: unknown, refValue: number, age: number): any;
  discountFor(cfg: unknown, qty: number): number;
  callOutTerms(cfg: unknown): Record<'basic' | 'standard' | 'premium', string>;
  computeQuote(cfg: unknown, lines: unknown[], age: number): any;
  computeOld(old: unknown, qty: number, value: number): any[];
};

const cfg = amcPricingV2Default;
const round = (n: number) => Math.round(n * 100) / 100;

test('default configuration passes the schema', () => {
  assert.doesNotThrow(() => amcPricingV2Schema.parse(cfg));
});

test('visit cost per appliance from the labour inputs', () => {
  // 4000 x 2 / 26 / 8 x 4 = 153.85 per visit; (153.85 + 100) / 8 = 31.73
  assert.equal(round(core.costPerVisit(cfg)), 153.85);
  assert.equal(round(core.visitCostPerAppliance(cfg)), 31.73);
});

test('volume ladder picks the highest step reached', () => {
  assert.equal(core.discountFor(cfg, 10), 0);
  assert.equal(core.discountFor(cfg, 25), 0);
  assert.equal(core.discountFor(cfg, 26), 0.05);
  assert.equal(core.discountFor(cfg, 300), 0.1);
  assert.equal(core.discountFor(cfg, 301), 0.15);
  assert.equal(core.discountFor(cfg, 1595), 0.2);
});

test('Standard and Premium unit rates are cost-plus; Basic is the retainer', () => {
  const q = core.computeQuote(cfg, [{ name: 'Oven', qty: 10, refValue: 1000 }], 0);
  const [basic, standard, premium] = q.plans;
  // Standard: (31.73 + 0.10 x 150 + 2.5% x 1,000 minor parts) x 1.1 x 1.3 = 102.58 per unit
  // for 10 units = 1,025.75, above the 8% cap of 10,000 = 800, so the cap applies.
  assert.equal(round(standard.lines[0].unitRate), 102.58);
  assert.equal(round(standard.listTotal), 1025.75);
  assert.equal(standard.capApplied, true);
  assert.equal(round(standard.priceExclVat), 800);
  // Premium: (63.46 + 15 + 45) x 1.43 = 176.55 per unit; cap 20% of 10,000 = 2000 not reached
  assert.equal(round(premium.lines[0].unitRate), 176.55);
  assert.equal(round(premium.priceInclVat), round(premium.priceExclVat * 1.05));
  // Basic: retainer 15 per unit
  assert.equal(basic.lines[0].unitRate, 15);
  assert.equal(basic.priceExclVat, 150);
  assert.equal(q.callOut.basicRate, 87.5);
  assert.equal(q.callOut.handlingCharge, 80);
});

test('age band scales breakdown cost and the parts reserve', () => {
  const young = core.computeQuote(cfg, [{ name: 'Oven', qty: 1, refValue: 1000 }], 0);
  const old = core.computeQuote(cfg, [{ name: 'Oven', qty: 1, refValue: 1000 }], 3);
  assert.ok(old.plans[1].lines[0].unitRate > young.plans[1].lines[0].unitRate);
  assert.equal(old.ageLabel, 'Year 7+');
  assert.equal(old.ageFactor, 1.5);
});

test('the cap wins and a price below cost raises the red warning with the shortfall', () => {
  // 1,595 appliances of value 817: Premium list is far above 20% cap? check cap logic directly
  const lines = [{ name: 'Mixed', qty: 1595, refValue: 817 }];
  const q = core.computeQuote(cfg, lines, 0);
  const premium = q.plans[2];
  assert.equal(q.discountPct, 0.2);
  assert.ok(premium.capApplied === premium.discountedTotal > premium.capTotal);
  // Force a tight cap: 3% on Premium
  const tight = {
    ...cfg,
    plans: { ...cfg.plans, premium: { ...cfg.plans.premium, capPct: 0.03 } },
  };
  const t = core.computeQuote(tight, lines, 0).plans[2];
  assert.equal(t.capApplied, true);
  assert.equal(round(t.priceExclVat), round(0.03 * 1595 * 817));
  const red = t.flags.find((f: any) => f.code === 'below-cost');
  assert.ok(red && red.level === 'red');
  assert.equal(round(red.shortfall), round(t.breakEvenTotal - t.priceExclVat));
});

test('rate override replaces the calculated rate for that appliance and plan only', () => {
  const withOverride = {
    ...cfg,
    rateOverrides: [{ name: 'oven', basic: null, standard: 55, premium: null }],
  };
  const q = core.computeQuote(withOverride, [{ name: 'Oven', qty: 2, refValue: 1000 }], 0);
  assert.equal(q.plans[1].lines[0].unitRate, 55);
  assert.equal(q.plans[1].lines[0].overridden, true);
  assert.equal(q.plans[0].lines[0].overridden, false);
  assert.equal(q.plans[1].priceExclVat, 110);
});

test('empty or zero quantities give no plans priced', () => {
  const q = core.computeQuote(cfg, [{ name: 'Oven', qty: 0, refValue: 1000 }], 0);
  assert.equal(q.totalQty, 0);
  assert.equal(q.plans[1].priceExclVat, 0);
  assert.deepEqual(q.plans[1].flags, []);
});

test('old-model helper reproduces the original calculator (1,595 appliances at 8/10/12 %)', () => {
  const old = {
    ...amcPricingDefault,
    basicPct: 0.08,
    standardPct: 0.1,
    premiumPct: 0.12,
    salary: 4000,
  };
  const plans = core.computeOld(old, 1595, 1302600);
  assert.deepEqual(
    plans.map((p: any) => Math.round(p.priceExclVat)),
    [104208, 130260, 156312],
  );
});

test('call-out wording follows the admin settings and Standard covers minor parts', () => {
  const terms = core.callOutTerms(cfg);
  assert.match(terms.basic, /AED 87\.50 per call \(normal rate AED 125\.00\)/);
  assert.match(terms.basic, /All spare parts are extra/);
  assert.match(terms.standard, /minor parts \(filters, belts, seals\) are included/);
  assert.match(terms.standard, /Major spare parts are extra/);
  assert.match(terms.premium, /except the compressor/);
  for (const text of Object.values(terms)) assert.match(text, /AED 80\.00 handling charge/);
});

test('planned-visit breakdown shows every step and follows the labour inputs', () => {
  const v = core.visitBreakdown(cfg);
  assert.equal(round(v.technicianPerHour), 19.23);
  assert.equal(round(v.teamPerHour), 38.46);
  assert.equal(round(v.labourPerVisit), 153.85);
  assert.equal(round(v.wholeVisit), 253.85);
  assert.equal(round(v.perAppliance), 31.73);
  assert.equal(round(v.standard), 31.73); // 1 visit
  assert.equal(round(v.premium), 63.46); // 2 visits
  const fewer = core.visitBreakdown({ ...cfg, labour: { ...cfg.labour, handledPerVisit: 4 } });
  assert.equal(round(fewer.perAppliance), 63.46);
  // zero working days must not produce Infinity/NaN on screen
  const broken = core.visitBreakdown({ ...cfg, labour: { ...cfg.labour, workingDays: 0 } });
  assert.ok(Number.isFinite(broken.perAppliance));
});

test('worked example for one appliance matches the calculator line by line', () => {
  const ex = core.exampleRate(cfg, 600, 0);
  // Standard: 31.73 visit + 15.00 breakdown + 15.00 parts (2.5% of 600) = 61.73
  assert.equal(round(ex.standard.direct), 61.73);
  assert.equal(round(ex.standard.parts), 15);
  assert.equal(round(ex.standard.breakEven), 67.9);
  assert.equal(round(ex.standard.price), 88.28);
  // Premium: 63.46 + 15.00 + 27.00 (4.5% of 600) = 105.46
  assert.equal(round(ex.premium.direct), 105.46);
  assert.equal(round(ex.premium.price), 150.81);
  const q = core.computeQuote(cfg, [{ name: 'X', qty: 1, refValue: 600 }], 0);
  assert.equal(round(q.plans[1].lines[0].unitRate), round(ex.standard.price));
  assert.equal(round(q.plans[2].lines[0].unitRate), round(ex.premium.price));
  // the price is break-even plus profit
  assert.equal(round(ex.standard.breakEven + ex.standard.profitAmount), round(ex.standard.price));
});
