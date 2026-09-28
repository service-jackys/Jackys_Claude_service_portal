import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Private local-disk storage for job-card attachments. Deliberately outside
// apps/web (the static root the server serves), addressed only by an opaque
// storage_key -- see packages/db/migrations/007_job_card_attachments.sql for
// why this is the swap point for Supabase Storage in staging/production
// (Phase 8), without changing anything above this module.

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MiB, matches migration 007's CHECK

function storageDir(): string {
  const configured = process.env.ATTACHMENT_STORAGE_DIR || 'storage/attachments';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

export class AttachmentValidationError extends Error {}

export function validateAttachment(file: { mimetype: string; size: number }): void {
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
    throw new AttachmentValidationError(
      `Unsupported file type "${file.mimetype}". Allowed types: JPEG, PNG, WEBP, HEIC, PDF.`,
    );
  }
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(`File is too large. Attachments must be 20 MB or smaller.`);
  }
}

export async function saveAttachmentFile(buffer: Buffer, contentType: string): Promise<string> {
  const dir = storageDir();
  await mkdir(dir, { recursive: true });
  const storageKey = `${randomUUID()}${extensionFor(contentType)}`;
  await writeFile(path.join(dir, storageKey), buffer);
  return storageKey;
}

export async function readAttachmentFile(storageKey: string): Promise<Buffer> {
  return readFile(path.join(storageDir(), storageKey));
}

export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  await rm(path.join(storageDir(), storageKey), { force: true });
}
