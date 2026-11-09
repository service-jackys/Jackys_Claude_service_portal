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
  qty: 10,
  siteVisits: 0,
  trainingSessions: 0,
  unitRate: 100,
  applianceSubtotal: 1000,
  addonRevenue: 0,
  transportCost: 60,
  totalPrice: 1000,
  totalCost: 500,
  margin: 500,
};

test(
  'a Thomson quote moves between Quote, Sold and Lost',
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
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Thomson status') RETURNING id`,
          [`thomson-status-${suffix}@example.test`],
        )
      ).rows[0].id;
      const sales = createThomsonSaleService(pool);
      const created = await sales.create(
        {
          clientName: `Status ${suffix}`,
          transportSharePercent: 0,
          lineItems: [line],
          totalPrice: 1000,
          totalCost: 500,
          margin: 500,
        },
        profileId,
        `thomson-status-${suffix}`,
      );
      saleId = created.id;
      assert.equal(created.status, 'Quote');

      const sold = await sales.setStatus(
        created.id,
        { status: 'Sold', soldDate: '2026-11-09' },
        profileId,
      );
      assert.equal(sold.status, 'Sold');
      assert.equal(sold.soldDate, '2026-11-09');

      const lost = await sales.setStatus(
        created.id,
        { status: 'Lost', reason: 'Price' },
        profileId,
      );
      assert.equal(lost.status, 'Lost');
      assert.equal(lost.lostReason, 'Price');
      assert.equal(lost.soldDate, null);

      const filtered = await sales.list({ status: 'Lost', search: `Status ${suffix}` });
      assert.equal(filtered.items.length, 1);
      const none = await sales.list({ status: 'Sold', search: `Status ${suffix}` });
      assert.equal(none.items.length, 0);

      const back = await sales.setStatus(created.id, { status: 'Quote' }, profileId);
      assert.equal(back.status, 'Quote');
      assert.equal(back.lostReason, null);

      await assert.rejects(sales.setStatus(created.id, { status: 'Sold' }, profileId));
      await assert.rejects(sales.setStatus('999999999', { status: 'Quote' }, profileId));
    } finally {
      if (saleId) await pool.query('DELETE FROM thomson_sales WHERE id = $1', [saleId]);
      if (profileId)
        await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]).catch(() => undefined);
      await pool.end();
    }
  },
);
