import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { userNoteSchema } from '../../packages/contracts/src/index.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { getUserNote, saveUserNote } from '../../packages/db/src/user-notes.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'my notes: private per user, partial saves keep the other fields, defaults for a new user',
  { skip: !databaseUrl, concurrency: false },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    const make = async (label: string) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, $2) RETURNING id`,
          [`note-${randomUUID()}@example.test`, label],
        )
      ).rows[0]!.id;
    const a = await make('Note A');
    const b = await make('Note B');
    try {
      const fresh = await getUserNote(pool, a);
      assert.equal(fresh.body, '');
      assert.equal(fresh.color, 'navy');
      assert.equal(fresh.open, false);

      await saveUserNote(pool, a, { body: 'Call JUMEIRAH back', color: 'teal', open: true });
      await saveUserNote(pool, a, { width: 500, height: 420 });
      await saveUserNote(pool, a, { tabPosition: 20 });
      const saved = await getUserNote(pool, a);
      assert.deepEqual(
        [saved.body, saved.color, saved.open, saved.width, saved.height, saved.tabPosition],
        ['Call JUMEIRAH back', 'teal', true, 500, 420, 20],
      );

      // Typing later does not reset size, colour or tab position.
      await saveUserNote(pool, a, { body: 'Call JUMEIRAH back at 3' });
      const typed = await getUserNote(pool, a);
      assert.deepEqual(
        [typed.body, typed.color, typed.width, typed.tabPosition],
        ['Call JUMEIRAH back at 3', 'teal', 500, 20],
      );

      // Another user never sees it.
      const other = await getUserNote(pool, b);
      assert.equal(other.body, '');
      assert.equal(other.color, 'navy');

      // Limits.
      assert.equal(userNoteSchema.safeParse({ color: 'yellow' }).success, false);
      assert.equal(userNoteSchema.safeParse({ body: 'x'.repeat(20001) }).success, false);
      assert.equal(userNoteSchema.safeParse({ width: 100 }).success, false);
      assert.equal(userNoteSchema.safeParse({ unknown: 1 }).success, false);
      assert.equal(userNoteSchema.safeParse({ open: true, tabPosition: 70 }).success, true);
    } finally {
      await pool.query(`DELETE FROM profiles WHERE id = ANY($1::bigint[])`, [[a, b]]);
      await pool.end();
    }
  },
);
