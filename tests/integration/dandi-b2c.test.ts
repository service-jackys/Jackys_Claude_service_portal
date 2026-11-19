import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createDiJobService,
  DiJobServiceError,
} from '../../apps/api/src/dandi-jobs/jobs-service.js';
import { queryBillingLedger } from '../../packages/db/src/billing-ledger.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Delivery & installation B2C jobs: typed customer, phone required, same price as B2B, ledger shows B2C',
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
    const custCode = `DBC${tag}`;
    const branchName = `Test B2C Branch ${tag}`;
    const b2cName = `Test Person ${tag}`;
    const salesman = `B2C Salesman ${tag}`;
    const item = `DBC-${tag}`;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I B2C test') RETURNING id`,
        [`dbc-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, $3)`,
        [custCode, branchName, salesman],
      );
      await pool.query(`INSERT INTO salesmen (name, sales_channel) VALUES ($1, 'JDI')`, [salesman]);
      await pool.query(
        `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
         VALUES ($1, 'Test fridge', 'MDA', 'FRIDGE', 'TESTBRAND')`,
        [item],
      );
      const service = createDiJobService(pool);
      const lines = [{ itemCode: item, qty: 2, type: 'CSIDI' as const }];
      const common = { serviceDate: '2026-10-21', region: 'Dubai', salesman, lines };

      // An old-style save (no customer type) is B2B, exactly as before.
      const b2b = await service.create(
        { ...common, custCode, deliveryNoteRef: `DN-B-${tag}`, technicianName: 'Tech One' },
        profileId,
      );
      assert.equal(b2b.job.customerType, 'B2B');
      assert.equal(b2b.job.customerName, branchName);
      assert.equal(b2b.job.technicianName, 'Tech One');

      // B2C: the typed name and phone are kept; no B2B customer is attached.
      const b2c = await service.create(
        {
          ...common,
          customerType: 'B2C',
          customerName: `  ${b2cName} `,
          deliveryNoteRef: `DN-C-${tag}`,
        },
        profileId,
      );
      assert.equal(b2c.job.customerType, 'B2C');
      assert.equal(b2c.job.customerName, b2cName);
      assert.equal(b2c.job.custCode, null);

      // Completing a B2C job needs the phone number.
      await assert.rejects(service.complete(b2c.job.id, profileId), (error: unknown) => {
        assert.ok(error instanceof DiJobServiceError);
        assert.equal(error.code, 'incomplete');
        assert.deepEqual(error.messages, ['Enter the customer phone number.']);
        return true;
      });
      await service.update(
        b2c.job.id,
        {
          ...common,
          customerType: 'B2C',
          customerName: b2cName,
          customerPhone: '050 111 2222',
          deliveryNoteRef: `DN-C-${tag}`,
        },
        profileId,
      );
      const doneC = await service.complete(b2c.job.id, profileId);
      const doneB = await service.complete(b2b.job.id, profileId);
      assert.equal(doneC.job.customerPhone, '050 111 2222');

      // The customer type changes nothing in the price or the revenue.
      assert.equal(doneC.job.totalRevenue, doneB.job.totalRevenue);
      assert.equal(doneC.job.totalCsidi, doneB.job.totalCsidi);
      assert.equal(doneC.job.lines[0]!.revenue, doneB.job.lines[0]!.revenue);
      assert.equal(doneC.job.lines[0]!.salesChannel, doneB.job.lines[0]!.salesChannel);

      // Billing ledger: the B2B row is unchanged, the B2C row says B2C and has no branch.
      const client = await pool.connect();
      try {
        const ledger = await queryBillingLedger(client, { from: '2026-10-21', to: '2026-10-21' });
        const rowOf = (ref: string) => ledger.rows.find((r) => r.jobCardReference === ref);
        const b = rowOf(doneB.job.reference)!;
        const c = rowOf(doneC.job.reference)!;
        assert.equal(b.customerType, 'B2B');
        assert.equal(c.customerType, 'B2C');
        assert.equal(c.customerName, b2cName);
        assert.equal(c.jobTotal, b.jobTotal);
        assert.equal(c.grandTotal, b.grandTotal);
        assert.equal(c.payer, b.payer);
      } finally {
        client.release();
      }
    } finally {
      await pool.query(`DELETE FROM di_jobs WHERE customer_name = ANY($1::text[])`, [
        [branchName, b2cName],
      ]);
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.query(`DELETE FROM salesmen WHERE name = $1`, [salesman]);
      await pool.query(`DELETE FROM stock_master WHERE item_code = $1`, [item]);
      await pool.end();
    }
  },
);
