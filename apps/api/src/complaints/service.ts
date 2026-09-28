import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  complaintListQuerySchema,
  complaintNotesSchema,
  complaintSchedulingTransitions,
  complaintStatusUpdateSchema,
  publicComplaintSchema,
  type ComplaintListQuery,
  type PublicComplaintInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findComplaintById,
  insertComplaint,
  insertComplaintHistory,
  listComplaintHistory,
  listComplaints,
  updateComplaintNotes,
  updateComplaintStatus,
} from '../../../../packages/db/src/complaints.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateComplaintReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ComplaintServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'invalid-transition' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

function businessDate(): string {
  const timezone = process.env.BUSINESS_TIMEZONE || 'Asia/Dubai';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function createComplaintService(pool: Pool) {
  async function submit(input: unknown, requestId: string = randomUUID()) {
    const data = publicComplaintSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const reference = await allocateComplaintReference(client, businessDate());
      const complaint = await insertComplaint(client, reference, data);
      await insertComplaintHistory(client, complaint.id, null, 'New', null, 'Submitted');
      await insertAuditEvent(client, {
        action: 'complaint.submitted',
        targetType: 'complaint',
        targetId: complaint.id,
        metadata: { complaintReference: complaint.complaintReference },
        requestId,
      });
      return complaint;
    });
  }

  async function list(input: unknown) {
    const query = complaintListQuerySchema.parse(input) as ComplaintListQuery;
    const client = await pool.connect();
    try {
      return await listComplaints(client, query);
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const complaint = await findComplaintById(client, id);
      if (!complaint) throw new ComplaintServiceError('not-found', 'The complaint was not found.');
      const history = await listComplaintHistory(client, id);
      return { complaint, history };
    } finally {
      client.release();
    }
  }

  async function addNotes(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const notes = complaintNotesSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const complaint = await updateComplaintNotes(client, id, notes, profileId);
      if (!complaint) throw new ComplaintServiceError('not-found', 'The complaint was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'complaint.notes_updated',
        targetType: 'complaint',
        targetId: id,
        metadata: {},
        requestId,
      });
      return complaint;
    });
  }

  async function changeStatus(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = complaintStatusUpdateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findComplaintById(client, id, true);
      if (!current) throw new ComplaintServiceError('not-found', 'The complaint was not found.');
      if (!complaintSchedulingTransitions[current.status].includes(data.status)) {
        throw new ComplaintServiceError(
          'invalid-transition',
          `A complaint in ${current.status} cannot transition to ${data.status}.`,
        );
      }
      const updated = await updateComplaintStatus(client, id, data, profileId);
      if (!updated) throw new ComplaintServiceError('not-found', 'The complaint was not found.');
      await insertComplaintHistory(
        client,
        id,
        updated.previousStatus,
        data.status,
        profileId,
        data.reason,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'complaint.status_changed',
        targetType: 'complaint',
        targetId: id,
        metadata: { fromStatus: updated.previousStatus, toStatus: data.status },
        requestId,
      });
      return updated.complaint;
    });
  }

  return { submit, list, detail, addNotes, changeStatus };
}

export type ComplaintService = ReturnType<typeof createComplaintService>;
export type { PublicComplaintInput };
