import { randomUUID, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import {
  warrantyApprovalCreateSchema,
  warrantyApprovalListQuerySchema,
  warrantyApprovalDecisionSchema,
  warrantyApprovalManualDecisionSchema,
  type ApprovalMethod,
} from '../../../../packages/contracts/src/index.js';
import {
  findWarrantyApprovalById,
  findWarrantyApprovalByToken,
  insertWarrantyApproval,
  listWarrantyApprovals,
  recordWarrantyApprovalDecision,
  type WarrantyApprovalRecord,
} from '../../../../packages/db/src/warranty-approvals.js';
import {
  findServiceJobCardById,
  findServiceJobCardByQuotationId,
  insertServiceJobCardHistory,
  setServiceJobCardJobStatus,
} from '../../../../packages/db/src/job-cards.js';
import { findQuotationById } from '../../../../packages/db/src/quotations.js';
import { findInspectionById } from '../../../../packages/db/src/inspections.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateWarrantyApprovalReference } from '../../../../packages/db/src/references.js';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class WarrantyApprovalError extends Error {
  constructor(
    public readonly code: 'not-found' | 'source-not-found' | 'already-decided',
    message: string,
  ) {
    super(message);
  }
}

/** When the customer approves, the job card waiting on that approval (the one the
 *  request was raised against, or the one made from its quotation) moves to WIP. */
export async function releaseJobAfterApproval(
  client: PoolClient,
  approval: Pick<WarrantyApprovalRecord, 'jobCardId' | 'quotationId' | 'approvalReference'>,
  method: ApprovalMethod,
  changedBy: string | null,
  requestId: string,
): Promise<void> {
  const job = approval.jobCardId
    ? await findServiceJobCardById(client, approval.jobCardId, true)
    : approval.quotationId
      ? await findServiceJobCardByQuotationId(client, approval.quotationId, true)
      : null;
  if (!job || job.jobFinalStatus !== 'Customer approval pending') return;
  await setServiceJobCardJobStatus(client, job.id, 'WIP');
  await insertServiceJobCardHistory(
    client,
    job.id,
    'Customer approval pending',
    'WIP',
    changedBy,
    `Customer approved (${method}) - ${approval.approvalReference}`,
    requestId,
  );
}

/** Staff move a job out of "Customer approval pending" by hand: the way the
 *  customer approved is stored as an approved request (completing a pending one if
 *  there is one) so the job and quotation both show it. */
