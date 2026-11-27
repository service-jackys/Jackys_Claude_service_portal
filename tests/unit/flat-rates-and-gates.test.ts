import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestHandler } from 'express';
import { dandiFlatRateDefaults, dandiPricingSchema } from '../../packages/contracts/src/index.js';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';
import {
  createPricingConfigHandlers,
  QUOTE_CALCULATOR_DOMAINS,
  redactForCalculator,
} from '../../apps/api/src/pricing-config/routes.js';
import { masterRates } from '../../apps/api/src/revenue-dashboard/logic-summary.js';
import {
  applyFlatRates,
  DEFAULT_PRICING_RULES,
} from '../../apps/api/src/revenue-dashboard/pricing-logic.js';

test('flat rates: the D+I Admin Entry values replace the workbook rates for the four flat job types only', () => {
  const rules = applyFlatRates(DEFAULT_PRICING_RULES, {
    CSIJW: 110,
    CSIJO: 130,
    CSIDO: 90,
    RWR: 65,
  });
  const price = (code: string) => rules.rates.find((r) => r.jobType === code)?.price;
  assert.equal(price('CSIJW'), 110);
  assert.equal(price('CSIJO'), 130);
  assert.equal(price('CSIDO'), 90);
  assert.equal(price('RWR'), 65);
  // CSIDI and CSIII are priced from the rate cards, so the workbook values stay.
  assert.equal(price('CSIDI'), 100);
  assert.equal(price('CSIII'), 60);
  // The input is not modified, and no flat rates means no change.
  assert.equal(DEFAULT_PRICING_RULES.rates.find((r) => r.jobType === 'CSIJO')?.price, 119);
  assert.equal(applyFlatRates(DEFAULT_PRICING_RULES, undefined), DEFAULT_PRICING_RULES);
});

test('flat rates: Logic applied shows the saved CSIJO rate instead of a hard-coded 125', () => {
  const custom = { ...dandiPricingDefault, flatRates: { ...dandiFlatRateDefaults, CSIJO: 119 } };
  const shown = masterRates(custom, DEFAULT_PRICING_RULES).jobRates;
  assert.equal(shown.find((r) => r.jobType === 'CSIJO')?.price, 119);
  assert.equal(
    masterRates(dandiPricingDefault, DEFAULT_PRICING_RULES).jobRates.find(
      (r) => r.jobType === 'CSIJO',
    )?.price,
    125,
  );
});

test('flat rates: an older D+I entry without flatRates still validates and gets the defaults', () => {
  const { flatRates: _omitted, ...older } = dandiPricingDefault;
  const parsed = dandiPricingSchema.parse(older);
  assert.deepEqual(parsed.flatRates, dandiFlatRateDefaults);
  assert.throws(() =>
    dandiPricingSchema.parse({ ...older, flatRates: { ...dandiFlatRateDefaults, CSIJO: -1 } }),
  );
  assert.throws(() =>
    dandiPricingSchema.parse({ ...older, flatRates: { ...dandiFlatRateDefaults, CSIXX: 5 } }),
  );
});

test('quote calculators can read only their own rate data without pricing_config.read', async () => {
  const used: string[] = [];
  const gate =
    (label: string): RequestHandler =>
    (_req, _res, next) => {
      used.push(label);
      next();
    };
  const handlers = createPricingConfigHandlers(
    {} as never,
    () => gate('pricing_config.read'),
    () => gate('pricing_config.read or quote_calculators.use'),
  );
  const run = async (domain: string) => {
    used.length = 0;
    await new Promise<void>((resolve) =>
      (handlers.get![0] as RequestHandler)({ params: { domain } } as never, {} as never, () =>
        resolve(),
      ),
    );
    return used[used.length - 1];
  };
  for (const domain of QUOTE_CALCULATOR_DOMAINS)
    assert.equal(await run(domain), 'pricing_config.read or quote_calculators.use', domain);
  // The rate card admin stays behind pricing_config.read.
  assert.equal(await run('rate_card'), 'pricing_config.read');
  assert.equal(await run('not_a_domain'), 'pricing_config.read');
});

test('the D+I calculator gets the rates but not our labour cost unless it may read the config', () => {
  const record = {
    payload: {
      minUnitRate: 35,
      laborCostPerHour: 43.27,
      laborMinutes: { fridge: 17.5, washer: 25, cooker: 25 },
      modes: { dandi: { rates: { fridge: { standard: 100 } } } },
    },
  };
  const redacted = redactForCalculator('dandi_pricing', record, false).payload as any;
  assert.equal(redacted.laborCostPerHour, 0);
  assert.deepEqual(redacted.laborMinutes, { fridge: 0, washer: 0, cooker: 0, dishwasher: 0 });
  assert.equal(redacted.minUnitRate, 35);
  assert.equal(redacted.modes.dandi.rates.fridge.standard, 100);
  // The original is untouched, and a config reader (or another domain) gets it as is.
  assert.equal((record.payload as any).laborCostPerHour, 43.27);
  assert.equal(redactForCalculator('dandi_pricing', record, true), record);
  assert.equal(redactForCalculator('thomson_pricing', record, false), record);
});

test('a D+I configuration saved before Dishwasher existed gets the dishwasher entries on read and restore', async () => {
  const { withDandiDishwasher, dandiPricingSchema } =
    await import('../../packages/contracts/src/index.js');
  const legacy = JSON.parse(JSON.stringify(dandiPricingDefault));
  delete legacy.capacities.dishwasher;
  delete legacy.laborMinutes.dishwasher;
  delete legacy.modes.dandi.rates.dishwasher;
  delete legacy.modes.install.rates.dishwasher;
  legacy.capacities.washer = 12;
  const filled = withDandiDishwasher(legacy) as typeof dandiPricingDefault;
  assert.equal(filled.capacities.dishwasher, 12);
  assert.equal(filled.laborMinutes.dishwasher, legacy.laborMinutes.washer);
  assert.deepEqual(filled.modes.dandi.rates.dishwasher, { batch: 60, standard: 100 });
  assert.deepEqual(filled.modes.install.rates.dishwasher, { batch: 60, standard: 60 });
  assert.equal(dandiPricingSchema.safeParse(legacy).success, true);
  // A value an admin already typed is never overwritten.
  const typed = JSON.parse(JSON.stringify(legacy));
  typed.modes.dandi.rates.dishwasher = { batch: 55, standard: 90 };
  const kept = withDandiDishwasher(typed) as typeof dandiPricingDefault;
  assert.deepEqual(kept.modes.dandi.rates.dishwasher, { batch: 55, standard: 90 });
});
