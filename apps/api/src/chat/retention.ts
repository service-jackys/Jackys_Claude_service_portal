import type { Pool } from 'pg';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { purgeOldChatMessages } from '../../../../packages/db/src/chat.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { deleteAttachmentFile } from '../attachments/storage.js';

// Removes chat messages (and their files) older than `days`. Pinned messages are kept.
export async function runChatRetention(pool: Pool, days: number) {
  const result = await withTransaction(pool, async (client) => {
    const purged = await purgeOldChatMessages(client, days);
    if (purged.messages || purged.storageKeys.length)
      await insertAuditEvent(client, {
        actorProfileId: null,
        action: 'chat.retention_purged',
        targetType: 'chat',
        targetId: undefined,
        metadata: { days, messages: purged.messages, files: purged.storageKeys.length },
      });
    return purged;
  });
  for (const key of result.storageKeys) await deleteAttachmentFile(key);
  return { messages: result.messages, files: result.storageKeys.length };
}

// CHAT_RETENTION_DAYS (0 or unset = keep everything). Checked every six hours.
export function startChatRetention(pool: Pool): void {
  const days = Number(process.env.CHAT_RETENTION_DAYS || 0);
  if (!Number.isFinite(days) || days < 30) return;
  const run = () =>
    runChatRetention(pool, days).catch((error) => console.error('Chat retention failed', error));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
