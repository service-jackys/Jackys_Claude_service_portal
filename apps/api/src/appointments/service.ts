import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createAppointmentIcs } from './ics.js';
import {
  appointmentAssignmentSchema,
  appointmentCreateSchema,
  appointmentListQuerySchema,
  appointmentScheduleUpdateSchema,
  appointmentStatusSchema,
  appointmentStatusUpdateSchema,
  appointmentTransitions,
  type AppointmentStatus,
} from '../../../../packages/contracts/src/index.js';
import {
  findActiveAppointmentForComplaint,
  findAppointmentById,
  insertAppointment,
  insertAppointmentHistory,
  listAppointmentHistory,
  listAppointments,
  updateAppointmentAssignment,
  updateAppointmentSchedule,
  updateAppointmentStatus,
} from '../../../../packages/db/src/appointments.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  findComplaintById,
  insertComplaintHistory,
  updateComplaintStatus,
} from '../../../../packages/db/src/complaints.js';
import { allocateAppointmentReference } from '../../../../packages/db/src/references.js';
import {
  countTechnicianAppointmentsOnDate,
  findTechnicianById,
} from '../../../../packages/db/src/technicians.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class AppointmentServiceError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'invalid-transition'
      | 'technician-unavailable'
      | 'technician-conflict'
      | 'technician-daily-cap-reached'
      | 'active-appointment-conflict'
      | 'complaint-not-schedulable'
      | 'terminal-appointment',
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function complaintStatusForAppointment(
  status: AppointmentStatus,
): 'Scheduled' | 'Ready for Scheduling' | 'Closed' {
  if (status === 'Cancelled') return 'Ready for Scheduling';
  if (status === 'Completed') return 'Closed';
  return 'Scheduled';
}

