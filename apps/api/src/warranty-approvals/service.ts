import { randomUUID, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import {
  warrantyApprovalCreateSchema,
  warrantyApprovalListQuerySchema,
  warrantyApprovalDecisionSchema,
} from '../../../../packages/contracts/src/index.js';
import {
  findWarrantyApprovalById,
  findWarrantyApprovalByToken,
  insertWarrantyApproval,
  listWarrantyApprovals,
  recordWarrantyApprovalDecision,
} from '../../../../packages/db/src/warranty-approvals.js';
import { findServiceJobCardById } from '../../../../packages/db/src/job-cards.js';
import { findInspectionById } from '../../../../packages/db/src/inspections.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateWarrantyApprovalReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class WarrantyApprovalError extends Error {
  constructor(
    public readonly code: 'not-found' | 'source-not-found' | 'already-decided',
    message: string,
  ) {
    super(message);
  }
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
        customerName,
        contactNumber,
        itemDescription,
        warrantyStatus,
        estimatedCost: data.estimatedCost ?? null,
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
      });
      if (!approval) {
        throw new WarrantyApprovalError('not-found', 'This approval link is no longer valid.');
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

  return { create, list, detail, publicDetail, decide };
}

export type WarrantyApprovalService = ReturnType<typeof createWarrantyApprovalService>;
