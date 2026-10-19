import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestHandler } from 'express';
import { dandiFlatRateDefaults, dandiPricingSchema } from '../../packages/contracts/src/index.js';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';
import {
  createPricingConfigHandlers,
  QUOTE_CALCULATOR_DOMAINS,
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
  // The internal cost inputs and the rate card admin stay behind pricing_config.read.
  assert.equal(await run('dandi_pricing'), 'pricing_config.read');
  assert.equal(await run('rate_card'), 'pricing_config.read');
  assert.equal(await run('not_a_domain'), 'pricing_config.read');
});