export function createAppointmentService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = appointmentCreateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      let complaint = null;
      if (data.complaintId) {
        complaint = await findComplaintById(client, data.complaintId, true);
        if (!complaint)
          throw new AppointmentServiceError('not-found', 'The complaint was not found.');
        if (await findActiveAppointmentForComplaint(client, data.complaintId)) {
          throw new AppointmentServiceError(
            'active-appointment-conflict',
            'The complaint already has an active appointment.',
          );
        }
        if (complaint.status !== 'Ready for Scheduling') {
          throw new AppointmentServiceError(
            'complaint-not-schedulable',
            `A complaint in ${complaint.status} cannot receive an appointment.`,
          );
        }
      }

      if (data.technicianId) {
        const technician = await findTechnicianById(client, data.technicianId, true);
        if (!technician)
          throw new AppointmentServiceError('not-found', 'The technician was not found.');
        if (!technician.active)
          throw new AppointmentServiceError(
            'technician-unavailable',
            'The technician is inactive.',
          );
        const dailyCount = await countTechnicianAppointmentsOnDate(
          client,
          data.technicianId,
          data.appointmentDate,
        );
        if (dailyCount >= technician.maxAppointmentsPerDay) {
          throw new AppointmentServiceError(
            'technician-daily-cap-reached',
            `Assignment limit for the day reached: ${technician.name} already has ${dailyCount} of ${technician.maxAppointmentsPerDay} appointments on ${data.appointmentDate}.`,
          );
        }
      }

      let input: Record<string, unknown> = data;
      if (complaint) {
        input = {
          ...data,
          customerId: complaint.customerId,
          branchId: complaint.branchId,
          customerType: complaint.customerType,
          customerName: complaint.customerName,
          contactNumber: data.contactNumber ?? complaint.contactNumber,
          customerEmail: complaint.customerEmail,
          address: complaint.address,
          region: complaint.region,
          brand: complaint.brand,
          model: complaint.model,
          itemCode: complaint.serialOrItemCode,
          faultDescription: complaint.description,
          jobWarranty: complaint.warrantyClassification,
          // These five are NOT in appointmentCreateSchema's "standaloneFields"
          // block list, so staff scheduling from a complaint may legitimately
          // send their own value for one of these alongside a complaintId
          // (e.g. a Sales Order No. that only became known at scheduling
          // time, or a site contact that changed). Default to the complaint's
          // captured value, but let the staff's own form input win when they
          // provided one — same "always editable, never gated" rule the live
          // Scheduler uses. See docs/PARITY_REVIEW_2026-09-28.md, gap #1.
          salesOrderNumber: data.salesOrderNumber ?? complaint.salesOrderNumber,
          b2bBranchSchool: data.b2bBranchSchool ?? complaint.b2bBranchSchool,
          schoolContactPerson: data.schoolContactPerson ?? complaint.schoolContactPerson,
          schoolContactNumber: data.schoolContactNumber ?? complaint.schoolContactNumber,
          customerNumber: data.customerNumber ?? complaint.customerNumber,
        };
      }
      const reference = await allocateAppointmentReference(client, data.appointmentDate);
      let appointment;
      try {
        appointment = await insertAppointment(client, {
          ...input,
          appointmentReference: reference,
          createdBy: profileId,
        });
      } catch (error) {
        if (isUniqueViolation(error) && data.complaintId) {
          throw new AppointmentServiceError(
            'active-appointment-conflict',
            'The complaint already has an active appointment.',
          );
        }
        throw error;
      }
      await insertAppointmentHistory(
        client,
        appointment.id,
        null,
        'Scheduled',
        profileId,
        'Created',
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'appointment.created',
        targetType: 'appointment',
        targetId: appointment.id,
        metadata: {
          appointmentReference: appointment.appointmentReference,
          complaintId: data.complaintId ?? null,
        },
        requestId,
      });
      if (complaint) {
        const updated = await updateComplaintStatus(
          client,
          complaint.id,
          { status: 'Scheduled' },
          profileId,
        );
        if (!updated)
          throw new AppointmentServiceError('not-found', 'The complaint was not found.');
        await insertComplaintHistory(
          client,
          complaint.id,
          complaint.status,
          'Scheduled',
          profileId,
          'Appointment created',
        );
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'complaint.status_changed',
          targetType: 'complaint',
          targetId: complaint.id,
          metadata: {
            fromStatus: complaint.status,
            toStatus: 'Scheduled',
            appointmentId: appointment.id,
          },
          requestId,
        });
      }
      return appointment;
    });
  }

  async function list(input: unknown) {
    const query = appointmentListQuerySchema.parse(input);
    const client = await pool.connect();
    try {
      return await listAppointments(client, query);
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const appointment = await findAppointmentById(client, id);
      if (!appointment)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      const history = await listAppointmentHistory(client, id);
      return { appointment, history };
    } finally {
      client.release();
    }
  }

  async function history(id: string) {
    const client = await pool.connect();
    try {
      if (!(await findAppointmentById(client, id)))
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      return listAppointmentHistory(client, id);
    } finally {
      client.release();
    }
  }

  async function ics(id: string) {
    const client = await pool.connect();
    try {
      const appointment = await findAppointmentById(client, id);
      if (!appointment)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      return createAppointmentIcs(appointment);
    } finally {
      client.release();
    }
  }

  async function assign(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = appointmentAssignmentSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findAppointmentById(client, id, true);
      if (!current)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      if (data.technicianId) {
        const technician = await findTechnicianById(client, data.technicianId, true);
        if (!technician)
          throw new AppointmentServiceError('not-found', 'The technician was not found.');
        if (!technician.active)
          throw new AppointmentServiceError(
            'technician-unavailable',
            'The technician is inactive.',
          );
        const dailyCount = await countTechnicianAppointmentsOnDate(
          client,
          data.technicianId,
          current.appointmentDate,
          id,
        );
        if (dailyCount >= technician.maxAppointmentsPerDay) {
          throw new AppointmentServiceError(
            'technician-daily-cap-reached',
            `Assignment limit for the day reached: ${technician.name} already has ${dailyCount} of ${technician.maxAppointmentsPerDay} appointments on ${current.appointmentDate}.`,
          );
        }
      }
      const appointment = await updateAppointmentAssignment(
        client,
        id,
        data.technicianId,
        profileId,
      );
      if (!appointment)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'appointment.assignment_changed',
        targetType: 'appointment',
        targetId: id,
        metadata: { technicianId: data.technicianId },
        requestId,
      });
      return appointment;
    });
  }

  async function reschedule(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = appointmentScheduleUpdateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findAppointmentById(client, id, true);
      if (!current)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      if (current.status === 'Completed' || current.status === 'Cancelled') {
        throw new AppointmentServiceError(
          'terminal-appointment',
          `A ${current.status.toLowerCase()} appointment cannot be rescheduled.`,
        );
      }
      if (current.technicianId) {
        const technician = await findTechnicianById(client, current.technicianId, true);
        if (!technician)
          throw new AppointmentServiceError('not-found', 'The technician was not found.');
        if (!technician.active) {
          throw new AppointmentServiceError(
            'technician-unavailable',
            'The assigned technician is inactive.',
          );
        }
        const dailyCount = await countTechnicianAppointmentsOnDate(
          client,
          current.technicianId,
          data.appointmentDate,
          id,
        );
        if (dailyCount >= technician.maxAppointmentsPerDay) {
          throw new AppointmentServiceError(
            'technician-daily-cap-reached',
            `Assignment limit for the day reached: ${technician.name} already has ${dailyCount} of ${technician.maxAppointmentsPerDay} appointments on ${data.appointmentDate}.`,
          );
        }
      }
      const appointment = await updateAppointmentSchedule(
        client,
        id,
        data.appointmentDate,
        profileId,
      );
      if (!appointment)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'appointment.schedule_changed',
        targetType: 'appointment',
        targetId: id,
        metadata: {
          fromDate: current.appointmentDate,
          toDate: data.appointmentDate,
          technicianId: current.technicianId,
        },
        requestId,
      });
      return appointment;
    });
  }

  async function changeStatus(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = appointmentStatusUpdateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findAppointmentById(client, id, true);
      if (!current)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      if (!appointmentTransitions[current.status].includes(data.status)) {
        throw new AppointmentServiceError(
          'invalid-transition',
          `An appointment in ${current.status} cannot transition to ${data.status}.`,
        );
      }
      const appointmentResult = await updateAppointmentStatus(client, id, data, profileId);
      if (!appointmentResult)
        throw new AppointmentServiceError('not-found', 'The appointment was not found.');
      await insertAppointmentHistory(
        client,
        id,
        appointmentResult.previousStatus,
        data.status,
        profileId,
        data.reason,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'appointment.status_changed',
        targetType: 'appointment',
        targetId: id,
        metadata: { fromStatus: appointmentResult.previousStatus, toStatus: data.status },
        requestId,
      });
      if (current.complaintId && (data.status === 'Cancelled' || data.status === 'Completed')) {
        const complaint = await findComplaintById(client, current.complaintId, true);
        if (complaint) {
          const complaintStatus = complaintStatusForAppointment(data.status);
          const updated = await updateComplaintStatus(
            client,
            complaint.id,
            { status: complaintStatus },
            profileId,
          );
          if (updated) {
            await insertComplaintHistory(
              client,
              complaint.id,
              updated.previousStatus,
              complaintStatus,
              profileId,
              `Appointment ${data.status.toLowerCase()}`,
            );
            await insertAuditEvent(client, {
              actorProfileId: profileId,
              action: 'complaint.status_changed',
              targetType: 'complaint',
              targetId: complaint.id,
              metadata: {
                fromStatus: updated.previousStatus,
                toStatus: complaintStatus,
                appointmentId: id,
              },
              requestId,
            });
          }
        }
      }
      return appointmentResult.appointment;
    });
  }

  return { create, list, detail, history, ics, assign, reschedule, changeStatus };
}

export type AppointmentService = ReturnType<typeof createAppointmentService>;
