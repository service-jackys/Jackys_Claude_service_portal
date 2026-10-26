import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ChatServiceError, createChatService } from '../../apps/api/src/chat/service.js';
import type { ApplicationAuth } from '../../apps/api/src/auth/application-auth.js';
import { canReadChatRecord } from '../../packages/db/src/chat.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const authFor = (profileId: string, extra: string[] = [], admin = false): ApplicationAuth => ({
  provider: 'local',
  subject: profileId,
  email: `chat-${profileId}@example.test`,
  displayName: `Chat ${profileId}`,
  profileId,
  roles: [admin ? 'admin' : 'user'],
  permissions: admin ? ['*'] : ['chat.use', ...extra],
});

test('canReadChatRecord: permission, owner-only tasks and admins', () => {
  const appointment = {
    type: 'appointment' as const,
    id: '1',
    label: 'Appointment A',
    permission: 'appointments.read',
    ownerProfileId: null,
  };
  const task = { ...appointment, type: 'task' as const, permission: null, ownerProfileId: '7' };
  const person = (id: string, permissions: string[], isAdmin = false) => ({
    id,
    isAdmin,
    permissions,
  });
  assert.equal(canReadChatRecord(person('1', ['appointments.read']), appointment), true);
  assert.equal(canReadChatRecord(person('1', ['chat.use']), appointment), false);
  assert.equal(canReadChatRecord(person('7', []), task), true);
  assert.equal(canReadChatRecord(person('8', ['appointments.read']), task), false);
  assert.equal(canReadChatRecord(person('9', [], true), task), true);
  assert.equal(canReadChatRecord(person('9', ['*']), task), true);
});

