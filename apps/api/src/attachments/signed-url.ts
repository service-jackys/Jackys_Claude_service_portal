import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed download tokens for attachments, so a download link
// (e.g. embedded as an <img src>) doesn't need to carry the staff bearer
// token. The signature covers the attachment id and the expiry together, so
// neither can be swapped onto the other without invalidating the signature.

function secret(): string {
  const configured = process.env.ATTACHMENT_URL_SECRET;
  if (configured && configured.length >= 16) return configured;
  // Local-dev-only fallback so a missing .env value doesn't hard-crash the
  // server; production must set ATTACHMENT_URL_SECRET (tracked in Phase 8).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ATTACHMENT_URL_SECRET must be set in production.');
  }
  return 'local-development-only-insecure-fallback-secret';
}

function sign(attachmentId: string, expiresAt: number): string {
  return createHmac('sha256', secret()).update(`${attachmentId}.${expiresAt}`).digest('base64url');
}

export function createSignedDownloadToken(
  attachmentId: string,
  ttlSeconds = 300,
): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return { token: sign(attachmentId, expiresAt), expiresAt };
}

export function verifySignedDownloadToken(
  attachmentId: string,
  token: string,
  expiresAt: number,
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = sign(attachmentId, expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(token);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
