import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ZodError } from 'zod';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'staff New request books an appointment directly and records the complaint source',
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
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Source Integration') RETURNING id`,
      [`source-${randomUUID()}@example.test`],
    );
    const profileId = profile.rows[0]!.id;
    const service = createAppointmentService(pool);
    const complaintsBefore = Number(
      (await pool.query<{ count: string }>('SELECT count(*) FROM complaints')).rows[0]!.count,
    );
    const branchName = `Source School ${suffix}`;
    const custCode = `SRC${suffix}`;
    try {
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman) VALUES ($1, $2, 'Rahul')`,
        [custCode, branchName],
      );

      const phone = await service.create(
        {
          complaintSource: 'Phone',
          customerType: 'B2C',
          customerName: 'Phone Customer',
          contactNumber: '0501234567',
          faultDescription: 'No power',
          appointmentDate: '2099-02-03',
        },
        profileId,
      );
      assert.equal(phone.complaintSource, 'Phone');
      assert.equal(phone.complaintId, null);
      assert.match(phone.appointmentReference, /^APT-/);
      assert.equal(phone.status, 'Scheduled');
      assert.deepEqual(await service.sourceWarnings(phone), []);

      // Salesman source needs a salesman.
      await assert.rejects(
        service.create(
          {
            complaintSource: 'Salesman',
            customerType: 'B2C',
            customerName: 'X',
            contactNumber: '0501234567',
            faultDescription: 'x',
            appointmentDate: '2099-02-03',
          },
          profileId,
        ),
        (error: unknown) => error instanceof ZodError,
      );

      // Matching salesman: no warning. Different salesman: warning, still saved.
      const base = {
        complaintSource: 'Salesman',
        customerType: 'B2B',
        customerName: branchName,
        faultDescription: 'Fridge not cooling',
        appointmentDate: '2099-02-04',
        b2bBranchSchool: branchName,
      };
      const same = await service.create({ ...base, salesman: 'rahul ' }, profileId);
      assert.deepEqual(await service.sourceWarnings(same), []);
      const other = await service.create({ ...base, salesman: 'Anil' }, profileId);
      assert.equal(other.salesman, 'Anil');
      const warnings = await service.sourceWarnings(other);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /Rahul/);
      assert.match(warnings[0]!, /Anil/);

      // B2C never warns, and no complaint record was created by any of this.
      assert.deepEqual(await service.sourceWarnings({ ...other, customerType: 'B2C' }), []);
      const complaintsAfter = Number(
        (await pool.query<{ count: string }>('SELECT count(*) FROM complaints')).rows[0]!.count,
      );
      assert.equal(complaintsAfter, complaintsBefore);
    } finally {
      await pool.query('DELETE FROM b2b_branches WHERE cust_code = $1', [custCode]);
      await pool.end();
    }
  },
);