test(
  'Chat: direct chats, channels, record threads, mentions, needs-reply and unread',
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
    const service = createChatService(pool);
    const ids: string[] = [];
    try {
      for (const name of ['a', 'b', 'c', 'nochat']) {
        const result = await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, $2) RETURNING id`,
          [`chat-${name}-${randomUUID()}@example.test`, `Chat ${name}`],
        );
        ids.push(result.rows[0].id);
        if (name !== 'nochat')
          await pool.query(
            `INSERT INTO profile_roles (profile_id, role_id)
             SELECT $1, id FROM roles WHERE code = 'user'`,
            [result.rows[0].id],
          );
      }
      const [a, b, c, nochat] = ids;
      const userA = authFor(a);
      const userB = authFor(b);
      const userC = authFor(c);

      // People: only those with chat.use, never yourself.
      const people = await service.people(userA);
      assert.ok(people.some((p) => p.id === b));
      assert.ok(!people.some((p) => p.id === a));
      assert.ok(!people.some((p) => p.id === nochat));

      // Direct chat is unique per pair and private to the two people.
      const { conversation: dm } = await service.openConversation(userA, {
        kind: 'direct',
        profileId: b,
      });
      const again = await service.openConversation(userB, { kind: 'direct', profileId: a });
      assert.equal(again.conversation.id, dm.id);
      await assert.rejects(
        service.openConversation(userA, { kind: 'direct', profileId: nochat }),
        ChatServiceError,
      );
      await assert.rejects(service.messages(userC, dm.id, {}), /not found/);
      // Administrators do not get to read other people's DMs.
      await assert.rejects(service.messages(authFor(c, [], true), dm.id, {}), /not found/);

      // Sending, unread counts, read marker, needs-reply auto-answer.
      const first = await service.send(userA, dm.id, {
        body: '  Is the part here?  ',
        needsReply: true,
      });
      assert.equal(first.body, 'Is the part here?');
      let summary = await service.summary(userB);
      assert.deepEqual([summary.unread, summary.needsReply], [1, 1]);
      assert.equal((await service.summary(userA)).unread, 0);
      const reply = await service.send(userB, dm.id, { body: 'Yes, arrived', replyToId: first.id });
      assert.equal(reply.replyTo?.body, 'Is the part here?');
      summary = await service.summary(userB);
      assert.deepEqual([summary.unread, summary.needsReply], [0, 0]);
      assert.equal((await service.summary(userA)).unread, 1);
      const list = await service.messages(userA, dm.id, {});
      assert.equal(list.length, 2);
      assert.ok(list[0].answeredAt, 'first message answered by the reply');
      await service.read(userA, dm.id, { messageId: reply.id });
      assert.equal((await service.summary(userA)).unread, 0);
      // Polling: only messages after an id.
      assert.equal((await service.messages(userA, dm.id, { after: first.id })).length, 1);

      // Channels: creator permission, membership, duplicate names, add + leave.
      await assert.rejects(
        service.openConversation(userA, { kind: 'channel', title: 'Ops', memberIds: [b] }),
        /cannot create channels/,
      );
      const title = `Ops ${randomUUID().slice(0, 8)}`;
      const channel = (
        await service.openConversation(authFor(a, ['chat.create_channel']), {
          kind: 'channel',
          title,
          memberIds: [b],
        })
      ).conversation;
      await assert.rejects(
        service.openConversation(authFor(a, ['chat.create_channel']), {
          kind: 'channel',
          title,
          memberIds: [],
        }),
        /already exists/,
      );
      await assert.rejects(service.send(userC, channel.id, { body: 'hi' }), /not found/);
      // Mentions must be people who can see the conversation.
      await assert.rejects(
        service.send(userA, channel.id, { body: '@c hi', mentionIds: [c] }),
        /only mention people/,
      );
      const mention = await service.send(userA, channel.id, {
        body: '@Chat b please check',
        mentionIds: [b],
        needsReply: true,
      });
      assert.equal(mention.mentions[0].id, b);
      summary = await service.summary(userB);
      assert.deepEqual([summary.mentions, summary.needsReply], [1, 1]);
      await assert.rejects(service.addMembers(userB, channel.id, { profileIds: [c] }), /creator/);
      await service.addMembers(userA, channel.id, { profileIds: [c] });
      assert.equal((await service.messages(userC, channel.id, {})).length, 1);
      await service.leave(userC, channel.id);
      await assert.rejects(service.messages(userC, channel.id, {}), /not found/);
      await service.mute(userB, channel.id, { muted: true });
      assert.equal((await service.summary(userB)).unread, 0, 'muted conversations leave the badge');
      const answered = await service.answer(userB, mention.id);
      assert.ok(answered.answeredAt);

      // Record threads inherit the record's access (a task: owner and admins only).
      const taskRow = await pool.query<{ id: string }>(
        `INSERT INTO roi_tasks (owner_profile_id, title) VALUES ($1, 'Chat test task') RETURNING id`,
        [a],
      );
      const taskId = taskRow.rows[0].id;
      await assert.rejects(
        service.openConversation(userB, { kind: 'record', recordType: 'task', recordId: taskId }),
        /cannot open that record/,
      );
      await assert.rejects(
        service.openConversation(userA, {
          kind: 'record',
          recordType: 'task',
          recordId: '999999999',
        }),
        /not found/,
      );
      const thread = (
        await service.openConversation(userA, {
          kind: 'record',
          recordType: 'task',
          recordId: taskId,
        })
      ).conversation;
      const detail = await service.details(userA, thread.id);
      assert.match(String(detail.conversation.recordLabel), /Task Chat test task/);
      await assert.rejects(service.messages(userB, thread.id, {}), /not found/);
      await assert.rejects(
        service.send(userA, thread.id, { body: 'hello', mentionIds: [b] }),
        /only mention people/,
      );
      await service.send(userA, thread.id, { body: 'Parts ordered' });
      const viaAdmin = await service.messages(authFor(c, [], true), thread.id, {});
      assert.equal(viaAdmin.length, 1);
      const listed = await service.conversations(userA);
      assert.ok(listed.conversations.some((row) => row.id === thread.id && row.recordLabel));
      // Losing access hides the thread from the list.
      await pool.query(`UPDATE roi_tasks SET owner_profile_id = $2 WHERE id = $1`, [taskId, b]);
      assert.ok(
        !(await service.conversations(userA)).conversations.some((row) => row.id === thread.id),
      );

      // Validation.
      await assert.rejects(service.send(userA, dm.id, { body: '   ' }), /./);
      await assert.rejects(
        service.send(userA, dm.id, { body: 'x', replyToId: '999999999' }),
        /not found/,
      );
      const audit = await pool.query(
        `SELECT count(*)::int AS n FROM audit_events WHERE action = 'chat.message_sent' AND actor_profile_id = $1`,
        [a],
      );
      assert.ok(audit.rows[0].n >= 3);
    } finally {
      await pool.query(`DELETE FROM chat_conversations WHERE created_by = ANY($1::bigint[])`, [
        ids,
      ]);
      await pool.query(`DELETE FROM roi_tasks WHERE owner_profile_id = ANY($1::bigint[])`, [ids]);
      await pool.end();
    }
  },
);

test(
  'Chat: edit, soft delete, reactions, pins, search and change feed',
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
    const service = createChatService(pool);
    const ids: string[] = [];
    try {
      for (const name of ['a', 'b', 'c']) {
        const result = await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, $2) RETURNING id`,
          [`chat2-${name}-${randomUUID()}@example.test`, `Chat2 ${name}`],
        );
        ids.push(result.rows[0].id);
        await pool.query(
          `INSERT INTO profile_roles (profile_id, role_id)
           SELECT $1, id FROM roles WHERE code = 'user'`,
          [result.rows[0].id],
        );
      }
      const [a, b, c] = ids;
      const userA = authFor(a);
      const userB = authFor(b);
      const userC = authFor(c);
      const { conversation: dm } = await service.openConversation(userA, {
        kind: 'direct',
        profileId: b,
      });
      const word = `zebra${randomUUID().slice(0, 8)}`;
      const m1 = await service.send(userA, dm.id, { body: `first ${word}` });
      const baseline = (await service.messages(userA, dm.id, {})).at(-1)!.rev;

      // Edit: own messages only, keeps an audit trail of the old text.
      await assert.rejects(service.edit(userB, m1.id, { body: 'hijack' }), /only edit your own/);
      const edited = await service.edit(userA, m1.id, { body: `edited ${word}` });
      assert.equal(edited.body, `edited ${word}`);
      assert.ok(edited.editedAt);

      // Reactions toggle on and off, per person.
      let reacted = await service.react(userB, m1.id, { emoji: '👍' });
      assert.deepEqual(
        reacted.reactions.map((r) => [r.emoji, r.profileIds]),
        [['👍', [b]]],
      );
      reacted = await service.react(userA, m1.id, { emoji: '👍' });
      assert.equal(reacted.reactions[0].profileIds.length, 2);
      reacted = await service.react(userB, m1.id, { emoji: '👍' });
      assert.deepEqual(reacted.reactions[0].profileIds, [a]);
      await assert.rejects(service.react(userC, m1.id, { emoji: '👍' }), /not found/);

      // Pins.
      const pinned = await service.pin(userB, m1.id, { pinned: true });
      assert.equal(pinned.pinned, true);
      assert.equal((await service.pins(userA, dm.id)).length, 1);

      // Search finds it for members only.
      assert.equal((await service.search(userA, { q: word })).length, 1);
      assert.equal((await service.search(userC, { q: word })).length, 0);
      await assert.rejects(service.search(userA, { q: 'x' }), /./);

      // Change feed returns edits, reactions and pins since a revision.
      const changes = await service.messages(userA, dm.id, { sinceRev: baseline });
      assert.equal(changes.length, 1);
      assert.equal(changes[0].id, m1.id);

      // Soft delete: author or moderator; body hidden, row kept, audited.
      const m2 = await service.send(userA, dm.id, { body: `second ${word}`, needsReply: true });
      await assert.rejects(service.remove(userB, m2.id), /only delete your own/);
      const gone = await service.remove(userA, m2.id);
      assert.equal(gone.deleted, true);
      assert.equal(gone.body, '');
      assert.equal(gone.needsReply, false);
      assert.equal((await service.search(userA, { q: 'second' + word.slice(5) })).length, 0);
      await assert.rejects(service.edit(userA, m2.id, { body: 'again' }), /deleted/);
      const stored = await pool.query(`SELECT body, deleted_at FROM chat_messages WHERE id = $1`, [
        m2.id,
      ]);
      assert.ok(stored.rows[0].deleted_at);
      assert.match(stored.rows[0].body, /second/);
      const moderated = await service.send(userB, dm.id, { body: 'rude message' });
      const modAuth = authFor(c, ['chat.use', 'chat.moderate']);
      await assert.rejects(service.remove(modAuth, moderated.id), /not found/); // not in the DM
      const audit = await pool.query(
        `SELECT action FROM audit_events WHERE action LIKE 'chat.message_%' AND target_id::text = ANY($1::text[])`,
        [[m1.id, m2.id]],
      );
      const actions = audit.rows.map((row) => row.action);
      for (const action of ['chat.message_edited', 'chat.message_deleted', 'chat.message_pinned'])
        assert.ok(actions.includes(action), action);
    } finally {
      await pool.query(`DELETE FROM chat_conversations WHERE created_by = ANY($1::bigint[])`, [
        ids,
      ]);
      await pool.end();
    }
  },
);
