import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createAppointmentService,
  AppointmentServiceError,
} from '../../apps/api/src/appointments/service.js';
import { createBranchService } from '../../apps/api/src/branches/service.js';
import { createComplaintService } from '../../apps/api/src/complaints/service.js';
import { createCustomerService } from '../../apps/api/src/customers/service.js';
import { createScheduleService } from '../../apps/api/src/schedules/service.js';
import { createTechnicianService } from '../../apps/api/src/technicians/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

function nextDateForWeekday(weekday: number): string {
  const date = new Date();
  const days = (weekday - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test(
  'Phase3 scheduling couples appointments, complaints, technicians, and draft promotion transactionally',
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
    const profileEmail = `phase3-${randomUUID()}@example.test`;
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Phase3 Integration') RETURNING id`,
      [profileEmail],
    );
    const profileId = profile.rows[0].id;
    const customerService = createCustomerService(pool);
    const branchService = createBranchService(pool);
    const technicianService = createTechnicianService(pool);
    const complaintService = createComplaintService(pool);
    const appointmentService = createAppointmentService(pool);
    const scheduleService = createScheduleService(pool);
    const date = nextDateForWeekday(0);
    const customerIds: string[] = [];
    const branchIds: string[] = [];
    const technicianIds: string[] = [];
    const complaintIds: string[] = [];
    const appointmentIds: string[] = [];
    const draftIds: string[] = [];

    try {
      const customer = await customerService.create(
        {
          customerType: 'individual',
          name: 'Phase3 Integration Customer',
          contactNumber: '0500000300',
          email: `customer-${randomUUID()}@example.test`,
          region: 'Dubai',
        },
        profileId,
        'phase3-customer',
      );
      customerIds.push(customer.id);

      const branch = await branchService.create(
        {
          customerId: customer.id,
          name: 'Phase3 Integration Branch',
          region: 'Dubai',
          address: 'Phase3 test address',
        },
        profileId,
        'phase3-branch',
      );
      branchIds.push(branch.id);

      const technician = await technicianService.create(
        { name: 'Phase3 Integration Technician', region: 'Dubai' },
        profileId,
        'phase3-technician',
      );
      technicianIds.push(technician.id);
      await technicianService.replaceAvailability(
        technician.id,
        { windows: [{ weekday: 0, startsAt: '08:00', endsAt: '17:00' }] },
        profileId,
        'phase3-availability',
      );

      const complaint = await complaintService.submit(
        {
          customerType: 'individual',
          customerName: 'Phase3 Linked Customer',
          contactNumber: '0500000301',
          description: 'Phase3 linked scheduling complaint',
          region: 'Dubai',
        },
        'phase3-complaint',
      );
      complaintIds.push(complaint.id);
      await complaintService.changeStatus(complaint.id, { status: 'Under Review' }, profileId);
      await complaintService.changeStatus(
        complaint.id,
        { status: 'Ready for Scheduling' },
        profileId,
      );

      const appointment = await appointmentService.create(
        {
          complaintId: complaint.id,
          technicianId: technician.id,
          appointmentDate: date,
          appointmentTime: '09:00',
        },
        profileId,
        'phase3-appointment',
      );
      appointmentIds.push(appointment.id);
      assert.match(appointment.appointmentReference, /^APT-\d{4}-\d{5}$/);
      assert.equal(appointment.status, 'Scheduled');

      const rescheduledDate = addDays(date, 7);
      const rescheduled = await appointmentService.reschedule(
        appointment.id,
        { appointmentDate: rescheduledDate, appointmentTime: '11:00' },
        profileId,
        'phase4-reschedule-success',
      );
      assert.equal(rescheduled.appointmentDate, rescheduledDate);
      assert.equal(rescheduled.appointmentTime, '11:00');
      assert.equal(rescheduled.technicianId, technician.id);

      const audit = await pool.query<{
        action: string;
        requestId: string;
        metadata: {
          fromDate: string;
          fromTime: string;
          toDate: string;
          toTime: string;
          technicianId: string;
        };
      }>(
        `SELECT action, request_id AS "requestId", metadata
         FROM audit_events
         WHERE target_type = 'appointment' AND target_id = $1 AND request_id = $2`,
        [appointment.id, 'phase4-reschedule-success'],
      );
      assert.deepEqual(audit.rows[0], {
        action: 'appointment.schedule_changed',
        requestId: 'phase4-reschedule-success',
        metadata: {
          fromDate: date,
          fromTime: '09:00',
          toDate: rescheduledDate,
          toTime: '11:00',
          technicianId: technician.id,
        },
      });

      await assert.rejects(
        appointmentService.reschedule(
          appointment.id,
          { appointmentDate: addDays(rescheduledDate, 1), appointmentTime: '12:00' },
          profileId,
          'phase4-reschedule-unavailable',
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'technician-unavailable',
      );
      const unchangedAfterUnavailable = await appointmentService.detail(appointment.id);
      assert.equal(unchangedAfterUnavailable.appointment.appointmentDate, rescheduledDate);
      assert.equal(unchangedAfterUnavailable.appointment.appointmentTime, '11:00');

      const conflictComplaint = await complaintService.submit(
        {
          customerType: 'individual',
          customerName: 'Phase4 Conflict Customer',
          contactNumber: '0500000310',
          description: 'Phase4 conflict appointment',
          region: 'Dubai',
        },
        'phase4-conflict-complaint',
      );
      complaintIds.push(conflictComplaint.id);
      await complaintService.changeStatus(
        conflictComplaint.id,
        { status: 'Under Review' },
        profileId,
      );
      await complaintService.changeStatus(
        conflictComplaint.id,
        { status: 'Ready for Scheduling' },
        profileId,
      );
      const conflictAppointment = await appointmentService.create(
        {
          complaintId: conflictComplaint.id,
          technicianId: technician.id,
          appointmentDate: addDays(rescheduledDate, 7),
          appointmentTime: '11:00',
        },
        profileId,
        'phase4-conflict-create',
      );
      appointmentIds.push(conflictAppointment.id);

      await assert.rejects(
        appointmentService.reschedule(
          appointment.id,
          { appointmentDate: addDays(rescheduledDate, 7), appointmentTime: '11:00' },
          profileId,
          'phase4-reschedule-conflict',
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'technician-conflict',
      );
      const unchangedAfterConflict = await appointmentService.detail(appointment.id);
      assert.equal(unchangedAfterConflict.appointment.appointmentDate, rescheduledDate);
      assert.equal(unchangedAfterConflict.appointment.appointmentTime, '11:00');

      await assert.rejects(
        appointmentService.reschedule(
          '999999999',
          { appointmentDate: rescheduledDate, appointmentTime: '11:00' },
          profileId,
          'phase4-reschedule-missing',
        ),
        (error: unknown) => error instanceof AppointmentServiceError && error.code === 'not-found',
      );

      const linkedComplaint = await complaintService.detail(complaint.id);
      assert.equal(linkedComplaint.complaint.status, 'Scheduled');
      assert.deepEqual(
        linkedComplaint.history.at(-1) && [
          linkedComplaint.history.at(-1)?.fromStatus,
          linkedComplaint.history.at(-1)?.toStatus,
        ],
        ['Ready for Scheduling', 'Scheduled'],
      );

      await assert.rejects(
        appointmentService.create(
          {
            complaintId: complaint.id,
            technicianId: technician.id,
            appointmentDate: date,
            appointmentTime: '09:00',
          },
          profileId,
          'phase3-active-conflict',
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'active-appointment-conflict',
      );

      await assert.rejects(
        appointmentService.create(
          {
            complaintId: '999999999',
            technicianId: technician.id,
            appointmentDate: date,
            appointmentTime: '09:00',
          },
          profileId,
          'phase3-technician-conflict',
        ),
        (error: unknown) => error instanceof AppointmentServiceError && error.code === 'not-found',
      );

      const cancelled = await appointmentService.changeStatus(
        appointment.id,
        { status: 'Cancelled', reason: 'Customer requested rebooking' },
        profileId,
        'phase3-cancel',
      );
      assert.equal(cancelled.status, 'Cancelled');
      assert.ok(cancelled.closedAt);
      assert.equal(
        (await complaintService.detail(complaint.id)).complaint.status,
        'Ready for Scheduling',
      );
      await assert.rejects(
        appointmentService.reschedule(
          appointment.id,
          { appointmentDate: addDays(date, 14), appointmentTime: '09:00' },
          profileId,
          'phase4-reschedule-cancelled',
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'terminal-appointment',
      );

      const rebooked = await appointmentService.create(
        {
          complaintId: complaint.id,
          technicianId: technician.id,
          appointmentDate: date,
          appointmentTime: '09:00',
        },
        profileId,
        'phase3-rebook',
      );
      appointmentIds.push(rebooked.id);
      await appointmentService.changeStatus(
        rebooked.id,
        { status: 'In Progress' },
        profileId,
        'phase3-start',
      );
      const completed = await appointmentService.changeStatus(
        rebooked.id,
        { status: 'Completed', reason: 'Work completed' },
        profileId,
        'phase3-complete',
      );
      assert.equal(completed.status, 'Completed');
      assert.ok(completed.closedAt);
      assert.equal((await complaintService.detail(complaint.id)).complaint.status, 'Closed');
      await assert.rejects(
        appointmentService.reschedule(
          rebooked.id,
          { appointmentDate: addDays(date, 21), appointmentTime: '09:00' },
          profileId,
          'phase4-reschedule-completed',
        ),
        (error: unknown) =>
          error instanceof AppointmentServiceError && error.code === 'terminal-appointment',
      );

      const draftComplaint = await complaintService.submit(
        {
          customerType: 'individual',
          customerName: 'Phase3 Draft Customer',
          contactNumber: '0500000302',
          description: 'Phase3 draft scheduling complaint',
          region: 'Dubai',
        },
        'phase3-draft-complaint',
      );
      complaintIds.push(draftComplaint.id);
      await complaintService.changeStatus(draftComplaint.id, { status: 'Under Review' }, profileId);
      await complaintService.changeStatus(
        draftComplaint.id,
        { status: 'Ready for Scheduling' },
        profileId,
      );

      const draftInput = {
        items: [
          {
            complaintId: draftComplaint.id,
            technicianId: technician.id,
            appointmentDate: date,
            appointmentTime: '10:00',
          },
        ],
      };
      const draft = await scheduleService.create(
        draftInput,
        'phase3-draft-idempotency',
        profileId,
        'phase3-draft-create',
      );
      draftIds.push(draft.draft.id);
      const retry = await scheduleService.create(
        draftInput,
        'phase3-draft-idempotency',
        profileId,
        'phase3-draft-retry',
      );
      assert.equal(retry.draft.id, draft.draft.id);
      assert.equal(retry.items.length, 1);

      const promoted = await scheduleService.promote(draft.draft.id, profileId, 'phase3-promote');
      assert.equal(promoted.draft?.status, 'Promoted');
      assert.equal(promoted.appointments.length, 1);
      appointmentIds.push(promoted.appointments[0].id);
      const promotedRetry = await scheduleService.promote(
        draft.draft.id,
        profileId,
        'phase3-promote-retry',
      );
      assert.deepEqual(
        promotedRetry.appointments.map((item) => item.id),
        promoted.appointments.map((item) => item.id),
      );
      assert.equal(
        (await complaintService.detail(draftComplaint.id)).complaint.status,
        'Scheduled',
      );
    } finally {
      if (draftIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'draft_schedule' AND target_id = ANY($1::bigint[])`,
          [draftIds],
        );
        await pool.query(`DELETE FROM draft_schedules WHERE id = ANY($1::bigint[])`, [draftIds]);
      }
      if (appointmentIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'appointment' AND target_id = ANY($1::bigint[])`,
          [appointmentIds],
        );
        await pool.query(`DELETE FROM appointments WHERE id = ANY($1::bigint[])`, [appointmentIds]);
      }
      if (complaintIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'complaint' AND target_id = ANY($1::bigint[])`,
          [complaintIds],
        );
        await pool.query(`DELETE FROM complaints WHERE id = ANY($1::bigint[])`, [complaintIds]);
      }
      if (technicianIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'technician' AND target_id = ANY($1::bigint[])`,
          [technicianIds],
        );
        await pool.query(`DELETE FROM technicians WHERE id = ANY($1::bigint[])`, [technicianIds]);
      }
      if (branchIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'branch' AND target_id = ANY($1::bigint[])`,
          [branchIds],
        );
        await pool.query(`DELETE FROM branches WHERE id = ANY($1::bigint[])`, [branchIds]);
      }
      if (customerIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'customer' AND target_id = ANY($1::bigint[])`,
          [customerIds],
        );
        await pool.query(`DELETE FROM customers WHERE id = ANY($1::bigint[])`, [customerIds]);
      }
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);

test(
  'reopening a Scheduled complaint to Ready for Scheduling cancels its active appointment',
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
    const profileEmail = `reopen-scheduling-${randomUUID()}@example.test`;
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO profiles (email, display_name) VALUES ($1, 'Reopen Scheduling Integration') RETURNING id`,
      [profileEmail],
    );
    const profileId = profile.rows[0].id;
    const technicianService = createTechnicianService(pool);
    const complaintService = createComplaintService(pool);
    const appointmentService = createAppointmentService(pool);
    const date = nextDateForWeekday(0);
    const technicianIds: string[] = [];
    const complaintIds: string[] = [];
    const appointmentIds: string[] = [];

    try {
      const technician = await technicianService.create(
        { name: 'Reopen Scheduling Technician', region: 'Dubai' },
        profileId,
        'reopen-technician',
      );
      technicianIds.push(technician.id);
      await technicianService.replaceAvailability(
        technician.id,
        { windows: [{ weekday: 0, startsAt: '08:00', endsAt: '17:00' }] },
        profileId,
        'reopen-availability',
      );

      const complaint = await complaintService.submit(
        {
          customerType: 'individual',
          customerName: 'Reopen Scheduling Customer',
          contactNumber: '0500000900',
          description: 'Complaint that gets manually reopened for scheduling',
          region: 'Dubai',
        },
        'reopen-complaint',
      );
      complaintIds.push(complaint.id);
      await complaintService.changeStatus(complaint.id, { status: 'Under Review' }, profileId);
      await complaintService.changeStatus(
        complaint.id,
        { status: 'Ready for Scheduling' },
        profileId,
      );

      const firstAppointment = await appointmentService.create(
        {
          complaintId: complaint.id,
          technicianId: technician.id,
          appointmentDate: date,
          appointmentTime: '09:00',
        },
        profileId,
        'reopen-appointment-1',
      );
      appointmentIds.push(firstAppointment.id);
      assert.equal(firstAppointment.status, 'Scheduled');
      assert.equal((await complaintService.detail(complaint.id)).complaint.status, 'Scheduled');

      // Manually reopen scheduling on the Scheduled complaint -- this must
      // cancel the still-active first appointment, otherwise a second
      // appointment can never be created (findActiveAppointmentForComplaint
      // would keep finding the stale Scheduled one).
      const reopened = await complaintService.changeStatus(
        complaint.id,
        { status: 'Ready for Scheduling', reason: 'Technician unavailable, redoing scheduling' },
        profileId,
      );
      assert.equal(reopened.status, 'Ready for Scheduling');

      const cancelledFirst = await appointmentService.detail(firstAppointment.id);
      assert.equal(cancelledFirst.appointment.status, 'Cancelled');
      assert.ok(
        cancelledFirst.history.some(
          (entry) => entry.toStatus === 'Cancelled' && entry.fromStatus === 'Scheduled',
        ),
      );

      const secondAppointment = await appointmentService.create(
        {
          complaintId: complaint.id,
          technicianId: technician.id,
          appointmentDate: date,
          appointmentTime: '10:00',
        },
        profileId,
        'reopen-appointment-2',
      );
      appointmentIds.push(secondAppointment.id);
      assert.equal(secondAppointment.status, 'Scheduled');
      assert.equal((await complaintService.detail(complaint.id)).complaint.status, 'Scheduled');
    } finally {
      if (appointmentIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'appointment' AND target_id = ANY($1::bigint[])`,
          [appointmentIds],
        );
        await pool.query(`DELETE FROM appointments WHERE id = ANY($1::bigint[])`, [appointmentIds]);
      }
      if (complaintIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'complaint' AND target_id = ANY($1::bigint[])`,
          [complaintIds],
        );
        await pool.query(`DELETE FROM complaints WHERE id = ANY($1::bigint[])`, [complaintIds]);
      }
      if (technicianIds.length) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'technician' AND target_id = ANY($1::bigint[])`,
          [technicianIds],
        );
        await pool.query(`DELETE FROM technicians WHERE id = ANY($1::bigint[])`, [technicianIds]);
      }
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);
