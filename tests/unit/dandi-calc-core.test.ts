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
  KINDS: { key: string; label: string }[];
  fridgeGroupLabour(
    units: number,
    large: boolean,
    rates: unknown,
    f: unknown,
  ): { total: number; rule: string };
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

const base = {
  mode: 'dandi',
  region: 'Dubai',
  grouping: SAME,
  sites: 1,
  plannedTrips: 1,
  crew: 2,
};

test('an extra discount comes off the appliance charges, not the transport', () => {
  const r = core.compute(cfg, {
    ...base,
    qty: { fridge: 10, washer: 0, cooker: 0 },
    extra: { type: 'percent', value: 10 },
  });
  // 10 fridges at 54 = 540; 10% = 54 off; transport 60 stays.
  close(r.extra.requested, 54);
  close(r.extra.applied, 54);
  assert.equal(r.extra.capped, false);
  close(r.totalCharge, 540 - 54 + 60);
  close(r.lines[0].netUnit, 48.6);
  close(r.extra.lowestNetUnit, 48.6);
  // The same discount as an AED amount gives the same total.
  const amount = core.compute(cfg, {
    ...base,
    qty: { fridge: 10, washer: 0, cooker: 0 },
    extra: { type: 'amount', value: 54 },
  });
  close(amount.totalCharge, r.totalCharge);
});

test('an extra discount is cut back so no unit price goes below the minimum charge', () => {
  // Room = 10 x (54 - 35) = 190, however much is asked for.
  const r = core.compute(cfg, {
    ...base,
    qty: { fridge: 10, washer: 0, cooker: 0 },
    extra: { type: 'amount', value: 300 },
  });
  close(r.extra.max, 190);
  close(r.extra.applied, 190);
  assert.equal(r.extra.capped, true);
  close(r.extra.lowestNetUnit, 35);
  close(r.totalCharge, 540 - 190 + 60);
  // By percentage: 50% of 540 = 270 is over the room as well.
  const pct = core.compute(cfg, {
    ...base,
    qty: { fridge: 10, washer: 0, cooker: 0 },
    extra: { type: 'percent', value: 50 },
  });
  close(pct.extra.applied, 190);
  assert.equal(pct.extra.capped, true);
});

test('the discount is shared by room across lines and every unit stays at or above the minimum', () => {
  for (const ask of [0, 20, 100, 400, 5000]) {
    const r = core.compute(cfg, {
      ...base,
      plannedTrips: 2,
      qty: { fridge: 10, washer: 5, cooker: 4 },
      extra: { type: 'amount', value: ask },
    });
    const shared = r.lines.reduce((s: number, l: any) => s + l.extraDiscount, 0);
    close(shared, r.extra.applied);
    for (const l of r.lines.filter((x: any) => x.qty > 0))
      assert.ok(l.netUnit >= 35 - 1e-9, `${ask}`);
    close(r.totalCharge, r.crewAdjusted - r.extra.applied + r.transport);
  }
});

test('no room under the minimum means no extra discount', () => {
  const tight = { ...cfg, minUnitRate: 100 };
  const r = core.compute(tight, {
    ...base,
    qty: { fridge: 1, washer: 0, cooker: 0 },
    extra: { type: 'percent', value: 5 },
  });
  assert.equal(r.extra.max, 0);
  assert.equal(r.extra.applied, 0);
  assert.equal(r.extra.capped, true);
  close(r.totalCharge, 100);
});

test('no extra discount is the default and a quote that is not ready stays at zero', () => {
  const plain = core.compute(cfg, { ...base, qty: { fridge: 10, washer: 0, cooker: 0 } });
  assert.equal(plain.extra.applied, 0);
  assert.equal(plain.extra.capped, false);
  close(plain.totalCharge, 600);
  const blocked = core.compute(cfg, {
    ...base,
    qty: { fridge: 51, washer: 0, cooker: 0 },
    extra: { type: 'percent', value: 10 },
  });
  assert.equal(blocked.totalCharge, 0);
});

// --- New fridge and 13A/15A plug logic (modification #312) -------------------------------------
import { groupLabour } from '../../apps/api/src/revenue-dashboard/fridge-scenario.js';

