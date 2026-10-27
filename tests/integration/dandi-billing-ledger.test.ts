import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDiJobService } from '../../apps/api/src/dandi-jobs/jobs-service.js';
import { createInvoiceService } from '../../apps/api/src/invoices/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Billing ledger: Completed Delivery & Installation lines are internal billing to the line channel; Draft, Cancelled and reopened jobs are not',
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
    const custCode = `DBL${tag}`;
    const branchName = `Billing Branch ${tag}`;
    const salesmanName = `Billing Salesman ${tag}`;
    const channel = `Billing Channel ${tag}`;
    const group = `BILLING KETTLES ${tag}`;
    const fridge = `DBF-${tag}`;
    const kettle = `DBK-${tag}`;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I billing test') RETURNING id`,
        [`dbl-${randomUUID()}@example.test`],
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
           VALUES ($1, 'Test item', 'MDA', $2, 'BILLBRAND')`,
          [code, g],
        );
      }
      const jobs = createDiJobService(pool);
      const invoices = createInvoiceService(pool);
      const range = { from: '2031-06-01', to: '2031-06-30' };
      const header = { serviceDate: '2031-06-10', custCode, region: 'Dubai' };

      const done = await jobs.create(
        {
          ...header,
          deliveryNoteRef: `DBN-${tag}`,
          lines: [
            { itemCode: fridge, qty: 2, type: 'CSIDI' },
            { itemCode: kettle, qty: 3, type: 'CSIDO' },
          ],
        },
        profileId,
      );
      const draft = await jobs.create(
        {
          ...header,
          deliveryNoteRef: `DBD-${tag}`,
          lines: [{ itemCode: fridge, qty: 1, type: 'CSIDI' }],
        },
        profileId,
      );
      const completed = (await jobs.complete(done.job.id, profileId)).job;
      assert.ok(completed.totalRevenue > 0);

      const ledger = await invoices.ledger({ ...range, search: done.job.reference });
      const mine = ledger.rows.filter((r) => r.jobCardReference === done.job.reference);
      assert.equal(mine.length, 2, 'one row per line with revenue');
      for (const row of mine) {
        assert.equal(row.source, 'dandi');
        assert.equal(row.stage, 'Internal billing');
        assert.equal(row.billTo, channel);
        assert.equal(row.payer, 'Sales channel');
        assert.equal(row.salesOrderNumber, `DBN-${tag}`);
        assert.equal(row.brand, 'BILLBRAND');
        assert.equal(row.sourceRef, done.job.id);
        assert.equal(row.jobFinalStatus, 'Completed');
        // Each line says what else the job holds, and the job's whole revenue.
        assert.equal(row.otherTypes, row.billingJobType === 'CSIDI' ? 'CSIDO' : 'CSIDI');
        assert.equal(
          Math.round((row.jobTotal ?? 0) * 100),
          Math.round(completed.totalRevenue * 100),
        );
      }
      assert.deepEqual(mine.map((r) => r.billingJobType).sort(), ['CSIDI', 'CSIDO']);
      const sum = mine.reduce((n, r) => n + r.billedAmount, 0);
      assert.equal(Math.round(sum * 100), Math.round(completed.totalRevenue * 100));

      // Draft jobs are not billing.
      const all = await invoices.ledger({ ...range, billTo: channel });
      assert.equal(
        all.rows.some((r) => r.jobCardReference === draft.job.reference),
        false,
      );
      assert.equal(all.rows.length, 2);

      // Filters, totals, statement and allocation include it.
      const byType = await invoices.ledger({ ...range, billTo: channel, type: 'CSIDO' });
      assert.equal(byType.rows.length, 1);
      const internal = await invoices.ledger({
        ...range,
        billTo: channel,
        stage: 'Internal billing',
      });
      assert.equal(internal.rows.length, 2);
      assert.equal(Math.round(internal.totals.internalAmount * 100), Math.round(sum * 100));
      assert.equal(internal.totals.invoicedAmount, 0);
      assert.equal(internal.totals.notInvoicedAmount, 0);
      assert.ok(all.billToOptions.includes(channel));
      assert.equal(all.statement[0]!.billTo, channel);
      assert.equal(all.statement[0]!.nonWarrantyAmount, all.statement[0]!.billedAmount);
      assert.equal(all.allocation[0]!.brand, 'BILLBRAND');
      const customerPays = await invoices.ledger({ ...range, payer: 'Customer', billTo: channel });
      assert.equal(customerPays.rows.length, 0);

      // The export has them too.
      const file = await invoices.exportLedger({ ...range, billTo: channel }, profileId);
      assert.ok(file.buffer.length > 1000);

      // A reopened job drops out until it is completed again; a cancelled one stays out.
      await jobs.reopen(done.job.id, profileId);
      assert.equal((await invoices.ledger({ ...range, billTo: channel })).rows.length, 0);
      await jobs.complete(done.job.id, profileId);
      assert.equal((await invoices.ledger({ ...range, billTo: channel })).rows.length, 2);
      await jobs.cancel(done.job.id, profileId, true);
      assert.equal((await invoices.ledger({ ...range, billTo: channel })).rows.length, 0);
    } finally {
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = $1`, [branchName]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [salesmanName]);
      await pool.query(`DELETE FROM sales_channels WHERE name = $1`, [channel]);
      await pool.query(`DELETE FROM stock_master WHERE item_code = ANY($1::text[])`, [
        [fridge, kettle],
      ]);
      await pool.query(`DELETE FROM category_mappings WHERE group_name = $1`, [group]);
      await pool.end();
    }
  },
);
