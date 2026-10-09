import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import {
  ServiceJobCardError,
  createServiceJobCardService,
} from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

function futureDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

test(
  'Phase5 job cards link appointments, enforce terminal locks, and record history and audit events',
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
    const appointmentService = createAppointmentService(pool);
    const jobCardService = createServiceJobCardService(pool);
    const profileEmail = `phase5-job-card-${randomUUID()}@example.test`;
    let profileId: string | undefined;
    let appointmentId: string | undefined;
    let jobCardId: string | undefined;

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Phase5 Job Card Integration') RETURNING id`,
        [profileEmail],
      );
      profileId = profile.rows[0].id;

      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Phase5 Job Card Customer',
          contactNumber: '0500000500',
          faultDescription: 'Phase5 job-card integration appointment',
          appointmentDate: futureDate(),
        },
        profileId,
        'phase5-appointment-create',
      );
      appointmentId = appointment.id;

      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        'phase5-appt-progress',
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        'phase5-appt-complete',
      );

      const created = await jobCardService.create(
        appointment.id,
        {},
        profileId,
        'phase5-job-card-create',
      );
      jobCardId = created.id;
      assert.match(created.jobCardReference, /^JBC-\d{4}-\d{5}$/);
      assert.equal(created.status, 'Open');
      assert.equal(created.appointmentId, appointment.id);

      await assert.rejects(
        jobCardService.create(appointment.id, {}, profileId, 'phase5-job-card-duplicate'),
        (error: unknown) => error instanceof ServiceJobCardError && error.code === 'duplicate',
      );

      const inProgress = await jobCardService.changeStatus(
        created.id,
        { status: 'In Progress', reason: 'Technician started work' },
        profileId,
        'phase5-job-card-progress',
      );
      assert.equal(inProgress.status, 'In Progress');

      const completed = await jobCardService.changeStatus(
        created.id,
        { status: 'Completed', reason: 'Service completed' },
        profileId,
        'phase5-job-card-complete',
      );
      assert.equal(completed.status, 'Completed');
      assert.equal(completed.finalizedBy, profileId);
      assert.ok(completed.finalizedAt);

      await assert.rejects(
        jobCardService.changeStatus(
          created.id,
          { status: 'Open' },
          profileId,
          'phase5-job-card-terminal-rejection',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && error.code === 'terminal-job-card',
      );

      const detail = await jobCardService.detail(created.id);
      // Period from is stamped with the creation time by the server.
      assert.ok(detail.jobCard.periodFrom, 'period from is set when the job card is created');
      assert.deepEqual(
        detail.history.map((entry) => [entry.fromStatus, entry.toStatus, entry.reason]),
        [
          [null, 'Open', 'Created'],
          ['Open', 'In Progress', 'Technician started work'],
          ['In Progress', 'Completed', 'Service completed'],
        ],
      );

      const audits = await pool.query<{ action: string; requestId: string }>(
        `SELECT action, request_id AS "requestId"
         FROM audit_events
         WHERE target_type = 'service_job_card' AND target_id = $1
         ORDER BY occurred_at ASC, id ASC`,
        [created.id],
      );
      assert.deepEqual(audits.rows, [
        { action: 'job_card.created', requestId: 'phase5-job-card-create' },
        { action: 'job_card.status_changed', requestId: 'phase5-job-card-progress' },
        { action: 'job_card.status_changed', requestId: 'phase5-job-card-complete' },
      ]);
    } finally {
      if (jobCardId) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'service_job_card' AND target_id = $1`,
          [jobCardId],
        );
        await pool.query(`DELETE FROM service_job_cards WHERE id = $1`, [jobCardId]);
      }
      if (appointmentId) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'appointment' AND target_id = $1`,
          [appointmentId],
        );
        await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
      }
      if (profileId) await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);
