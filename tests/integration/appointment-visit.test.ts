import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ZodError } from 'zod';
import {
  AppointmentServiceError,
  createAppointmentService,
} from '../../apps/api/src/appointments/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { listDailyAppointments } from '../../packages/db/src/daily-list.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'a visit books each item as its own appointment under one visit group',
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
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Visit Integration') RETURNING id`,
      [`visit-${randomUUID()}@example.test`],
    );
    const profileId = profile.rows[0]!.id;
    const technician = await pool.query<{ id: string }>(
      `INSERT INTO technicians (name, max_appointments_per_day) VALUES ('Visit Technician', 3) RETURNING id`,
    );
    const technicianId = technician.rows[0]!.id;
    const service = createAppointmentService(pool);
    const base = {
      customerType: 'B2C',
      customerName: 'Visit Customer',
      contactNumber: '0501234567',
      appointmentDate: '2099-03-04',
      technicianId,
    };
    try {
      const visit = await service.createVisit(
        {
          ...base,
          items: [
            { brand: 'LG', model: 'Washer', faultDescription: 'Not spinning' },
            { brand: 'LG', model: 'Fridge', faultDescription: 'Not cooling' },
          ],
        },
        profileId,
      );
      assert.equal(visit.items.length, 2);
      const [first, second] = visit.items;
      assert.notEqual(first!.appointmentReference, second!.appointmentReference);
      assert.equal(first!.visitGroupId, visit.visitGroupId);
      assert.equal(second!.visitGroupId, visit.visitGroupId);
      assert.deepEqual([first!.visitItemNo, second!.visitItemNo], [1, 2]);
      assert.equal(second!.visitItemCount, 2);
      assert.equal(second!.model, 'Fridge');
      assert.equal(first!.customerName, 'Visit Customer');

      // The Daily schedule list carries each item's visit position so it can group them.
      const daily = await pool.connect();
      try {
        const list = await listDailyAppointments(daily, '2099-03-04', '2099-03-04');
        const mine = list.rows.filter((row) => row.visitGroupId === visit.visitGroupId);
        assert.deepEqual(
          mine.map((row) => [row.visitItemNo, row.visitItemCount]),
          [
            [1, 2],
            [2, 2],
          ],
        );
      } finally {
        daily.release();
      }

      // A single appointment stays outside any visit.
      const single = await service.create(
        { ...base, appointmentDate: '2099-03-05', faultDescription: 'Noise' },
        profileId,
      );
      assert.equal(single.visitGroupId, null);

      // An item may move to another date.
      const moved = await service.createVisit(
        {
          ...base,
          appointmentDate: '2099-03-06',
          items: [
            { faultDescription: 'A' },
            { faultDescription: 'B', appointmentDate: '2099-03-07' },
          ],
        },
        profileId,
      );
      assert.deepEqual(
        moved.items.map((item) => item.appointmentDate),
        ['2099-03-06', '2099-03-07'],
      );

      // Daily cap is 3: 2 already on 03-04, so a 2-item visit must fail and roll back.
      const before = Number(
        (await pool.query<{ count: string }>('SELECT count(*) FROM appointments')).rows[0]!.count,
      );
      await assert.rejects(
        service.createVisit(
          { ...base, items: [{ faultDescription: 'C' }, { faultDescription: 'D' }] },
          profileId,
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError &&
          error.code === 'technician-daily-cap-reached' &&
          /Item 2 of 2/.test(error.message),
      );
      const after = Number(
        (await pool.query<{ count: string }>('SELECT count(*) FROM appointments')).rows[0]!.count,
      );
      assert.equal(after, before);

      // A visit needs at least two items.
      await assert.rejects(
        service.createVisit({ ...base, items: [{ faultDescription: 'x' }] }, profileId),
        (error: unknown) => error instanceof ZodError,
      );

      // Drafts: save with only a name and one item, list, update, age, delete.
      const draft = await service.saveVisitDraft(
        { customerName: 'Draft Customer', items: [{ brand: 'Bosch' }] },
        profileId,
      );
      assert.equal(draft.itemCount, 1);
      assert.equal(draft.ageDays, 0);
      const updated = await service.saveVisitDraft(
        {
          customerName: 'Draft Customer',
          appointmentDate: '2099-04-01',
          items: [{ brand: 'Bosch' }, { brand: 'Siemens', faultDescription: 'Leaks' }],
        },
        profileId,
        draft.id,
      );
      assert.equal(updated.itemCount, 2);
      assert.equal(updated.payload.appointmentDate, '2099-04-01');
      assert.ok((await service.listDrafts()).some((entry) => entry.id === draft.id));
      await pool.query(
        `UPDATE visit_drafts SET created_at = now() - interval '3 days' WHERE id = $1`,
        [draft.id],
      );
      const aged = (await service.listDrafts()).find((entry) => entry.id === draft.id);
      assert.equal(aged?.ageDays, 3);
      await assert.rejects(
        service.saveVisitDraft({ customerName: 'x', items: [] }, profileId),
        (error: unknown) => error instanceof ZodError,
      );
      await service.removeDraft(draft.id);
      await assert.rejects(
        service.removeDraft(draft.id),
        (error: unknown) => error instanceof AppointmentServiceError && error.code === 'not-found',
      );

      // Repeat-customer lookup: same customer found by phone in any format, or by name start.
      const phoneForm = '+971 50 987 6543';
      const known = await service.create(
        {
          customerType: 'B2C',
          customerName: 'Lookupname Customer',
          contactNumber: phoneForm,
          faultDescription: 'Earlier job',
          appointmentDate: '2099-05-01',
          brand: 'Siemens',
        },
        profileId,
      );
      const byPhone = await service.customerLookup({ phone: '050-987-6543' });
      assert.ok(byPhone.some((entry) => entry.id === known.id));
      const byName = await service.customerLookup({ name: 'lookupname' });
      assert.ok(byName.some((entry) => entry.id === known.id));
      assert.equal(byName.find((entry) => entry.id === known.id)?.brand, 'Siemens');
      assert.deepEqual(await service.customerLookup({ phone: '12345', name: 'lo' }), []);
      assert.deepEqual(await service.customerLookup({ name: '%%%' }), []);
      await pool.query('UPDATE appointments SET status = $1, closed_at = now() WHERE id = $2', [
        'Cancelled',
        known.id,
      ]);
      assert.ok(
        (await service.customerLookup({ phone: phoneForm })).some((entry) => entry.id === known.id),
      );
      await pool.query('DELETE FROM appointment_status_history WHERE appointment_id = $1', [
        known.id,
      ]);
      await pool.query('DELETE FROM appointments WHERE id = $1', [known.id]);
    } finally {
      await pool.query(
        `DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id = $1)`,
        [technicianId],
      );
      await pool.query('DELETE FROM appointments WHERE technician_id = $1', [technicianId]);
      await pool.query('DELETE FROM visit_groups WHERE created_by = $1', [profileId]);
      await pool.query('DELETE FROM visit_drafts WHERE created_by = $1', [profileId]);
      await pool.end();
    }
  },
);
