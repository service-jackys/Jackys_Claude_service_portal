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
  'Final status: BER keeps its job status, reasons are required for spares, parts removal is audited',
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
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Final status integration') RETURNING id`,
        [`final-status-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Final Status Customer',
          contactNumber: '0500000601',
          faultDescription: 'Final status integration appointment',
          appointmentDate: futureDate(),
        },
        profileId,
        'final-status-appt-create',
      );
      appointmentId = appointment.id;
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        'final-status-appt-progress',
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        'final-status-appt-complete',
      );

      const created = await jobCardService.create(
        appointment.id,
        {},
        profileId,
        'final-status-create',
      );
      jobCardId = created.id;

      // BER with spare parts.
      const ber = await jobCardService.updateContent(
        created.id,
        {
          jobFinalStatus: 'BER',
          parts: [{ partNo: 'P1', description: 'Fan', qty: 1, unitPrice: 100 }],
        },
        profileId,
        'final-status-ber',
      );
      assert.equal(ber.jobFinalStatus, 'BER');
      assert.equal(ber.finalStatus, null);

      // Closing it as Rejected without a reason is refused.
      await assert.rejects(
        jobCardService.updateContent(
          created.id,
          { finalStatus: 'Rejected' },
          profileId,
          'final-status-no-reason',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && error.code === 'reason-required',
      );

      // With a reason it closes; Rejected is final but the card stays editable.
      const rejected = await jobCardService.updateContent(
        created.id,
        { finalStatus: 'Rejected', finalStatusReason: 'Parts fitted, written off' },
        profileId,
        'final-status-rejected',
      );
      assert.equal(rejected.finalStatus, 'Rejected');
      assert.equal(rejected.jobFinalStatus, 'BER');
      assert.equal(rejected.finalStatusReason, 'Parts fitted, written off');

      // Removing the parts is allowed but audited; with only the AED 60
      // handling charge left, Delivered needs no new reason and BER stays BER.
      const delivered = await jobCardService.updateContent(
        created.id,
        { parts: [], serviceCharge: 60, finalStatus: 'Delivered' },
        profileId,
        'final-status-delivered',
      );
      assert.equal(delivered.finalStatus, 'Delivered');
      assert.equal(delivered.jobFinalStatus, 'BER');
      assert.equal(delivered.status, 'Completed');
      assert.ok(delivered.deliveryDate);
      const audits = await pool.query(
        `SELECT 1 FROM audit_events WHERE action = 'job_card.parts_removed' AND target_id = $1`,
        [created.id],
      );
      assert.equal(audits.rowCount, 1);

      // Delivered locks the card for non-admins.
      await assert.rejects(
        jobCardService.updateContent(
          created.id,
          { conditionNotes: 'late edit' },
          profileId,
          'final-status-locked',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && error.code === 'terminal-job-card',
      );
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
