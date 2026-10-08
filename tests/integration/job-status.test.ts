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
  date.setUTCDate(date.getUTCDate() + 21);
  return date.toISOString().slice(0, 10);
}

test(
  'Job final status: Delivered only from ready statuses, then locked to non-admins',
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
    let profileId: string | undefined;
    let appointmentId: string | undefined;
    let jobCardId: string | undefined;

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Job status integration') RETURNING id`,
        [`job-status-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Job Status Customer',
          contactNumber: '0500000600',
          faultDescription: 'Job status integration appointment',
          appointmentDate: futureDate(),
        },
        profileId,
        'job-status-appt-create',
      );
      appointmentId = appointment.id;
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        'job-status-appt-progress',
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        'job-status-appt-complete',
      );

      const created = await jobCardService.create(
        appointment.id,
        {},
        profileId,
        'job-status-create',
      );
      jobCardId = created.id;
      assert.equal(created.status, 'Open');

      // WIP -> Delivered is not allowed.
      await assert.rejects(
        jobCardService.updateContent(
          created.id,
          { jobFinalStatus: 'Delivered' },
          profileId,
          'job-status-early-delivery',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && error.code === 'invalid-transition',
      );

      // Repair Completed derives the legacy status and is still editable.
      const repaired = await jobCardService.updateContent(
        created.id,
        { jobFinalStatus: 'Repair Completed' },
        profileId,
        'job-status-repaired',
      );
      assert.equal(repaired.jobFinalStatus, 'Repair Completed');

      // Repair Completed -> Delivered works and fills the delivery date.
      const delivered = await jobCardService.updateContent(
        created.id,
        { jobFinalStatus: 'Delivered' },
        profileId,
        'job-status-delivered',
      );
      assert.equal(delivered.jobFinalStatus, 'Delivered');
      assert.equal(delivered.status, 'Completed');
      assert.ok(delivered.deliveryDate);

      // Delivered cards are locked for non-admins.
      await assert.rejects(
        jobCardService.updateContent(
          created.id,
          { conditionNotes: 'late edit' },
          profileId,
          'job-status-locked',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && error.code === 'terminal-job-card',
      );

      // Admins may still edit.
      const edited = await jobCardService.updateContent(
        created.id,
        { conditionNotes: 'admin edit' },
        profileId,
        'job-status-admin-edit',
        true,
      );
      assert.equal(edited.conditionNotes, 'admin edit');
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
