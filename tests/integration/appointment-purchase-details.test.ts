import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ZodError } from 'zod';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { listDailyAppointments } from '../../packages/db/src/daily-list.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'optional purchase details are saved per appointment, listed for the sheet and carried into the job card',
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
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Purchase Details') RETURNING id`,
      [`purchase-${randomUUID()}@example.test`],
    );
    const profileId = profile.rows[0]!.id;
    const service = createAppointmentService(pool);
    const jobCards = createServiceJobCardService(pool);
    const date = '2099-05-06';
    const base = {
      customerType: 'B2C',
      customerName: 'Purchase Customer',
      contactNumber: '0501112222',
      appointmentDate: date,
    };
    try {
      // Single request with all four details.
      const full = await service.create(
        {
          ...base,
          faultDescription: 'Not cooling',
          serialNo: 'VN4501234',
          invoiceNumber: '16101234',
          invoiceDate: '2025-03-12',
          receivedDate: '2025-03-20',
        },
        profileId,
        'purchase-full',
      );
      assert.equal(full.serialNo, 'VN4501234');
      assert.equal(full.invoiceNumber, '16101234');
      assert.equal(full.invoiceDate, '2025-03-12');
      assert.equal(full.receivedDate, '2025-03-20');

      // None of them is required.
      const blank = await service.create(
        { ...base, faultDescription: 'Noisy' },
        profileId,
        'purchase-blank',
      );
      assert.equal(blank.serialNo, null);
      assert.equal(blank.invoiceNumber, null);
      assert.equal(blank.invoiceDate, null);
      assert.equal(blank.receivedDate, null);

      // A bad date is refused.
      await assert.rejects(
        service.create(
          { ...base, faultDescription: 'x', invoiceDate: '12/03/2025' },
          profileId,
          'purchase-bad',
        ),
        ZodError,
      );

      // Each item of a visit keeps its own details.
      const visit = await service.createVisit(
        {
          ...base,
          items: [
            { faultDescription: 'Item one', serialNo: 'SN-ONE', invoiceNumber: 'INV-1' },
            { faultDescription: 'Item two', serialNo: 'SN-TWO', invoiceDate: '2025-01-02' },
          ],
        },
        profileId,
      );
      assert.deepEqual(
        visit.items.map((item) => [item.serialNo, item.invoiceNumber, item.invoiceDate]),
        [
          ['SN-ONE', 'INV-1', null],
          ['SN-TWO', null, '2025-01-02'],
        ],
      );

      // The Daily schedule list (appointment sheet) carries them.
      const client = await pool.connect();
      try {
        const list = await listDailyAppointments(client, date, date);
        const row = list.rows.find((r) => r.id === full.id);
        assert.equal(row?.serialNo, 'VN4501234');
        assert.equal(row?.invoiceNumber, '16101234');
        assert.equal(row?.invoiceDate, '2025-03-12');
        assert.equal(row?.receivedDate, '2025-03-20');
      } finally {
        client.release();
      }

      // The serial number and invoice date prefill the job card.
      await service.changeStatus(full.id, { status: 'In Progress' }, profileId, 'purchase-prog');
      await service.changeStatus(
        full.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        'purchase-done',
      );
      const prefill = await jobCards.prefill(full.id);
      assert.equal(prefill.content.serialNo, 'VN4501234');
      assert.equal(prefill.content.purchaseDate, '2025-03-12');
    } finally {
      await pool.query(`DELETE FROM appointments WHERE appointment_date = $1`, [date]);
      await pool.end();
    }
  },
);
