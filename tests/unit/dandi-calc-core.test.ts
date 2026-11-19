import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dandiPricingSchema } from '../../packages/contracts/src/index.js';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

// dandi-calc-core.js is a browser script (UMD); evaluate it with a stand-in module.
const source = readFileSync(
  new URL('../../apps/web/src/dandi-calc-core.js', import.meta.url),
  'utf8',
);
const mod: { exports: Record<string, any> } = { exports: {} };
new Function('module', source)(mod);
const core = mod.exports as {
  compute(cfg: unknown, input: Record<string, unknown>): any;
  discountFor(mode: unknown, total: number): { label: string; rate: number };
  requiredTrips(total: number): number;
};

const cfg = dandiPricingDefault;
const SAME = 'Same customer / same site';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

// A literal copy of the original Apps Script calculator (Index_v85 dandiCalculate_),
// used as the reference so the two portals cannot drift apart.
function oldCalc(
  c: any,
  modeKey: 'dandi' | 'install',
  regionName: string,
  grouping: string,
  sites: number,
  plannedTrips: number,
  crew: number,
  quantities: Record<string, number>,
  transportChoice: string,
) {
  const mode = c.modes[modeKey];
  const total = quantities.fridge + quantities.washer + quantities.cooker;
  const region = c.regions.find((r: any) => r.name === regionName);
  const eligible = total > 1 && total <= c.maxUnits && grouping === SAME && sites === 1;
  let tier = mode.discounts[0];
  mode.discounts.forEach((row: any) => {
    if (Math.min(total, c.maxUnits) >= row.min) tier = row;
  });
  const discount = eligible ? tier : { rate: 0 };
  const required = total === 0 ? 0 : total <= 17 ? 1 : 2;
  const transportYes = modeKey === 'dandi' ? total > 1 : transportChoice === 'Yes';
  const sufficient = modeKey !== 'dandi' || plannedTrips >= required;
  const factor = Number(c.crewFactors[crew] || 1);
  let crewAdjusted = 0;
  for (const key of ['fridge', 'washer', 'cooker']) {
    const rs = mode.rates[key];
    const rate = eligible ? rs.batch : rs.standard;
    const unit =
      total > c.maxUnits || !total ? 0 : Math.max(c.minUnitRate, rate * (1 - discount.rate));
    crewAdjusted += quantities[key] * unit * factor;
  }
  const transport =
    region && transportYes && total <= c.maxUnits ? plannedTrips * region.roundTripCost : 0;
  return total > 0 && total <= c.maxUnits && sufficient ? crewAdjusted + transport : 0;
}

test('the default D+I Admin configuration is valid', () => {
  assert.doesNotThrow(() => dandiPricingSchema.parse(cfg));
});

test('matches the original calculator on a grid of inputs', () => {
  const quantities = [0, 1, 2, 5, 8, 17, 18, 35, 50, 51];
  let checked = 0;
  for (const modeKey of ['dandi', 'install'] as const) {
    for (const region of ['Dubai', 'Sharjah']) {
      for (const grouping of cfg.groupings) {
        for (const sites of [1, 2]) {
          for (const trips of [1, 2, 3]) {
            for (const crew of [1, 2, 3]) {
              for (const transport of ['Yes', 'No']) {
                for (const f of quantities) {
                  const q = { fridge: f, washer: f > 4 ? 3 : 0, cooker: f > 8 ? 2 : 1 };
                  const mine = core.compute(cfg, {
                    mode: modeKey,
                    region,
                    grouping,
                    sites,
                    plannedTrips: trips,
                    crew,
                    transport,
                    qty: q,
                  });
                  close(
                    mine.totalCharge,
                    oldCalc(cfg, modeKey, region, grouping, sites, trips, crew, q, transport),
                  );
                  checked += 1;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 4320);
});

test('worked examples with the default rates', () => {
  // 10 fridges, same customer / same site, Dubai, D+I: batch rate 60, 10% discount
  // for 6-10 units -> unit 54; 10 x 54 = 540 + 1 trip x 60 transport = 600.
  const r = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 10, washer: 0, cooker: 0 },
  });
  assert.equal(r.eligible, true);
  assert.equal(r.discount.rate, 0.1);
  close(r.lines[0].unit, 54);
  close(r.lines[0].chargedUnit, 54);
  close(r.lines[0].lineTotal, 540);
  close(r.transport, 60);
  close(r.totalCharge, 600);
  close(r.averagePerUnit, 60);
  assert.equal(r.valid, true);

  // A single unit: standard rate, no discount, no transport for D+I.
  const one = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 1, washer: 0, cooker: 0 },
  });
  close(one.totalCharge, 100);
  assert.equal(one.transport, 0);

  // Installation Only with transport "No": labour only.
  const inst = core.compute(cfg, {
    mode: 'install',
    region: 'Sharjah',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    transport: 'No',
    qty: { fridge: 0, washer: 0, cooker: 2 },
  });
  close(inst.lines[2].unit, 70 * 0.95);
  close(inst.totalCharge, 2 * 70 * 0.95);
  assert.equal(inst.transport, 0);
});

test('the minimum unit rate and the unit limit are enforced', () => {
  const low = { ...cfg, minUnitRate: 70 };
  const r = core.compute(low, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 10, washer: 0, cooker: 0 },
  });
  close(r.lines[0].unit, 70);
  const over = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 2,
    crew: 2,
    qty: { fridge: 51, washer: 0, cooker: 0 },
  });
  assert.equal(over.valid, false);
  assert.match(over.blocked, /Maximum 50 units/);
  assert.equal(over.totalCharge, 0);
});

test('D+I needs enough planned trips; the crew factor scales the labour', () => {
  const short = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 18, washer: 0, cooker: 0 },
  });
  assert.equal(short.requiredTrips, 2);
  assert.equal(short.valid, false);
  assert.match(short.blocked, /Required trips: 2/);
  const big = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 3,
    qty: { fridge: 4, washer: 0, cooker: 0 },
  });
  close(big.lines[0].chargedUnit, big.lines[0].unit * 1.5);
  close(big.lines[0].qty * big.lines[0].chargedUnit, big.lines[0].lineTotal);
});

test('no discount outside one customer at one site', () => {
  const r = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: cfg.groupings[1],
    sites: 2,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 10, washer: 0, cooker: 0 },
  });
  assert.equal(r.eligible, false);
  close(r.lines[0].unit, 100);
  close(r.totalCharge, 1000 + 60);
});

test('the internal view reports labour cost and margin for D+I', () => {
  const r = core.compute(cfg, {
    mode: 'dandi',
    region: 'Dubai',
    grouping: SAME,
    sites: 1,
    plannedTrips: 1,
    crew: 2,
    qty: { fridge: 10, washer: 0, cooker: 0 },
  });
  close(r.estimatedCost, ((10 * 17.5) / 60) * cfg.laborCostPerHour + 60);
  close(r.margin, r.totalCharge - r.estimatedCost);
});

test('the maximum units per quote can be any whole number from 1 to 500', () => {
  for (const ok of [1, 50, 60, 100, 130, 500])
    assert.doesNotThrow(() => dandiPricingSchema.parse({ ...cfg, maxUnits: ok }), String(ok));
  for (const bad of [0, 501, 12.5, -5, '100'])
    assert.throws(() => dandiPricingSchema.parse({ ...cfg, maxUnits: bad }), String(bad));
});