const fl = {
  enabled: true,
  smallBase: 30,
  smallOver10: 20,
  smallMinimum: 20,
  optionB: true,
  plugAmount: 15,
};
const nbase = {
  mode: 'dandi',
  region: 'Dubai',
  grouping: SAME,
  sites: 1,
  plannedTrips: 1,
  crew: 2,
};
const q = (o: Record<string, number>) => ({
  fridge: 0,
  fridgeLarge: 0,
  washer: 0,
  cooker: 0,
  plug: 0,
  ...o,
});

test('new fridge logic: group prices, no discount tiers, plug on top', () => {
  const r = core.compute(cfg, {
    ...nbase,
    fridgeLogic: fl,
    qty: q({ fridge: 5, fridgeLarge: 2, cooker: 1, plug: 2 }),
  });
  const fr = r.lines.find((l: any) => l.key === 'fridge');
  const lg = r.lines.find((l: any) => l.key === 'fridgeLarge');
  close(fr.lineTotal, 150); // 5 x 30
  close(lg.lineTotal, 120); // 2 x 60 (the D+I batch rate)
  close(r.plug.total, 30);
  assert.equal(r.total, 8); // plugs are not units
  // cooker keeps its own batch rate and the 6-10 unit discount tier, as before
  const cooker = r.lines.find((l: any) => l.key === 'cooker');
  close(cooker.lineTotal, 80 * (1 - 0.1));
  close(r.totalCharge, 150 + 120 + cooker.lineTotal + 30 + 60); // + Dubai round trip
  close(r.averagePerUnit, (r.totalCharge - 30) / 8);
});

test('new fridge logic: one fridge is market, above 10 uses the second tier (Option B)', () => {
  const one = core.compute(cfg, { ...nbase, fridgeLogic: fl, qty: q({ fridge: 1, washer: 1 }) });
  close(one.lines.find((l: any) => l.key === 'fridge').lineTotal, 100);
  const many = core.compute(cfg, {
    ...nbase,
    plannedTrips: 2,
    fridgeLogic: fl,
    qty: q({ fridge: 12 }),
  });
  close(many.lines.find((l: any) => l.key === 'fridge').lineTotal, 10 * 30 + 2 * 20);
  const optionA = core.compute(cfg, {
    ...nbase,
    plannedTrips: 2,
    fridgeLogic: { ...fl, optionB: false },
    qty: q({ fridge: 12 }),
  });
  close(optionA.lines.find((l: any) => l.key === 'fridge').lineTotal, 12 * 20);
});

test('new fridge logic off or absent: one fridge box at the old prices, no plug', () => {
  const off = core.compute(cfg, {
    ...nbase,
    fridgeLogic: { ...fl, enabled: false },
    qty: q({ fridge: 2, fridgeLarge: 1, plug: 3 }),
  });
  const none = core.compute(cfg, { ...nbase, qty: { fridge: 3, washer: 0, cooker: 0 } });
  close(off.totalCharge, none.totalCharge);
  assert.equal(off.plug.total, 0);
  assert.equal(off.lines.length, 4);
});

test('fridges of different customers are not grouped: market rate per unit', () => {
  const r = core.compute(cfg, {
    ...nbase,
    grouping: 'Same customer / multiple sites',
    fridgeLogic: fl,
    qty: q({ fridge: 3 }),
  });
  close(r.lines.find((l: any) => l.key === 'fridge').lineTotal, 300);
});

test('calculator fridge group rule equals the dashboard and billing rule', () => {
  for (const large of [false, true]) {
    for (const optionB of [true, false]) {
      for (let n = 1; n <= 14; n++) {
        const rates = { market: 100, special: 60, minimum: 35 };
        const s = { ...fl, optionB };
        const a = core.fridgeGroupLabour(n, large, rates, s).total;
        const b = groupLabour(n, large, rates, s).total;
        close(a, b);
      }
    }
  }
});

test('dishwasher is a fourth appliance: 4 dishwashers delivered and installed, Dubai', () => {
  assert.ok(core.KINDS.some((k: { key: string }) => k.key === 'dishwasher'));
  const r = core.compute(cfg, {
    ...nbase,
    qty: { fridge: 0, washer: 0, cooker: 0, dishwasher: 4 },
  });
  assert.equal(r.total, 4);
  close(r.lines.find((l: { key: string }) => l.key === 'dishwasher').unit, 57);
  close(r.totalCharge, 4 * 57 + 60);
});
