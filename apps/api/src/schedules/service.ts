import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { draftScheduleSchema } from '../../../../packages/contracts/src/index.js';
import {
  findAppointmentById,
  insertAppointment,
  insertAppointmentHistory,
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
import {
  findDraftById,
  findDraftByIdempotencyKey,
  insertDraftSchedule,
  linkDraftItemAppointment,
  listDraftItems,
  listAwaitingDrafts,
  listDrafts,
  replaceDraftItems,
  updateDraftStatus,
} from '../../../../packages/db/src/schedules.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ScheduleServiceError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'invalid-status'
      | 'complaint-not-schedulable'
      | 'technician-unavailable'
      | 'technician-conflict'
      | 'active-appointment-conflict',
    message: string,
  ) {
    super(message);
  }
}

async function lockIds(
  client: import('pg').PoolClient,
  table: 'complaints' | 'technicians',
  ids: string[],
): Promise<void> {
  const uniqueIds = [...new Set(ids)].sort((left, right) => Number(left) - Number(right));
  for (const id of uniqueIds) {
    await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  }
}

export function createScheduleService(pool: Pool) {
  async function list(input: { page?: number; pageSize?: number }) {
    const client = await pool.connect();
    try {
      return await listDrafts(client, input.page ?? 1, input.pageSize ?? 25);
    } finally {
      client.release();
    }
  }

  async function awaiting() {
    const client = await pool.connect();
    try {
      return await listAwaitingDrafts(client);
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const draft = await findDraftById(client, id);
      if (!draft) throw new ScheduleServiceError('not-found', 'The draft schedule was not found.');
      return { draft, items: await listDraftItems(client, id) };
    } finally {
      client.release();
    }
  }

  async function create(
    input: unknown,
    idempotencyKey: string,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = draftScheduleSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const draft = await insertDraftSchedule(client, idempotencyKey, profileId);
      const existingItems = await listDraftItems(client, draft.id);
      if (existingItems.length === 0) {
        const items = await replaceDraftItems(client, draft.id, data.items);
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'schedule.draft_created',
          targetType: 'draft_schedule',
          targetId: draft.id,
          metadata: { itemCount: items.length },
          requestId,
        });
        return { draft, items };
      }
      return { draft, items: existingItems };
    });
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = draftScheduleSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const draft = await findDraftById(client, id, true);
      if (!draft) throw new ScheduleServiceError('not-found', 'The draft schedule was not found.');
      if (draft.status !== 'Draft')
        throw new ScheduleServiceError('invalid-status', 'Only draft schedules can be updated.');
      const items = await replaceDraftItems(client, id, data.items);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'schedule.draft_updated',
        targetType: 'draft_schedule',
        targetId: id,
        metadata: { itemCount: items.length },
        requestId,
      });
      return { draft, items };
    });
  }

  async function cancel(id: string, profileId: string, requestId: string = randomUUID()) {
    return withTransaction(pool, async (client) => {
      const draft = await findDraftById(client, id, true);
      if (!draft) throw new ScheduleServiceError('not-found', 'The draft schedule was not found.');
      if (draft.status !== 'Draft')
        throw new ScheduleServiceError('invalid-status', 'Only draft schedules can be cancelled.');
      const updated = await updateDraftStatus(client, id, 'Cancelled');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'schedule.draft_cancelled',
        targetType: 'draft_schedule',
        targetId: id,
        metadata: {},
        requestId,
      });
      return updated;
    });
  }

  async function promote(id: string, profileId: string, requestId: string = randomUUID()) {
    return withTransaction(pool, async (client) => {
      const draft = await findDraftById(client, id, true);
      if (!draft) throw new ScheduleServiceError('not-found', 'The draft schedule was not found.');
      const items = await listDraftItems(client, id, true);
      if (draft.status === 'Promoted') {
        const appointments = [];
        for (const item of items) {
          if (!item.appointmentId) continue;
          const appointment = await findAppointmentById(client, item.appointmentId);
          if (!appointment)
            throw new ScheduleServiceError(
              'not-found',
              'A promoted draft appointment was not found.',
            );
          appointments.push(appointment);
        }
        return { draft, items, appointments };
      }
      if (draft.status !== 'Draft')
        throw new ScheduleServiceError('invalid-status', 'Only draft schedules can be promoted.');
      await lockIds(
        client,
        'complaints',
        items.map((item) => item.complaintId),
      );
      await lockIds(
        client,
        'technicians',
        items.flatMap((item) => (item.technicianId ? [item.technicianId] : [])),
      );
      const appointments = [];
      for (const item of items) {
        const complaint = await findComplaintById(client, item.complaintId, true);
        if (!complaint)
          throw new ScheduleServiceError('not-found', 'A draft complaint was not found.');
        if (complaint.status !== 'Ready for Scheduling')
          throw new ScheduleServiceError(
            'complaint-not-schedulable',
            `Complaint ${complaint.complaintReference} cannot be scheduled from ${complaint.status}.`,
          );
        if (item.technicianId) {
          const technician = await findTechnicianById(client, item.technicianId, true);
          if (!technician)
            throw new ScheduleServiceError('not-found', 'A draft technician was not found.');
          if (!technician.active) {
            throw new ScheduleServiceError(
              'technician-unavailable',
              'A draft technician is inactive.',
            );
          }
          // Day-only cap check (see modification.md #8) -- this unused
          // legacy draft-schedule path never had a frontend route, but is
          // kept compiling and consistent with the live scheduling flow.
          const dailyCount = await countTechnicianAppointmentsOnDate(
            client,
            item.technicianId,
            item.appointmentDate,
          );
          if (dailyCount >= technician.maxAppointmentsPerDay) {
            throw new ScheduleServiceError(
              'technician-conflict',
              `A draft technician already has ${dailyCount} of ${technician.maxAppointmentsPerDay} appointments for that day.`,
            );
          }
        }
        const active = await client.query(
          "SELECT 1 FROM appointments WHERE complaint_id = $1 AND status <> 'Cancelled' LIMIT 1",
          [item.complaintId],
        );
        if (active.rowCount)
          throw new ScheduleServiceError(
            'active-appointment-conflict',
            'A draft complaint already has an active appointment.',
          );
        const reference = await allocateAppointmentReference(client, item.appointmentDate);
        const appointment = await insertAppointment(client, {
          appointmentReference: reference,
          complaintId: complaint.id,
          customerId: complaint.customerId,
          branchId: complaint.branchId,
          technicianId: item.technicianId,
          customerType: complaint.customerType,
          customerName: complaint.customerName,
          contactNumber: complaint.contactNumber,
          customerEmail: complaint.customerEmail,
          address: complaint.address,
          region: complaint.region,
          brand: complaint.brand,
          model: complaint.model,
          itemCode: complaint.serialOrItemCode,
          faultDescription: complaint.description,
          jobWarranty: complaint.warrantyClassification,
          salesOrderNumber: complaint.salesOrderNumber,
          appointmentDate: item.appointmentDate,
          appointmentTime: item.appointmentTime,
          createdBy: profileId,
        });
        await insertAppointmentHistory(
          client,
          appointment.id,
          null,
          'Scheduled',
          profileId,
          'Draft promoted',
        );
        await updateComplaintStatus(client, complaint.id, { status: 'Scheduled' }, profileId);
        await insertComplaintHistory(
          client,
          complaint.id,
          complaint.status,
          'Scheduled',
          profileId,
          'Draft promoted',
        );
        await linkDraftItemAppointment(client, item.id, appointment.id);
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'appointment.created',
          targetType: 'appointment',
          targetId: appointment.id,
          metadata: { draftScheduleId: id, complaintId: complaint.id },
          requestId,
        });
        appointments.push(appointment);
      }
      const updated = await updateDraftStatus(client, id, 'Promoted');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'schedule.draft_promoted',
        targetType: 'draft_schedule',
        targetId: id,
        metadata: { appointmentCount: appointments.length },
        requestId,
      });
      return { draft: updated, items: await listDraftItems(client, id), appointments };
    });
  }

  return {
    awaiting,
    list,
    create,
    detail,
    update,
    cancel,
    promote,
    findByIdempotencyKey: async (key: string) => {
      const client = await pool.connect();
      try {
        return findDraftByIdempotencyKey(client, key);
      } finally {
        client.release();
      }
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;