export async function recordManualApprovalForJob(
  client: PoolClient,
  job: {
    id: string;
    quotationId: string | null;
    customerName: string | null;
    customerContact: string | null;
    itemDescription: string | null;
    warrantyStatus: string | null;
    grandTotal: string;
  },
  decision: { method: ApprovalMethod; notes: string | null; decidedByName: string },
  profileId: string,
): Promise<WarrantyApprovalRecord> {
  const pending = await client.query<{ id: string }>(
    `SELECT id FROM warranty_approvals
     WHERE status = 'Pending'
       AND (job_card_id = $1 OR ($2::bigint IS NOT NULL AND quotation_id = $2::bigint))
     ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
    [job.id, job.quotationId],
  );
  let approvalId = pending.rows[0]?.id;
  if (!approvalId) {
    const approvalReference = await allocateWarrantyApprovalReference(
      client,
      new Date().toISOString().slice(0, 10),
    );
    const created = await insertWarrantyApproval(client, {
      approvalReference,
      jobCardId: job.id,
      inspectionId: null,
      quotationId: null,
      customerName: job.customerName,
      contactNumber: job.customerContact,
      itemDescription: job.itemDescription,
      warrantyStatus: job.warrantyStatus,
      estimatedCost: Number(job.grandTotal) || null,
      notes: null,
      accessToken: generateAccessToken(),
      createdBy: profileId,
    });
    approvalId = created.id;
  }
  const approval = await recordWarrantyApprovalDecision(client, approvalId, {
    status: 'Approved',
    decidedByName: decision.decidedByName,
    decisionNotes: decision.notes,
    decisionMethod: decision.method,
  });
  if (!approval) throw new Error('The approval record could not be completed.');
  return approval;
}

function generateAccessToken(): string {
  return randomBytes(24).toString('base64url');
}

export function createWarrantyApprovalService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = warrantyApprovalCreateSchema.parse(input);
    return withTransaction(pool, async (client) => {
      let customerName = data.customerName ?? null;
      let contactNumber = data.contactNumber ?? null;
      let itemDescription = data.itemDescription ?? null;
      let warrantyStatus = data.warrantyStatus ?? null;
      let estimatedCost = data.estimatedCost ?? null;

      if (data.jobCardId) {
        const jobCard = await findServiceJobCardById(client, data.jobCardId);
        if (!jobCard) {
          throw new WarrantyApprovalError(
            'source-not-found',
            'The service job card was not found.',
          );
        }
        customerName = customerName ?? jobCard.customerName;
        contactNumber = contactNumber ?? jobCard.customerContact;
        itemDescription = itemDescription ?? jobCard.itemDescription;
        warrantyStatus = warrantyStatus ?? jobCard.warrantyStatus;
      } else if (data.quotationId) {
        const quotation = await findQuotationById(client, data.quotationId);
        if (!quotation) {
          throw new WarrantyApprovalError('source-not-found', 'The quotation was not found.');
        }
        customerName = customerName ?? quotation.customerName;
        contactNumber = contactNumber ?? quotation.contactNumber;
        itemDescription = itemDescription ?? quotation.projectName;
        warrantyStatus = warrantyStatus ?? quotation.warrantyStatus;
        estimatedCost = estimatedCost ?? (Number(quotation.grandTotal) || null);
      } else if (data.inspectionId) {
        const inspection = await findInspectionById(client, data.inspectionId);
        if (!inspection) {
          throw new WarrantyApprovalError('source-not-found', 'The inspection was not found.');
        }
        customerName = customerName ?? inspection.customerName;
        contactNumber = contactNumber ?? inspection.contactNumber;
        itemDescription = itemDescription ?? inspection.projectName;
        warrantyStatus = warrantyStatus ?? inspection.warrantyStatus;
      }

      const scopeDate = new Date().toISOString().slice(0, 10);
      const approvalReference = await allocateWarrantyApprovalReference(client, scopeDate);
      const approval = await insertWarrantyApproval(client, {
        approvalReference,
        jobCardId: data.jobCardId ?? null,
        inspectionId: data.inspectionId ?? null,
        quotationId: data.quotationId ?? null,
        customerName,
        contactNumber,
        itemDescription,
        warrantyStatus,
        estimatedCost,
        notes: data.notes ?? null,
        accessToken: generateAccessToken(),
        createdBy: profileId,
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'warranty_approval.created',
        targetType: 'warranty_approval',
        targetId: approval.id,
        metadata: { approvalReference: approval.approvalReference },
        requestId,
      });
      return approval;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = warrantyApprovalListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listWarrantyApprovals(client, {
        status: data.status,
        search: data.search,
        page: data.page,
        pageSize: data.pageSize,
      });
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const approval = await findWarrantyApprovalById(client, id);
      if (!approval) {
        throw new WarrantyApprovalError('not-found', 'The warranty approval was not found.');
      }
      return approval;
    } finally {
      client.release();
    }
  }

  /** Public, token-authorized lookup for the customer-facing approval page --
   *  no permission check, since the customer has no staff account. */
  async function publicDetail(token: string) {
    const client = await pool.connect();
    try {
      const approval = await findWarrantyApprovalByToken(client, token);
      if (!approval) {
        throw new WarrantyApprovalError('not-found', 'This approval link is no longer valid.');
      }
      return approval;
    } finally {
      client.release();
    }
  }

  /** Public decision submission -- also token-authorized, and only allowed
   *  once: a Pending request moves to Approved/Declined and stays there. */
  async function decide(token: string, input: unknown, requestId: string = randomUUID()) {
    const data = warrantyApprovalDecisionSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findWarrantyApprovalByToken(client, token, true);
      if (!current) {
        throw new WarrantyApprovalError('not-found', 'This approval link is no longer valid.');
      }
      if (current.status !== 'Pending') {
        throw new WarrantyApprovalError(
          'already-decided',
          `This request was already ${current.status.toLowerCase()} and cannot be changed.`,
        );
      }
      const approval = await recordWarrantyApprovalDecision(client, current.id, {
        status: data.decision,
        decidedByName: data.decidedByName,
        decisionNotes: data.decisionNotes ?? null,
        decisionMethod: 'Customer link',
      });
      if (!approval) {
        throw new WarrantyApprovalError('not-found', 'This approval link is no longer valid.');
      }
      if (approval.status === 'Approved') {
        await releaseJobAfterApproval(client, approval, 'Customer link', null, requestId);
      }
      await insertAuditEvent(client, {
        actorProfileId: null,
        action: 'warranty_approval.decided',
        targetType: 'warranty_approval',
        targetId: approval.id,
        metadata: {
          approvalReference: approval.approvalReference,
          status: approval.status,
          decidedByName: approval.decidedByName,
        },
        requestId,
      });
      return approval;
    });
  }

  /** Staff record a decision the customer gave by phone, email, WhatsApp or in person. */
  async function recordDecision(
    id: string,
    input: unknown,
    profileId: string,
    staffName: string,
    requestId: string = randomUUID(),
  ) {
    const data = warrantyApprovalManualDecisionSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findWarrantyApprovalById(client, id, true);
      if (!current) {
        throw new WarrantyApprovalError('not-found', 'The warranty approval was not found.');
      }
      if (current.status !== 'Pending') {
        throw new WarrantyApprovalError(
          'already-decided',
          `This request was already ${current.status.toLowerCase()} and cannot be changed.`,
        );
      }
      const approval = await recordWarrantyApprovalDecision(client, id, {
        status: data.decision,
        decidedByName: data.decidedByName ?? `Recorded by ${staffName}`,
        decisionNotes: data.decisionNotes ?? null,
        decisionMethod: data.method,
      });
      if (!approval) {
        throw new WarrantyApprovalError('not-found', 'The warranty approval was not found.');
      }
      if (approval.status === 'Approved') {
        await releaseJobAfterApproval(client, approval, data.method, profileId, requestId);
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'warranty_approval.decision_recorded',
        targetType: 'warranty_approval',
        targetId: approval.id,
        metadata: {
          approvalReference: approval.approvalReference,
          status: approval.status,
          method: data.method,
        },
        requestId,
      });
      return approval;
    });
  }

  return { create, list, detail, publicDetail, decide, recordDecision };
}

export type WarrantyApprovalService = ReturnType<typeof createWarrantyApprovalService>;
