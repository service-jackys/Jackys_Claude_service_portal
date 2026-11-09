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

      await client.query('DELETE FROM warranty_approvals');
      await client.query('DELETE FROM quotations');
      const addQ = (n: number, status: string, total: number) =>
        client.query(
          `INSERT INTO quotations (quotation_reference, customer_name, contact_number, project_name, site_location, customer_complaint, grand_total, quotation_status, customer_type)
           VALUES ($1, 'Secret Person', '0500000000', 'Secret project', 'Secret site', 'Secret complaint', $2, $3, 'B2C')`,
          ['QO-2026-0000' + n, total, status],
        );
      await addQ(1, 'Pending', 100);
      await addQ(2, 'Pending', 200);
      await addQ(3, 'Approved', 300);
      const qo = (await buildOpsSnapshot(pool as unknown as Pool, 'quotations')) as any;
      assert.equal(qo.total, 3);
      assert.deepEqual(Object.fromEntries(qo.byStatus.map((r: any) => [r.status, r.n])), {
        Pending: 2,
        Approved: 1,
      });
      assert.equal(qo.pendingByAge[0].n, 2);
      assert.equal(qo.valueByStatus.find((r: any) => r.status === 'Approved').value, 300);
      assert.ok(!JSON.stringify(qo).includes('Secret'));

      await client.query('DELETE FROM warranty_approvals');
      await client.query('DELETE FROM inspections');
      const addI = (n: number, reviewer: string | null, quotation: string | null, cost: number) =>
        client.query(
          `INSERT INTO inspections (inspection_reference, customer_name, contact_number, project_name, site_location, customer_complaint, visual_findings, reviewed_by, ref_quotation_no, est_repair_cost, warranty_status, customer_type, inspection_date)
           VALUES ($1, 'Secret Person', '0500000000', 'Secret project', 'Secret site', 'Secret complaint', 'Secret findings', $2, $3, $4, 'In Warranty', 'B2C', current_date)`,
          ['IR-2026-0000' + n, reviewer, quotation, cost],
        );
      await addI(1, null, null, 100);
      await addI(2, null, 'QO-2026-00001', 200);
      await addI(3, 'Someone', 'QO-2026-00002', 300);
      const ins = (await buildOpsSnapshot(pool as unknown as Pool, 'inspections')) as any;
      assert.equal(ins.total, 3);
      assert.deepEqual(Object.fromEntries(ins.reviewState.map((r: any) => [r.review, r.n])), {
        'Not reviewed': 2,
        Reviewed: 1,
      });
      assert.equal(ins.unreviewedByAge[0].n, 2);
      assert.equal(ins.byMonth[ins.byMonth.length - 1].value, 600);
      assert.ok(!JSON.stringify(ins).includes('Secret'));
      assert.ok(!JSON.stringify(ins).includes('Someone'));

      await client.query('DELETE FROM warranty_approvals');
      await client.query('DELETE FROM quotations');
      const addWA = async (n: number, status: string, cost: number) => {
        const q = await client.query(
          `INSERT INTO quotations (quotation_reference) VALUES ($1) RETURNING id`,
          ['QO-2026-1000' + n],
        );
        await client.query(
          `INSERT INTO warranty_approvals (approval_reference, quotation_id, customer_name, contact_number, item_description, notes, estimated_cost, status, access_token, decided_at, decided_by_name, decision_notes, warranty_status)
           VALUES ($1, $2, 'Secret Person', '0500000000', 'Secret item', 'Secret notes', $3, $4, $5,
                   CASE WHEN $4 = 'Pending' THEN NULL ELSE now() END,
                   CASE WHEN $4 = 'Pending' THEN NULL ELSE 'Secret Decider' END, NULL, 'In Warranty')`,
          ['WA-2026-0000' + n, q.rows[0].id, cost, status, 'tok-secret-' + n],
        );
      };
      await addWA(1, 'Pending', 100);
      await addWA(2, 'Pending', 200);
      await addWA(3, 'Approved', 300);
      const wa = (await buildOpsSnapshot(pool as unknown as Pool, 'warranty_approvals')) as any;
      assert.equal(wa.total, 3);
      assert.deepEqual(Object.fromEntries(wa.byStatus.map((r: any) => [r.status, r.n])), {
        Pending: 2,
        Approved: 1,
      });
      assert.equal(wa.pendingByAge[0].n, 2);
      assert.equal(wa.byStatus.find((r: any) => r.status === 'Approved').value, 300);
      assert.equal(wa.bySource[0].source, 'Quotation');
      assert.ok(!JSON.stringify(wa).includes('Secret'));
      assert.ok(!JSON.stringify(wa).includes('tok-'));

      await client.query('DELETE FROM di_jobs');
      const addDi = (n: number, status: string, csidi: number, csido: number) =>
        client.query(
          `INSERT INTO di_jobs (reference, service_date, status, customer_name, salesman, notes, region, total_csidi, total_csido, total_revenue, completed_at, cancelled_at)
           VALUES ($1, current_date, $2, 'Secret Customer', 'Secret Salesman', 'Secret notes', 'Dubai', $3, $4, $3::numeric + $4::numeric,
                   CASE WHEN $2::text = 'Completed' THEN now() END, CASE WHEN $2::text = 'Cancelled' THEN now() END)`,
          ['DIJ-2026-0000' + n, status, csidi, csido],
        );
      await addDi(1, 'Draft', 0, 0);
      await addDi(2, 'Completed', 100, 50);
      await addDi(3, 'Completed', 200, 0);
      const di = (await buildOpsSnapshot(pool as unknown as Pool, 'delivery_install')) as any;
      assert.equal(di.total, 3);
      assert.deepEqual(Object.fromEntries(di.byStatus.map((r: any) => [r.status, r.n])), {
        Completed: 2,
        Draft: 1,
      });
      assert.equal(di.byMonth[di.byMonth.length - 1].csidi, 300);
      assert.equal(di.byMonth[di.byMonth.length - 1].value, 350);
      assert.equal(di.draftsByAge[0].n, 1);
      assert.ok(!JSON.stringify(di).includes('Secret'));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await real.end();
    }
  },
);
