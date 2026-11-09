import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createThomsonSaleService } from '../../apps/api/src/thomson-sales/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const line = {
  region: 'Dubai',
  applianceName: 'Built-in Oven',
  qty: 100,
  siteVisits: 0,
  trainingSessions: 0,
  unitRate: 100,
  applianceSubtotal: 10000,
  addonRevenue: 0,
  transportCost: 240,
  totalPrice: 10000,
  totalCost: 3000,
  margin: 7000,
};

test(
  'a Thomson sale keeps the project schedule it was quoted on',
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
    const suffix = randomUUID().slice(0, 8);
    let profileId: string | undefined;
    let saleId: string | undefined;
    try {
      profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Thomson schedule') RETURNING id`,
          [`thomson-schedule-${suffix}@example.test`],
        )
      ).rows[0].id;
      const sales = createThomsonSaleService(pool);
      const schedule = {
        workMode: 'phased',
        technicians: 3,
        overtimeHours: 0,
        hoursPerDay: 8,
        workingDays: 6,
        waitingDays: 6,
        totalDays: 12,
        plannedStart: '2026-12-01',
        estimatedCompletion: '2026-12-17',
        phases: [
          {
            name: 'Block A',
            items: '34 × Built-in Oven',
            days: 2,
            waitBeforeDays: 0,
            readiness: 'confirmed',
          },
          {
            name: 'Block B',
            items: '66 × Built-in Oven',
            days: 4,
            waitBeforeDays: 3,
            readiness: 'assumed',
          },
        ],
      };
      const created = await sales.create(
        {
          clientName: `Schedule ${suffix}`,
          transportSharePercent: 0,
          lineItems: [line],
          totalPrice: 10000,
          totalCost: 3000,
          margin: 7000,
          schedule,
        },
        profileId,
        `thomson-schedule-${suffix}`,
      );
      saleId = created.id;
      const loaded = await sales.detail(created.id);
      assert.deepEqual(loaded.schedule, schedule);

      // Quotes issued without a schedule (single unit, older quotes) still save.
      const plain = await sales.create(
        {
          clientName: `Plain ${suffix}`,
          transportSharePercent: 100,
          lineItems: [line],
          totalPrice: 10000,
          totalCost: 3000,
          margin: 7000,
        },
        profileId,
        `thomson-plain-${suffix}`,
      );
      assert.equal((await sales.detail(plain.id)).schedule, null);
      await pool.query('DELETE FROM thomson_sales WHERE id = $1', [plain.id]);

      // A malformed schedule is rejected.
      await assert.rejects(
        sales.create(
          {
            transportSharePercent: 0,
            lineItems: [line],
            totalPrice: 1,
            totalCost: 1,
            margin: 0,
            schedule: { ...schedule, workMode: 'sometimes' },
          },
          profileId,
          `thomson-bad-${suffix}`,
        ),
      );
    } finally {
      if (saleId) await pool.query('DELETE FROM thomson_sales WHERE id = $1', [saleId]);
      if (profileId)
        await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]).catch(() => undefined);
      await pool.end();
    }
  },
);
