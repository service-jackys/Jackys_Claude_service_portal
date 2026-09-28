import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  deleteJobCardAttachment,
  findJobCardAttachmentById,
  insertJobCardAttachment,
  listJobCardAttachments,
} from '../../../../packages/db/src/job-card-attachments.js';
import { findServiceJobCardById } from '../../../../packages/db/src/job-cards.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import {
  deleteAttachmentFile,
  readAttachmentFile,
  saveAttachmentFile,
  validateAttachment,
} from './storage.js';
import { createSignedDownloadToken, verifySignedDownloadToken } from './signed-url.js';

export class AttachmentServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'invalid-file',
    message: string,
  ) {
    super(message);
  }
}

export function createAttachmentService(pool: Pool) {
  async function upload(
    jobCardId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    try {
      validateAttachment(file);
    } catch (error) {
      throw new AttachmentServiceError('invalid-file', (error as Error).message);
    }
    return withTransaction(pool, async (client) => {
      const jobCard = await findServiceJobCardById(client, jobCardId);
      if (!jobCard) {
        throw new AttachmentServiceError('not-found', 'The service job card was not found.');
      }
      const storageKey = await saveAttachmentFile(file.buffer, file.mimetype);
      const attachment = await insertJobCardAttachment(client, {
        jobCardId,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedBy: profileId,
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card_attachment.uploaded',
        targetType: 'job_card_attachment',
        targetId: attachment.id,
        metadata: {
          jobCardId,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
        },
        requestId,
      });
      return attachment;
    });
  }

  async function list(jobCardId: string) {
    const client = await pool.connect();
    try {
      const jobCard = await findServiceJobCardById(client, jobCardId);
      if (!jobCard) {
        throw new AttachmentServiceError('not-found', 'The service job card was not found.');
      }
      const attachments = await listJobCardAttachments(client, jobCardId);
      return attachments.map((attachment) => ({
        ...attachment,
        downloadUrl: buildDownloadUrl(attachment.id),
      }));
    } finally {
      client.release();
    }
  }

  function buildDownloadUrl(attachmentId: string): string {
    const { token, expiresAt } = createSignedDownloadToken(attachmentId);
    return `/api/attachments/${attachmentId}/download?token=${encodeURIComponent(token)}&expires=${expiresAt}`;
  }

  async function download(attachmentId: string, token: string, expires: string) {
    const client = await pool.connect();
    try {
      const attachment = await findJobCardAttachmentById(client, attachmentId);
      if (!attachment) {
        throw new AttachmentServiceError('not-found', 'The attachment was not found.');
      }
      const expiresAt = Number(expires);
      if (!verifySignedDownloadToken(attachmentId, token, expiresAt)) {
        throw new AttachmentServiceError('not-found', 'This download link has expired.');
      }
      const buffer = await readAttachmentFile(attachment.storageKey);
      return { attachment, buffer };
    } finally {
      client.release();
    }
  }

  async function remove(attachmentId: string, profileId: string, requestId: string = randomUUID()) {
    return withTransaction(pool, async (client) => {
      const attachment = await findJobCardAttachmentById(client, attachmentId);
      if (!attachment) {
        throw new AttachmentServiceError('not-found', 'The attachment was not found.');
      }
      await deleteJobCardAttachment(client, attachmentId);
      await deleteAttachmentFile(attachment.storageKey);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'job_card_attachment.deleted',
        targetType: 'job_card_attachment',
        targetId: attachmentId,
        metadata: { jobCardId: attachment.jobCardId, fileName: attachment.fileName },
        requestId,
      });
    });
  }

  return { upload, list, download, remove };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
