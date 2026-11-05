import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  amcPricingSchema,
  applianceMasterSchema,
  thomsonPricingSchema,
} from '../../packages/contracts/src/index.js';
import { createPricingConfigService } from '../../apps/api/src/pricing-config/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  amcPricingDefault,
  buildApplianceMaster,
  thomsonPricingDefault,
} from '../../packages/db/src/pricing-config-defaults.js';

const databaseUrl = process.env.DATABASE_URL;

test('Appliance Master default merges the AMC and Thomson lists and keeps AMC prices', () => {
  const master = buildApplianceMaster(amcPricingDefault, thomsonPricingDefault);
  assert.equal(master.appliances.length, 12);
  assert.doesNotThrow(() => applianceMasterSchema.parse(master));
  const hob = master.appliances.find((a) => a.name === 'Built-in Hob (30 cm)')!;
  assert.deepEqual(
    { amc: hob.amcEnabled, thomson: hob.thomsonEnabled, ref: hob.amcRefValue },
    { amc: true, thomson: true, ref: 1100 },
  );
  // The four appliances AMC never listed start without an AMC reference value.
  const microwave = master.appliances.find((a) => a.name === 'Built-in Microwave Oven')!;
  assert.deepEqual(
    { amc: microwave.amcEnabled, thomson: microwave.thomsonEnabled, ref: microwave.amcRefValue },
    { amc: false, thomson: true, ref: 0 },
  );
  assert.equal(master.appliances.filter((a) => a.amcEnabled).length, 8);
});

test('Master rejects duplicate names; AMC config no longer needs an appliance list', () => {
  const item = { amcEnabled: true, thomsonEnabled: true, amcRefValue: 1, active: true };
  assert.throws(() =>
    applianceMasterSchema.parse({
      appliances: [
        { name: 'Oven', ...item },
        { name: ' oven ', ...item },
      ],
    }),
  );
  const { appliances: _unused, ...withoutList } = amcPricingDefault;
  assert.doesNotThrow(() => amcPricingSchema.parse(withoutList));
  assert.doesNotThrow(() => amcPricingSchema.parse(amcPricingDefault));
});

test(
  'Appliance Master: first read is built from saved configs; saving syncs Thomson safely',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Appliance master test') RETURNING id`,
        [`master-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(`DELETE FROM pricing_configs WHERE domain = 'appliance_master'`);
      const thomsonBefore = await service.get('thomson_pricing');
      const amcBefore = await service.get('amc_pricing');
      try {
        // An AMC price the admin already saved must survive into the master.
        const amc = structuredClone(amcPricingDefault);
        amc.appliances![0]!.price = 777;
        await service.save('amc_pricing', amc, profileId);
        const first = await service.get('appliance_master');
        assert.equal(first.isOverride, false);
        const seeded = applianceMasterSchema.parse(first.payload);
        assert.equal(seeded.appliances.length, 12);
        assert.equal(
          seeded.appliances.find((a) => a.name === amc.appliances![0]!.name)!.amcRefValue,
          777,
        );

        // Add an appliance, retire another: Thomson gets a switched-off zero-rate
        // row for the new one, and the retired one is switched off. Existing
        // rates stay untouched.
        const edited = structuredClone(seeded);
        edited.appliances.push({
          name: 'Wine Cooler',
          amcEnabled: true,
          thomsonEnabled: true,
          amcRefValue: 3000,
          active: true,
        });
        edited.appliances.find((a) => a.name === 'Built-in Microwave Oven')!.active = false;
        await service.save('appliance_master', edited, profileId);

        const thomson = thomsonPricingSchema.parse((await service.get('thomson_pricing')).payload);
        const wine = thomson.appliances.find((a) => a.name === 'Wine Cooler')!;
        assert.deepEqual(wine.rates, { Base: 0, '50+': 0, '150+': 0, '300+': 0, '500+': 0 });
        assert.equal(wine.active, false);
        assert.equal(
          thomson.appliances.find((a) => a.name === 'Built-in Microwave Oven')!.active,
          false,
        );
        const hob = thomson.appliances.find((a) => a.name === 'Built-in Hob (30 cm)')!;
        assert.equal(hob.rates.Base, 78);
        assert.equal(hob.active, true);
        assert.equal(thomson.appliances.length, 13);

        // Rename a saved appliance: the Thomson row keeps its rates under the new
        // name, and renamedFrom is not stored in the master.
        const renamed = structuredClone(edited);
        const hobRow = renamed.appliances.find((a) => a.name === 'Built-in Hob (30 cm)')!;
        hobRow.name = 'Built-in Hob 30cm';
        hobRow.renamedFrom = 'Built-in Hob (30 cm)';
        const savedMaster = await service.save('appliance_master', renamed, profileId);
        const storedItems = (savedMaster.payload as { appliances: Record<string, unknown>[] })
          .appliances;
        assert.ok(storedItems.every((item) => !('renamedFrom' in item)));
        const afterRename = thomsonPricingSchema.parse(
          (await service.get('thomson_pricing')).payload,
        );
        assert.equal(afterRename.appliances.length, 13);
        assert.equal(
          afterRename.appliances.find((a) => a.name === 'Built-in Hob (30 cm)'),
          undefined,
        );
        assert.equal(
          afterRename.appliances.find((a) => a.name === 'Built-in Hob 30cm')!.rates.Base,
          78,
        );

        // Saving the same master again changes nothing in Thomson.
        await service.save('appliance_master', savedMaster.payload, profileId);
        const again = thomsonPricingSchema.parse((await service.get('thomson_pricing')).payload);
        assert.equal(again.appliances.length, 13);
      } finally {
        await pool.query(`DELETE FROM pricing_configs WHERE domain = 'appliance_master'`);
        await service.save('thomson_pricing', thomsonBefore.payload, profileId);
        await service.save('amc_pricing', amcBefore.payload, profileId);
        if (!thomsonBefore.isOverride) {
          await pool.query(`DELETE FROM pricing_configs WHERE domain = 'thomson_pricing'`);
        }
        if (!amcBefore.isOverride) {
          await pool.query(`DELETE FROM pricing_configs WHERE domain = 'amc_pricing'`);
        }
      }
    } finally {
      await pool.end();
    }
  },
);
