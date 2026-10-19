import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { dandiFlatRateDefaults } from '../../packages/contracts/src/index.js';
import { createPricingConfigService } from '../../apps/api/src/pricing-config/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Invoices, Billing and Quote Calculators permissions exist and mirror the old access; flat rates round-trip',
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
      const codes = await pool.query<{ code: string }>(
        `SELECT code FROM permissions
         WHERE code IN ('invoices.read', 'invoices.write', 'billing.read', 'quote_calculators.use')`,
      );
      assert.equal(codes.rowCount, 4);

      // The migration copies access: any role that could open the page through the
      // old permission can still open it through the new one.
      const gaps = await pool.query<{ role: string; has: string; missing: string }>(
        `SELECT r.code AS role, old.code AS has, new.code AS missing
         FROM (VALUES
                 ('service_job_card.read', 'invoices.read'),
                 ('service_job_card.read', 'billing.read'),
                 ('service_job_card.write', 'invoices.write'),
                 ('pricing_config.read', 'quote_calculators.use')
              ) AS pair(old_code, new_code)
         JOIN permissions old ON old.code = pair.old_code
         JOIN permissions new ON new.code = pair.new_code
         JOIN role_permissions rp_old ON rp_old.permission_id = old.id
         JOIN roles r ON r.id = rp_old.role_id
         WHERE NOT EXISTS (
           SELECT 1 FROM role_permissions rp_new
           WHERE rp_new.role_id = r.id AND rp_new.permission_id = new.id
         )`,
      );
      assert.deepEqual(gaps.rows, []);

      // Flat job-type rates: defaults first, then a saved value, then reset.
      const service = createPricingConfigService(pool);
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Flat rates test') RETURNING id`,
        [`flat-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      const before = await service.get('dandi_pricing');
      const base = (await service.reset('dandi_pricing', profileId)).payload as Record<
        string,
        unknown
      >;
      assert.deepEqual(base.flatRates, dandiFlatRateDefaults);

      const saved = await service.save(
        'dandi_pricing',
        { ...base, flatRates: { CSIJW: 105, CSIJO: 119, CSIDO: 95, RWR: 55 } },
        profileId,
      );
      assert.deepEqual((saved.payload as { flatRates: unknown }).flatRates, {
        CSIJW: 105,
        CSIJO: 119,
        CSIDO: 95,
        RWR: 55,
      });
      assert.deepEqual(
        ((await service.get('dandi_pricing')).payload as { flatRates: unknown }).flatRates,
        { CSIJW: 105, CSIJO: 119, CSIDO: 95, RWR: 55 },
      );
      // A payload saved without flatRates (older client) gets the defaults, not a failure.
      const { flatRates: _dropped, ...withoutFlat } = base;
      const resaved = await service.save('dandi_pricing', withoutFlat, profileId);
      assert.deepEqual(
        (resaved.payload as { flatRates: unknown }).flatRates,
        dandiFlatRateDefaults,
      );
      // Leave the database as it was found.
      if (before.isOverride) await service.save('dandi_pricing', before.payload, profileId);
      else await service.reset('dandi_pricing', profileId);
    } finally {
      await pool.end();
    }
  },
);
