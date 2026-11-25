import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { userNoteSchema } from '../../../../packages/contracts/src/index.js';
import { getUserNote, saveUserNote } from '../../../../packages/db/src/user-notes.js';
import { problem } from '../api/problem.js';
import type { ApplicationAuth } from '../auth/application-auth.js';

// A person's own floating note. Every user reads and writes only their own row,
// so no permission beyond being signed in is needed.
export function createUserNoteHandlers(
  pool: Pool,
  requireSignedIn: () => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    get: [
      requireSignedIn(),
      async (_request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const client = await pool.connect();
          try {
            response.setHeader('Cache-Control', 'no-store');
            response.json(await getUserNote(client, auth.profileId));
          } finally {
            client.release();
          }
        } catch (error) {
          next(error);
        }
      },
    ],
    save: [
      requireSignedIn(),
      async (request, response, next) => {
        try {
          const parsed = userNoteSchema.safeParse(request.body);
          if (!parsed.success) {
            problem(response, 400, 'invalid', 'Bad Request', 'The note could not be saved.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          const client = await pool.connect();
          try {
            response.json(await saveUserNote(client, auth.profileId, parsed.data));
          } finally {
            client.release();
          }
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
