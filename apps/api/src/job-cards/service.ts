import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  serviceJobCardStatusTransitions,
  serviceJobCardStatusUpdateSchema,
  type ServiceJobCardStatus,
} from '../../../../packages/contracts/src/index.js';
import {
  findServiceJobCardByAppointmentId,
  findServiceJobCardById,
  insertServiceJobCard,
  insertServiceJobCardHistory,
  listServiceJobCardHistory,
  listServiceJobCards,
  updateServiceJobCardStatus,
} from '../../../../packages/db/src/job-cards.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { findAppointmentById } from '../../../../packages/db/src/appointments.js';
import { allocateJobCardReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ServiceJobCardError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'appointment-ineligible'
      | 'duplicate'
      | 'invalid-transition'
      | 'terminal-job-card',
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export function createServiceJobCardService(pool: Pool) {
  async function create(
    appointmentId: string,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    return withTransaction(pool, async (client) => {
      const appointment = await findAppointmentById(client, appointmentId, true);
      if (!appointment) {
        throw new ServiceJobCardError('not-found', 'The appointment was not found.');
      }
      if (appointment.status === 'Completed' || appointment.status === 'Cancelled') {
        throw new ServiceJobCardError(
          'appointment-ineligible',
          `A ${appointment.status.toLowerCase()} appointment cannot receive a job card.`,
        );
      }
      if (await findServiceJobCardByAppointmentId(client, appointmentId, true)) {
        throw new ServiceJobCardError(
          'duplicate',
          'The appointment already has a service job card.',
        );
      }

      const jobCardReference = await allocateJobCardReference(client, appointment.appointmentDate);
      let jobCard;
      try {
        jobCard = await insertServiceJobCard(client, {
          jobCardReference,
          appointmentId,
          createdBy: profileId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ServiceJobCardError(
            'duplicate',
            'The appointment already has a service job card.',
          );
        }
        throw error;
      }
      await insertServiceJobCardHistory(
        client,
        jobCard.id,
        null,
        'Open',
        profileId,
        'Created',
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.created',
        targetType: 'service_job_card',
        targetId: jobCard.id,
        metadata: {
          jobCardReference: jobCard.jobCardReference,
          appointmentId,
          appointmentReference: appointment.appointmentReference,
        },
        requestId,
      });
      return jobCard;
    });
  }

  async function list(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return listServiceJobCards(client, {
        status: typeof query.status === 'string' ? query.status : undefined,
        search: typeof query.search === 'string' ? query.search : undefined,
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 25),
      });
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const jobCard = await findServiceJobCardById(client, id);
      if (!jobCard) throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      const history = await listServiceJobCardHistory(client, id);
      return { jobCard, history };
    } finally {
      client.release();
    }
  }

  async function byAppointment(appointmentId: string) {
    const client = await pool.connect();
    try {
      const appointment = await findAppointmentById(client, appointmentId);
      if (!appointment) throw new ServiceJobCardError('not-found', 'The appointment was not found.');
      const jobCard = await findServiceJobCardByAppointmentId(client, appointmentId);
      return { jobCard };
    } finally {
      client.release();
    }
  }

  async function history(id: string) {
    const client = await pool.connect();
    try {
      if (!(await findServiceJobCardById(client, id))) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      return listServiceJobCardHistory(client, id);
    } finally {
      client.release();
    }
  }

  async function changeStatus(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = serviceJobCardStatusUpdateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findServiceJobCardById(client, id, true);
      if (!current) {
        throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      }
      if (!serviceJobCardStatusTransitions[current.status].includes(data.status)) {
        throw new ServiceJobCardError(
          current.status === 'Completed' || current.status === 'Cancelled'
            ? 'terminal-job-card'
            : 'invalid-transition',
          `A job card in ${current.status} cannot transition to ${data.status}.`,
        );
      }
      const finalized = data.status === 'Completed' || data.status === 'Cancelled';
      const result = await updateServiceJobCardStatus(
        client,
        id,
        data,
        profileId,
        finalized,
      );
      if (!result) throw new ServiceJobCardError('not-found', 'The service job card was not found.');
      await insertServiceJobCardHistory(
        client,
        id,
        result.previousStatus,
        data.status,
        profileId,
        data.reason,
        requestId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card.status_changed',
        targetType: 'service_job_card',
        targetId: id,
        metadata: {
          fromStatus: result.previousStatus,
          toStatus: data.status,
          finalized,
        },
        requestId,
      });
      return result.jobCard;
    });
  }

  return { list, create, detail, byAppointment, history, changeStatus };
}

export type ServiceJobCardService = ReturnType<typeof createServiceJobCardService>;
