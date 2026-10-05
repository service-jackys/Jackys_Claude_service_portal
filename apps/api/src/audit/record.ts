import type { Pool } from 'pg';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

// Sign-in / team-login events are recorded best-effort: a problem writing the
// audit row must never stop someone signing in or an admin changing a login.
// The actor is looked up by email (local logins are mirrored to `profiles`);
// a failed sign-in has no actor, so the attempted email goes in the metadata.
export async function recordAuthEvent(
  pool: Pool | null,
  event: {
    action: string;
    actorEmail?: string | null;
    actorProfileId?: string | null;
    targetType?: string;
    metadata?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<void> {
  if (!pool) return;
  try {
    await withTransaction(pool, async (client) => {
      let actorProfileId = event.actorProfileId ?? null;
      if (!actorProfileId && event.actorEmail) {
        const found = await client.query<{ id: string }>(
          'SELECT id::text AS id FROM profiles WHERE lower(email) = lower($1) LIMIT 1',
          [event.actorEmail],
        );
        actorProfileId = found.rows[0]?.id ?? null;
      }
      await insertAuditEvent(client, {
        actorProfileId,
        action: event.action,
        targetType: event.targetType ?? 'user',
        metadata: event.metadata ?? {},
        requestId: event.requestId,
      });
    });
  } catch (error) {
    console.error('Could not write auth audit event', event.action, error);
  }
}
