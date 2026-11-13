import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDiJobService } from '../../apps/api/src/dandi-jobs/jobs-service.js';
import { createInvoiceService } from '../../apps/api/src/invoices/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Trip cap: Billing charges only the top trips of a salesman per service date; stored job figures stay full',
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
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const custCode = `DTC${tag}`;
    const branchName = `Cap Branch ${tag}`;
    const salesmanName = `Cap Salesman ${tag}`;
    const channel = `Cap Channel ${tag}`;
    const group = `CAP KETTLES ${tag}`;
    const fridge = `DTF-${tag}`;
    const kettle = `DTK-${tag}`;
    const savedRules = await pool.query(`SELECT * FROM di_transport_rules WHERE id = 1`);
    const setRules = (cap: boolean, deliveryCap: boolean, mixed: boolean, trips: number) =>
      pool.query(
        `INSERT INTO di_transport_rules (id, daily_cap, delivery_only_cap, mixed_invoice_transport, max_trips)
         VALUES (1, $1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET daily_cap = $1, delivery_only_cap = $2,
           mixed_invoice_transport = $3, max_trips = $4`,
        [cap, deliveryCap, mixed, trips],
      );
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I trip cap test') RETURNING id`,
        [`dtc-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(`INSERT INTO sales_channels (name) VALUES ($1)`, [channel]);
      await pool.query(`INSERT INTO salesmen (name, sales_channel) VALUES ($1, $2)`, [
        salesmanName,
        channel,
      ]);
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, $3)`,
        [custCode, branchName, salesmanName],
      );
      await pool.query(
        `INSERT INTO category_mappings (group_name, installable) VALUES ($1, false)`,
        [group],
      );
      for (const [code, g] of [
        [fridge, 'FRIDGE'],
        [kettle, group],
      ] as const) {
        await pool.query(
          `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
           VALUES ($1, 'Test item', 'MDA', $2, 'CAPBRAND')`,
          [code, g],
        );
      }
      const jobs = createDiJobService(pool);
      const invoices = createInvoiceService(pool);
      const range = { from: '2031-07-01', to: '2031-07-31' };
      const day = { serviceDate: '2031-07-10', custCode, region: 'Dubai' };

      await setRules(true, false, true, 2);

      // Four identical Delivery + Installation notes (2 units each: each carries one regional trip).
      const made: Array<Awaited<ReturnType<typeof jobs.complete>>['job']> = [];
      for (const n of [1, 2, 3, 4]) {
        const created = await jobs.create(
          {
            ...day,
            deliveryNoteRef: `${tag}-${n}`,
            lines: [{ itemCode: fridge, qty: 2, type: 'CSIDI' }],
          },
          profileId,
        );
        made.push((await jobs.complete(created.job.id, profileId)).job);
      }
      // A delivery-only note on the same day, outside the cap.
      const delivery = await jobs.create(
        {
          ...day,
          deliveryNoteRef: `${tag}-D`,
          lines: [{ itemCode: kettle, qty: 1, type: 'CSIDO' }],
        },
        profileId,
      );
      const deliveryDone = (await jobs.complete(delivery.job.id, profileId)).job;

      const full = made[0]!.totalRevenue;
      assert.ok(full > 0);
      assert.ok(
        made.every((j) => j.totalRevenue === full),
        'stored figures are the same full price',
      );

      const billed = async () => {
        const ledger = await invoices.ledger({ ...range, billTo: channel });
        const byRef = new Map<string, number>();
        const notes = new Map<string, string | null>();
        for (const row of ledger.rows) {
          const key = row.salesOrderNumber ?? '';
          byRef.set(key, (byRef.get(key) ?? 0) + row.billedAmount);
          if (row.transportNote) notes.set(key, row.transportNote);
        }
        return { ledger, byRef, notes };
      };

      // Cap ON, 2 trips: notes 1 and 2 (equal charge, lowest ERP delivery note first) are charged in full.
      let { byRef, notes } = await billed();
      const cents = (n: number) => Math.round(n * 100);
      assert.equal(cents(byRef.get(`${tag}-1`)!), cents(full));
      assert.equal(cents(byRef.get(`${tag}-2`)!), cents(full));
      const transport = made[0]!.totalRevenue - (byRef.get(`${tag}-3`) ?? 0);
      assert.ok(transport > 0, 'trip 3 loses its transport');
      assert.equal(cents(byRef.get(`${tag}-4`)!), cents(byRef.get(`${tag}-3`)!));
      assert.ok(notes.get(`${tag}-3`)?.includes('not charged'));
      assert.ok(notes.get(`${tag}-4`)?.includes('not charged'));
      assert.equal(notes.has(`${tag}-1`), false);
      assert.equal(notes.has(`${tag}-2`), false);
      // Delivery only stays outside the cap.
      assert.equal(cents(byRef.get(`${tag}-D`)!), cents(deliveryDone.totalRevenue));

      // The comparison and the stored job keep reading consistently: the job itself is untouched.
      const stored = await pool.query<{ total: string }>(
        `SELECT sum(revenue) AS total FROM di_job_lines WHERE job_id = $1`,
        [made[2]!.id],
      );
      assert.equal(cents(Number(stored.rows[0]!.total)), cents(full));

      // Cap OFF: everything is charged in full again.
      await setRules(false, false, true, 2);
      ({ byRef } = await billed());
      for (const n of [1, 2, 3, 4]) assert.equal(cents(byRef.get(`${tag}-${n}`)!), cents(full));

      // Three trips allowed: only the fourth loses its transport.
      await setRules(true, false, true, 3);
      ({ byRef } = await billed());
      for (const n of [1, 2, 3]) assert.equal(cents(byRef.get(`${tag}-${n}`)!), cents(full));
      assert.ok(byRef.get(`${tag}-4`)! < full);

      // Delivery-only cap ON: delivery trips are capped among themselves (one trip here, so still charged).
      await setRules(true, true, true, 2);
      ({ byRef } = await billed());
      assert.equal(cents(byRef.get(`${tag}-D`)!), cents(deliveryDone.totalRevenue));

      // Own rules: the Service Revenue Dashboard's rules do not change Billing.
      await setRules(true, false, true, 2);
      const dash = await pool.query(`SELECT * FROM revenue_transport_rules WHERE id = 1`);
      await pool.query(`UPDATE revenue_transport_rules SET daily_cap = false WHERE id = 1`);
      try {
        ({ byRef } = await billed());
        assert.ok(
          byRef.get(`${tag}-3`)! < full,
          'D&I cap still applies when the dashboard cap is off',
        );
      } finally {
        await pool.query(`UPDATE revenue_transport_rules SET daily_cap = $1 WHERE id = 1`, [
          dash.rows[0]?.daily_cap ?? true,
        ]);
      }

      // The service: read, save (delivery-only cap needs the daily cap), impact lists the day.
      const before = await jobs.transportRules();
      assert.equal(before.rules.maxTrips, 2);
      const overDay = before.impact.days.find((d) =>
        d.trips.some((t) => t.reference === made[0]!.reference),
      );
      assert.ok(overDay, 'the salesperson-day over the cap is listed');
      assert.equal(overDay!.trips.filter((t) => !t.charged).length, 2);
      assert.ok(before.impact.tripsNotCharged >= 2);
      const saved = await jobs.saveTransportRules(
        { dailyCap: false, deliveryOnlyCap: true, mixedInvoiceTransport: true },
        profileId,
      );
      assert.equal(saved.rules.dailyCap, false);
      assert.equal(saved.rules.deliveryOnlyCap, false);
      ({ byRef } = await billed());
      for (const n of [1, 2, 3, 4]) assert.equal(cents(byRef.get(`${tag}-${n}`)!), cents(full));
      await assert.rejects(() => jobs.saveTransportRules({ dailyCap: 'yes' }, profileId));
    } finally {
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = $1`, [branchName]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [salesmanName]);
      await pool.query(`DELETE FROM sales_channels WHERE name = $1`, [channel]);
      await pool.query(`DELETE FROM stock_master WHERE item_code = ANY($1::text[])`, [
        [fridge, kettle],
      ]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [group]);
      const r = savedRules.rows[0] as
        | {
            daily_cap: boolean;
            delivery_only_cap: boolean;
            mixed_invoice_transport: boolean;
            max_trips: number;
          }
        | undefined;
      if (r) {
        await pool.query(
          `UPDATE di_transport_rules SET daily_cap = $1, delivery_only_cap = $2,
             mixed_invoice_transport = $3, max_trips = $4 WHERE id = 1`,
          [r.daily_cap, r.delivery_only_cap, r.mixed_invoice_transport, r.max_trips],
        );
      }
      await pool.end();
    }
  },
);
