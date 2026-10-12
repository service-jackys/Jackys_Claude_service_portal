import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { upsertB2bBranch } from '../../packages/db/src/b2b-branches.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'job card prefill takes the salesman from the B2B branch master and reports master fields',
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
    const branchName = `Master School ${suffix}`;
    const custCode = `MS${suffix}`;
    const masterSalesman = `Master Salesman ${suffix}`;
    let profileId: string | undefined;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Master prefill') RETURNING id`,
        [`master-prefill-${suffix}@example.test`],
      );
      profileId = profile.rows[0].id;
      const client = await pool.connect();
      try {
        await upsertB2bBranch(client, {
          custCode,
          branchName,
          salesman: masterSalesman,
          salesChannel: null,
          lastSalesOrderNumber: `SO-${suffix}`,
          lastInvoiceDate: null,
        });
      } finally {
        client.release();
      }
      const appointmentService = createAppointmentService(pool);
      const jobCardService = createServiceJobCardService(pool);
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 20);
      const appointment = await appointmentService.create(
        {
          customerType: 'B2B',
          customerName: 'Master Prefill Customer',
          contactNumber: '0500000777',
          faultDescription: 'Master prefill test',
          appointmentDate: date.toISOString().slice(0, 10),
          b2bBranchSchool: branchName,
        },
        profileId,
        'master-prefill-create',
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        'master-prefill-progress',
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        'master-prefill-complete',
      );
      const result = await jobCardService.prefill(appointment.id);
      assert.equal(result.content.salesman, masterSalesman);
      assert.equal(result.content.customerNumber, custCode);
      assert.equal(result.content.salesOrderNumber, `SO-${suffix}`);
      assert.ok(result.masterFields.includes('salesman'));
      assert.ok(result.masterFields.includes('b2bBranchSchool'));
      assert.ok(result.masterFields.includes('customerNumber'));
    } finally {
      await pool.query(`DELETE FROM b2b_branches WHERE cust_code = $1`, [custCode]);
      await pool.end();
    }
  },
);
