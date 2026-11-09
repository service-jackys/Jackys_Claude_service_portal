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
  'editing a Thomson quote keeps the reference, stores the old version and locks Sold quotes',
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
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'Thomson revise') RETURNING id`,
          [`thomson-revise-${suffix}@example.test`],
        )
      ).rows[0].id;
      const sales = createThomsonSaleService(pool);
      const created = await sales.create(
        {
          clientName: `Revise ${suffix}`,
          transportSharePercent: 0,
          lineItems: [line],
          totalPrice: 1000,
          totalCost: 500,
          margin: 500,
        },
        profileId,
      );
      saleId = created.id;
      assert.equal(created.revision, 1);
      assert.equal(created.editorState, null);

      const editorState = {
        mode: 'project',
        workMode: 'continuous',
        technicians: 2,
        overtimeHours: 0,
        lines: [
          {
            region: 'Dubai',
            applianceName: 'Built-in Oven',
            qty: 20,
            siteVisits: 0,
            trainingSessions: 0,
          },
        ],
        phases: [],
        addons: [{ name: 'Site Survey', rate: 50, hours: 1, on: true }],
      };
      // Overriding a unit rate needs the permission; without it the save is refused.
      const overridden = {
        transportSharePercent: 0,
        lineItems: [{ ...line, unitRate: 90, rateOverridden: true, tierRate: 100 }],
        totalPrice: 900,
        totalCost: 500,
        margin: 400,
      };
      await assert.rejects(sales.create(overridden, profileId), /permission to override/);
      await assert.rejects(
        sales.revise(created.id, overridden, profileId),
        /permission to override/,
      );
      const allowed = await sales.revise(created.id, overridden, profileId, undefined, true);
      assert.equal(allowed.revision, 2);
      assert.equal(allowed.lineItems[0].rateOverridden, true);
      await sales.revise(
        created.id,
        {
          transportSharePercent: 0,
          lineItems: [line],
          totalPrice: 1000,
          totalCost: 500,
          margin: 500,
        },
        profileId,
      );

      const revised = await sales.revise(
        created.id,
        {
          clientName: `Revise ${suffix}`,
          transportSharePercent: 0,
          lineItems: [{ ...line, qty: 20, totalPrice: 2000, totalCost: 1000, margin: 1000 }],
          totalPrice: 2000,
          totalCost: 1000,
          margin: 1000,
          editorState,
          revisionNote: 'Customer doubled the order',
        },
        profileId,
      );
      assert.equal(revised.thomsonSaleReference, created.thomsonSaleReference);
      assert.equal(revised.revision, 4);
      assert.equal(revised.revisionNote, 'Customer doubled the order');
      assert.equal(Number(revised.totalPrice), 2000);
      assert.equal((revised.editorState as { technicians: number }).technicians, 2);

      const history = await sales.revisions(created.id);
      assert.equal(history.length, 3);
      assert.equal(history[2].revision, 1);
      assert.equal(Number((history[2].snapshot as { totalPrice: number }).totalPrice), 1000);

      await sales.setStatus(created.id, { status: 'Sold', soldDate: '2026-11-09' }, profileId);
      await assert.rejects(
        sales.revise(
          created.id,
          {
            transportSharePercent: 0,
            lineItems: [line],
            totalPrice: 1000,
            totalCost: 500,
            margin: 500,
          },
          profileId,
        ),
        /Sold and locked/,
      );
      await sales.setStatus(created.id, { status: 'Quote' }, profileId);
      const again = await sales.revise(
        created.id,
        {
          transportSharePercent: 0,
          lineItems: [line],
          totalPrice: 1000,
          totalCost: 500,
          margin: 500,
        },
        profileId,
      );
      assert.equal(again.revision, 5);
      await assert.rejects(
        sales.revise(
          '999999999',
          {
            transportSharePercent: 0,
            lineItems: [line],
            totalPrice: 1,
            totalCost: 1,
            margin: 0,
          },
          profileId,
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
