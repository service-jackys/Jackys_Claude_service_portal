import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

// dandi-tiers.js is a browser script (UMD); evaluate it with a stand-in module.
const source = readFileSync(new URL('../../apps/web/src/dandi-tiers.js', import.meta.url), 'utf8');
const mod: { exports: Record<string, any> } = { exports: {} };
new Function('module', source)(mod);
const tiers = mod.exports as {
  maxDiscount(minUnitRate: number, lowestBatchRate: number): number;
  resplit(
    rows: unknown[],
    maxUnits: number,
    opts?: { minUnitRate: number; lowestBatchRate: number },
  ): {
    tiers: { min: number; max: number; label: string; rate: number }[];
    added: number;
    cap: number | null;
  };
};

const base = dandiPricingDefault.modes.dandi.discounts; // 1, 2-5, 6-10, 11-20, 21-30, 31-40, 41-50

test('a bigger maximum adds 10-unit ranges that start at the last discount', () => {
  const r = tiers.resplit(base, 100);
  assert.equal(r.added, 5);
  assert.deepEqual(
    r.tiers.slice(-5).map((t) => [t.min, t.max, t.label, t.rate]),
    [
      [51, 60, '51–60 units', 0.22],
      [61, 70, '61–70 units', 0.22],
      [71, 80, '71–80 units', 0.22],
      [81, 90, '81–90 units', 0.22],
      [91, 100, '91–100 units', 0.22],
    ],
  );
  // The existing tiers are untouched.
  assert.deepEqual(r.tiers.slice(0, 7), base);
});

test('50 to 60 adds one range; the same maximum changes nothing', () => {
  const r = tiers.resplit(base, 60);
  assert.equal(r.added, 1);
  assert.deepEqual(r.tiers[r.tiers.length - 1], {
    min: 51,
    max: 60,
    label: '51–60 units',
    rate: 0.22,
  });
  const same = tiers.resplit(base, 50);
  assert.equal(same.added, 0);
  assert.deepEqual(same.tiers, base);
});

test('a smaller maximum drops tiers beyond it and trims the last one', () => {
  const big = tiers.resplit(base, 100).tiers;
  assert.deepEqual(tiers.resplit(big, 50).tiers, base);
  const trimmed = tiers.resplit(base, 35);
  assert.deepEqual(trimmed.tiers[trimmed.tiers.length - 1], {
    min: 31,
    max: 35,
    label: '31–35 units',
    rate: 0.2,
  });
  assert.equal(trimmed.added, 0);
});

test('percentages the user set are kept, and custom labels are not renamed', () => {
  const custom = base.map((t) => (t.min === 41 ? { ...t, rate: 0.3, label: 'Bulk' } : t));
  const r = tiers.resplit(custom, 100);
  assert.equal(r.tiers.find((t) => t.min === 41)!.rate, 0.3);
  assert.equal(r.tiers.find((t) => t.min === 51)!.rate, 0.3);
  const cut = tiers.resplit(custom, 45);
  assert.equal(cut.tiers[cut.tiers.length - 1].label, 'Bulk');
  assert.equal(cut.tiers[cut.tiers.length - 1].max, 45);
});

test('an empty table gets a single range up to the maximum', () => {
  const r = tiers.resplit([], 60);
  assert.deepEqual(r.tiers, [{ min: 1, max: 60, label: '1–60 units', rate: 0 }]);
});

test('the calculator uses the new ranges once the maximum is 100', () => {
  const coreSource = readFileSync(
    new URL('../../apps/web/src/dandi-calc-core.js', import.meta.url),
    'utf8',
  );
  const coreMod: { exports: Record<string, any> } = { exports: {} };
  new Function('module', coreSource)(coreMod);
  const calc = coreMod.exports as { compute(cfg: unknown, input: unknown): any };
  const resplit = (m: any) => ({
    ...m,
    discounts: tiers
      .resplit(m.discounts, 100)
      .tiers.map((t) => (t.min === 71 ? { ...t, rate: 0.3 } : t)),
  });
  const cfg = {
    ...dandiPricingDefault,
    maxUnits: 100,
    modes: {
      dandi: resplit(dandiPricingDefault.modes.dandi),
      install: resplit(dandiPricingDefault.modes.install),
    },
  };
  const quote = (fridges: number) =>
    calc.compute(cfg, {
      mode: 'dandi',
      region: 'Dubai',
      grouping: 'Same customer / same site',
      sites: 1,
      plannedTrips: 2,
      crew: 2,
      qty: { fridge: fridges, washer: 0, cooker: 0 },
    });
  assert.equal(quote(75).discount.label, '71–80 units');
  assert.equal(quote(75).discount.rate, 0.3);
  assert.equal(quote(55).discount.label, '51–60 units');
  assert.equal(quote(100).valid, true);
  assert.equal(quote(101).valid, false);
});

test('new ranges rise 2 points a range and stop where the minimum unit charge allows', () => {
  // D+I default: lowest batch rate 60, minimum 35 -> the largest whole % is 41.
  assert.equal(tiers.maxDiscount(35, 60), 0.41);
  const di = tiers.resplit(base, 100, { minUnitRate: 35, lowestBatchRate: 60 });
  assert.equal(di.cap, 0.41);
  assert.deepEqual(
    di.tiers.slice(-5).map((t) => t.rate),
    [0.24, 0.26, 0.28, 0.3, 0.32],
  );
  // From a last tier of 25%, the five ranges reach 35%.
  const from25 = base.map((t) => (t.min === 41 ? { ...t, rate: 0.25 } : t));
  assert.deepEqual(
    tiers
      .resplit(from25, 100, { minUnitRate: 35, lowestBatchRate: 60 })
      .tiers.slice(-5)
      .map((t) => t.rate),
    [0.27, 0.29, 0.31, 0.33, 0.35],
  );
  // Installation Only: lowest batch 55 -> cap 36%, reached and then held.
  assert.equal(tiers.maxDiscount(35, 55), 0.36);
  const inst = tiers.resplit(from25, 100, { minUnitRate: 35, lowestBatchRate: 55 });
  assert.deepEqual(
    inst.tiers.slice(-5).map((t) => t.rate),
    [0.27, 0.29, 0.31, 0.33, 0.35],
  );
  const longer = tiers.resplit(from25, 150, { minUnitRate: 35, lowestBatchRate: 55 });
  assert.deepEqual(
    longer.tiers.slice(-10).map((t) => t.rate),
    [0.27, 0.29, 0.31, 0.33, 0.35, 0.36, 0.36, 0.36, 0.36, 0.36],
  );
});

test('a discount never leaves a unit price below the minimum charge', () => {
  const rows = tiers.resplit(base, 500, { minUnitRate: 35, lowestBatchRate: 60 }).tiers;
  for (const t of rows)
    assert.ok((rows.length && t.rate <= 0.41) || t.min <= 50, JSON.stringify(t));
  for (const t of rows.filter((x) => x.min > 50)) assert.ok(60 * (1 - t.rate) >= 35 - 1e-9);
});

test('no room under the minimum means no extra discount; a higher saved % is kept', () => {
  assert.equal(tiers.maxDiscount(60, 60), 0);
  assert.equal(tiers.maxDiscount(70, 60), 0);
  const tight = tiers.resplit(base, 60, { minUnitRate: 50, lowestBatchRate: 60 });
  // The cap is 16% but the saved last tier is already 22%: it is kept, not cut.
  assert.equal(tight.tiers[tight.tiers.length - 1].rate, 0.22);
});
