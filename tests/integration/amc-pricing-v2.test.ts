import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { amcPricingV2Schema } from '../../packages/contracts/src/index.js';
import { createPricingConfigService } from '../../apps/api/src/pricing-config/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { amcPricingV2Default } from '../../packages/db/src/pricing-config-defaults.js';

const databaseUrl = process.env.DATABASE_URL;

test('AMC pricing v2 default is valid and rejects bad values', () => {
  assert.doesNotThrow(() => amcPricingV2Schema.parse(amcPricingV2Default));
  const bad = structuredClone(amcPricingV2Default);
  bad.plans.standard.capPct = 2;
  assert.throws(() => amcPricingV2Schema.parse(bad));
  // An older saved payload without referenceValues still parses.
  const { referenceValues: _omit, ...older } = amcPricingV2Default;
  assert.deepEqual(amcPricingV2Schema.parse(older).referenceValues, []);
  const noBands = structuredClone(amcPricingV2Default);
  noBands.ageBands = [];
  assert.throws(() => amcPricingV2Schema.parse(noBands));
});

test(
  'AMC pricing v2 saves, is separate from the original AMC config, and resets to default',
  { skip: !databaseUrl, concurrency: false },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    try {
      const service = createPricingConfigService(pool);
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'AMC v2 test') RETURNING id`,
        [`amcv2-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(`DELETE FROM pricing_configs WHERE domain = 'amc_pricing_v2'`);
      const amcBefore = await service.get('amc_pricing');

      const first = await service.get('amc_pricing_v2');
      assert.equal(first.isOverride, false);
      assert.deepEqual(first.payload, amcPricingV2Default);

      const edited = structuredClone(amcPricingV2Default);
      edited.plans.premium.capPct = 0.15;
      await service.save('amc_pricing_v2', edited, profileId);
      const saved = await service.get('amc_pricing_v2');
      assert.equal(saved.isOverride, true);
      assert.equal(amcPricingV2Schema.parse(saved.payload).plans.premium.capPct, 0.15);

      // The original AMC configuration is untouched.
      const amcAfter = await service.get('amc_pricing');
      assert.deepEqual(amcAfter.payload, amcBefore.payload);

      // Reference values saved with the AMC pricing master follow an Appliance Master rename.
      const withValues = structuredClone(edited);
      withValues.referenceValues = [{ name: 'Built-in Oven (60/90 cm)', refValue: 1300 }];
      await service.save('amc_pricing_v2', withValues, profileId);
      const master = await service.get('appliance_master');
      const items = (master.payload as { appliances: { name: string }[] }).appliances.map((a) =>
        a.name === 'Built-in Oven (60/90 cm)'
          ? { ...a, name: 'Built-in Oven XL', renamedFrom: 'Built-in Oven (60/90 cm)' }
          : a,
      );
      await service.save('appliance_master', { appliances: items }, profileId);
      const renamed = await service.get('amc_pricing_v2');
      assert.deepEqual((renamed.payload as typeof withValues).referenceValues, [
        { name: 'Built-in Oven XL', refValue: 1300 },
      ]);

      await assert.rejects(() =>
        service.save('amc_pricing_v2', { ...edited, overhead: -1 }, profileId),
      );
    } finally {
      await pool.query(
        `DELETE FROM pricing_configs WHERE domain IN ('amc_pricing_v2', 'appliance_master', 'thomson_pricing')`,
      );
      await pool.end();
    }
  },
);
