import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { buildOpsSnapshot } from '../../apps/api/src/ai/ops-snapshot.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'the AI portal snapshots hold counts and statuses only, never personal details',
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
    const real = createDbPool(databaseUrl);
    // One transaction that is rolled back, so real records are never touched.
    const client = await real.connect();
    const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM complaints');
      const add = (ref: string, status: string, brand: string) =>
        client.query(
          `INSERT INTO complaints (complaint_reference, customer_type, customer_name, contact_number, description, status, brand, region, warranty_classification)
           VALUES ($1, 'B2C', 'Secret Person', '0500000000', 'Secret description', $2, $3, 'Dubai', 'In Warranty')`,
          [ref, status, brand],
        );
      await add('CMP-202611-001', 'New', 'Bosch');
      await add('CMP-202611-002', 'New', 'Bosch');
      await add('CMP-202611-003', 'Closed', 'Thomson');

      const snap = (await buildOpsSnapshot(pool as unknown as Pool, 'complaints')) as any;
      assert.equal(snap.total, 3);
      assert.deepEqual(
        snap.byStatus.map((r: any) => [r.status, r.n]),
        [
          ['New', 2],
          ['Closed', 1],
        ],
      );
      assert.equal(snap.openByAge[0].n, 2);
      assert.deepEqual(
        snap.byBrand.map((r: any) => [r.brand, r.n]),
        [
          ['Bosch', 2],
          ['Thomson', 1],
        ],
      );
      assert.ok(!JSON.stringify(snap).includes('Secret'));
      assert.equal(await buildOpsSnapshot(pool as unknown as Pool, 'nope'), null);

      await client.query('DELETE FROM appointments');
      const addApt = (n: number, status: string, offsetDays: number) =>
        client.query(
          `INSERT INTO appointments (appointment_reference, customer_type, customer_name, contact_number, fault_description, appointment_date, status, closed_at, brand, region, job_warranty)
           VALUES ($1, 'B2C', 'Secret Person', '0500000000', 'Secret fault', current_date + $2::int, $3,
                   CASE WHEN $3 IN ('Completed','Cancelled') THEN now() END, 'Bosch', 'Dubai', 'In Warranty')`,
          ['APT-2026-0000' + n, offsetDays, status],
        );
      await addApt(1, 'Scheduled', -2);
      await addApt(2, 'Scheduled', 0);
      await addApt(3, 'In Progress', 3);
      await addApt(4, 'Completed', -5);
      const apt = (await buildOpsSnapshot(pool as unknown as Pool, 'appointments')) as any;
      assert.equal(apt.total, 4);
      assert.deepEqual(Object.fromEntries(apt.openByDueDate.map((r: any) => [r.due, r.n])), {
        Overdue: 1,
        Today: 1,
        'Next 7 days': 1,
      });
      assert.equal(apt.openWithoutTechnician, 3);
      assert.equal(apt.byBrand[0].n, 4);
      assert.ok(!JSON.stringify(apt).includes('Secret'));

      await client.query('DELETE FROM service_job_cards');
      const apts = await client.query('SELECT id FROM appointments ORDER BY id');
      const addJob = (n: number, appointmentId: string, jobStatus: string) =>
        client.query(
          `INSERT INTO service_job_cards (job_card_reference, appointment_id, customer_name, customer_contact, complaint, job_final_status, brand, customer_type)
           VALUES ($1, $2, 'Secret Person', '0500000000', 'Secret complaint', $3, 'Bosch', 'B2C')`,
          ['JBC-2026-0000' + n, appointmentId, jobStatus],
        );
      await addJob(1, apts.rows[0].id, 'WIP');
      await addJob(2, apts.rows[1].id, 'Spare pending');
      await addJob(3, apts.rows[2].id, 'Cancelled');
      const jc = (await buildOpsSnapshot(pool as unknown as Pool, 'job_cards')) as any;
      assert.equal(jc.total, 3);
      assert.deepEqual(Object.fromEntries(jc.byJobStatus.map((r: any) => [r.status, r.n])), {
        WIP: 1,
        'Spare pending': 1,
        Cancelled: 1,
      });
      assert.equal(jc.openByAge[0].n, 2);
      assert.ok(!JSON.stringify(jc).includes('Secret'));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await real.end();
    }
  },
);
