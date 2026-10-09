import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  AppointmentServiceError,
  createAppointmentService,
} from '../../apps/api/src/appointments/service.js';
import { createTechnicianService } from '../../apps/api/src/technicians/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'appointment messages are recorded for open appointments only',
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
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Messages Integration') RETURNING id`,
      [`messages-${randomUUID()}@example.test`],
    );
    const profileId = profile.rows[0]!.id;
    const service = createAppointmentService(pool);
    const technicians = createTechnicianService(pool);
    const appointmentIds: string[] = [];
    let technicianId: string | null = null;
    try {
      const technician = await technicians.create(
        {
          name: `Msg Tech ${randomUUID().slice(0, 6)}`,
          region: 'Dubai',
          phone: '0559876543',
          email: `tech-${randomUUID()}@example.test`,
          active: true,
          maxAppointmentsPerDay: 10,
        },
        profileId,
      );
      technicianId = technician.id;
      const created = await service.create(
        {
          customerType: 'B2C',
          customerName: 'Message Customer',
          contactNumber: '0501234567',
          customerEmail: 'customer@example.test',
          faultDescription: 'Does not start',
          appointmentDate: '2099-01-05',
          technicianId,
        },
        profileId,
      );
      appointmentIds.push(created.id);

      const before = await service.messages(created.id);
      assert.equal(before.canSend, true);
      // The rescheduled notice is only offered once the date has been changed.
      assert.equal(before.drafts.length, 2);
      assert.ok(!before.drafts.some((draft) => draft.template === 'customer_rescheduled'));
      assert.equal(before.history.length, 0);

      const sent = await service.prepareMessage(
        created.id,
        { template: 'customer_booked', channel: 'whatsapp' },
        profileId,
      );
      assert.ok(sent.url.startsWith('https://wa.me/971501234567?text='));
      assert.equal(sent.message.channel, 'whatsapp');
      assert.equal(sent.message.recipient, '+971501234567');

      await service.prepareMessage(
        created.id,
        { template: 'technician_assigned', channel: 'email' },
        profileId,
      );
      const after = await service.messages(created.id);
      assert.equal(after.history.length, 2);
      assert.equal(after.history[0]!.sentByName, 'Messages Integration');

      const audit = await pool.query(
        `SELECT 1 FROM audit_events WHERE action = 'appointment.message_prepared' AND target_id = $1`,
        [created.id],
      );
      assert.equal(audit.rowCount, 2);

      await service.reschedule(created.id, { appointmentDate: '2099-01-07' }, profileId);
      const rescheduled = await service.messages(created.id);
      assert.equal(rescheduled.drafts.length, 3);
      assert.ok(rescheduled.drafts.some((draft) => draft.template === 'customer_rescheduled'));

      // A channel with no recipient is refused and nothing is recorded.
      const noEmail = await service.create(
        {
          customerType: 'B2C',
          customerName: 'No Email',
          contactNumber: '0501234567',
          faultDescription: 'x',
          appointmentDate: '2099-01-06',
        },
        profileId,
      );
      appointmentIds.push(noEmail.id);
      await assert.rejects(
        service.prepareMessage(
          noEmail.id,
          { template: 'customer_booked', channel: 'email' },
          profileId,
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'message-unavailable',
      );
      assert.equal((await service.messages(noEmail.id)).history.length, 0);

      // Closed appointments get no drafts and cannot be messaged.
      await service.changeStatus(created.id, { status: 'Cancelled', reason: 'test' }, profileId);
      const closed = await service.messages(created.id);
      assert.equal(closed.canSend, false);
      assert.equal(closed.drafts.length, 0);
      assert.equal(closed.history.length, 2);
      await assert.rejects(
        service.prepareMessage(
          created.id,
          { template: 'customer_booked', channel: 'whatsapp' },
          profileId,
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'terminal-appointment',
      );
    } finally {
      for (const id of appointmentIds) {
        await pool.query('DELETE FROM appointment_messages WHERE appointment_id = $1', [id]);
      }
      await pool.end();
    }
  },
);
