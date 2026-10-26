import type { Pool, PoolClient } from 'pg';
import {
  chatConversationCreateSchema,
  chatMembersSchema,
  chatMessageWriteSchema,
  chatMessagesQuerySchema,
  chatMuteSchema,
  chatReadSchema,
} from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  canReadChatRecord,
  createChatChannel,
  ensureChatMember,
  findChatConversation,
  findChatMessage,
  findChatRecord,
  findOrCreateDirectConversation,
  findOrCreateRecordConversation,
  insertChatMessage,
  isChatMember,
  listChatConversations,
  listChatMembers,
  listChatMessages,
  listChatPeopleAccess,
  markChatAnswered,
  markChatRead,
  removeChatMember,
  setChatMuted,
  type ChatConversationRow,
  type ChatProfileAccess,
} from '../../../../packages/db/src/chat.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import type { ApplicationAuth } from '../auth/application-auth.js';

export class ChatServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'forbidden' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

const isAdmin = (auth: ApplicationAuth) => auth.permissions.includes('*');
const can = (auth: ApplicationAuth, permission: string) =>
  isAdmin(auth) || auth.permissions.includes(permission);
const me = (auth: ApplicationAuth) => ({
  id: auth.profileId,
  isAdmin: isAdmin(auth),
  permissions: auth.permissions,
});

function parse<T>(
  schema: {
    safeParse: (
      v: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ChatServiceError('invalid', result.error.issues[0]?.message ?? 'Invalid request.');
  return result.data;
}

export function createChatService(pool: Pool) {
  // A conversation the caller may read: direct chats and channels need membership
  // (administrators do not get to read other people's DMs); record threads need the
  // permission to open the record.
  async function open(client: PoolClient, auth: ApplicationAuth, id: string) {
    const conversation = await findChatConversation(client, id);
    if (!conversation) throw new ChatServiceError('not-found', 'Conversation not found.');
    if (conversation.kind === 'record') {
      const record = await findChatRecord(
        client,
        conversation.recordType as never,
        String(conversation.recordId),
      );
      if (!record || !canReadChatRecord(me(auth), record))
        throw new ChatServiceError('not-found', 'Conversation not found.');
      return { conversation, record };
    }
    if (!(await isChatMember(client, conversation.id, auth.profileId)))
      throw new ChatServiceError('not-found', 'Conversation not found.');
    return { conversation, record: null };
  }

  async function who(
    client: PoolClient,
    conversation: ChatConversationRow,
    record: Awaited<ReturnType<typeof findChatRecord>>,
  ) {
    const people = await listChatPeopleAccess(client);
    if (conversation.kind === 'record' && record)
      return people.filter((person) => canReadChatRecord(person, record));
    const members = new Set(
      (await listChatMembers(client, conversation.id)).map((m) => m.profileId),
    );
    return people.filter((person) => members.has(person.id));
  }

  async function summarise(client: PoolClient, auth: ApplicationAuth) {
    const rows = await listChatConversations(client, auth.profileId);
    const visible = [];
    for (const row of rows) {
      if (row.kind === 'record') {
        const record = await findChatRecord(client, row.recordType as never, String(row.recordId));
        if (!record || !canReadChatRecord(me(auth), record)) continue;
      }
      visible.push(row);
    }
    const live = visible.filter((row) => !row.muted);
    return {
      me: { id: auth.profileId, name: auth.displayName },
      conversations: visible,
      unread: live.reduce((sum, row) => sum + row.unread, 0),
      mentions: visible.reduce((sum, row) => sum + row.mentionsUnread, 0),
      needsReply: visible.reduce((sum, row) => sum + row.needsReplyOpen, 0),
    };
  }

  return {
    async people(auth: ApplicationAuth) {
      const client = await pool.connect();
      try {
        const people = await listChatPeopleAccess(client);
        return people.filter((p) => p.id !== auth.profileId).map(({ id, name }) => ({ id, name }));
      } finally {
        client.release();
      }
    },

    async conversations(auth: ApplicationAuth) {
      const client = await pool.connect();
      try {
        return await summarise(client, auth);
      } finally {
        client.release();
      }
    },

    async summary(auth: ApplicationAuth) {
      const client = await pool.connect();
      try {
        const { unread, mentions, needsReply } = await summarise(client, auth);
        return { unread, mentions, needsReply };
      } finally {
        client.release();
      }
    },

    async openConversation(auth: ApplicationAuth, body: unknown, requestId?: string) {
      const data = parse(chatConversationCreateSchema, body);
      return withTransaction(pool, async (client) => {
        let conversation: ChatConversationRow;
        if (data.kind === 'direct') {
          if (data.profileId === auth.profileId)
            throw new ChatServiceError('invalid', 'Choose someone other than yourself.');
          const people = await listChatPeopleAccess(client);
          if (!people.some((p) => p.id === data.profileId))
            throw new ChatServiceError('not-found', 'That person cannot use chat.');
          conversation = await findOrCreateDirectConversation(
            client,
            auth.profileId,
            data.profileId,
          );
        } else if (data.kind === 'channel') {
          if (!can(auth, 'chat.create_channel'))
            throw new ChatServiceError('forbidden', 'You cannot create channels.');
          const people = await listChatPeopleAccess(client);
          const known = new Set(people.map((p) => p.id));
          const members = data.memberIds.filter((id) => known.has(id));
          try {
            conversation = await createChatChannel(client, data.title, auth.profileId, members);
          } catch (error) {
            if ((error as { code?: string }).code === '23505')
              throw new ChatServiceError('invalid', 'A channel with that name already exists.');
            throw error;
          }
          await insertAuditEvent(client, {
            actorProfileId: auth.profileId,
            action: 'chat.channel_created',
            targetType: 'chat_conversation',
            targetId: conversation.id,
            metadata: { title: data.title, members: members.length + 1 },
            requestId,
          });
        } else {
          const record = await findChatRecord(client, data.recordType, data.recordId);
          if (!record) throw new ChatServiceError('not-found', 'That record was not found.');
          if (!canReadChatRecord(me(auth), record))
            throw new ChatServiceError('forbidden', 'You cannot open that record.');
          conversation = await findOrCreateRecordConversation(
            client,
            data.recordType,
            data.recordId,
            auth.profileId,
          );
          await ensureChatMember(client, conversation.id, auth.profileId);
        }
        return { conversation };
      });
    },

    async details(auth: ApplicationAuth, id: string) {
      const client = await pool.connect();
      try {
        const { conversation, record } = await open(client, auth, id);
        const members = await who(client, conversation, record);
        return {
          conversation: { ...conversation, recordLabel: record?.label ?? null },
          people: members
            .filter((p) => p.id !== auth.profileId)
            .map(({ id, name }) => ({ id, name })),
          members:
            conversation.kind === 'record' ? [] : await listChatMembers(client, conversation.id),
        };
      } finally {
        client.release();
      }
    },

    async messages(auth: ApplicationAuth, id: string, query: unknown) {
      const q = parse(chatMessagesQuerySchema, query);
      const client = await pool.connect();
      try {
        await open(client, auth, id);
        return await listChatMessages(client, id, q);
      } finally {
        client.release();
      }
    },

    async send(auth: ApplicationAuth, id: string, body: unknown, requestId?: string) {
      const data = parse(chatMessageWriteSchema, body);
      return withTransaction(pool, async (client) => {
        const { conversation, record } = await open(client, auth, id);
        if (data.replyToId) {
          const target = await findChatMessage(client, data.replyToId);
          if (!target || target.conversationId !== conversation.id)
            throw new ChatServiceError('invalid', 'The message you replied to was not found.');
        }
        const mentionIds = [...new Set(data.mentionIds)].filter((m) => m !== auth.profileId);
        if (mentionIds.length) {
          const allowed = new Set((await who(client, conversation, record)).map((p) => p.id));
          const bad = mentionIds.find((m) => !allowed.has(m));
          if (bad)
            throw new ChatServiceError(
              'invalid',
              'You can only mention people who can see this conversation.',
            );
        }
        await ensureChatMember(client, conversation.id, auth.profileId);
        for (const mentioned of mentionIds)
          await ensureChatMember(client, conversation.id, mentioned);
        const message = await insertChatMessage(client, {
          conversationId: conversation.id,
          senderId: auth.profileId,
          body: data.body,
          replyToId: data.replyToId ?? null,
          needsReply: Boolean(data.needsReply),
          mentionIds,
        });
        await insertAuditEvent(client, {
          actorProfileId: auth.profileId,
          action: 'chat.message_sent',
          targetType: 'chat_conversation',
          targetId: conversation.id,
          metadata: {
            messageId: message.id,
            kind: conversation.kind,
            mentions: mentionIds.length,
            needsReply: message.needsReply,
          },
          requestId,
        });
        return message;
      });
    },

    async read(auth: ApplicationAuth, id: string, body: unknown) {
      const data = parse(chatReadSchema, body);
      const client = await pool.connect();
      try {
        const { conversation } = await open(client, auth, id);
        await ensureChatMember(client, conversation.id, auth.profileId);
        await markChatRead(client, conversation.id, auth.profileId, data.messageId);
      } finally {
        client.release();
      }
    },

    async answer(auth: ApplicationAuth, messageId: string) {
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        await open(client, auth, message.conversationId);
        await markChatAnswered(client, messageId, auth.profileId);
        return (await findChatMessage(client, messageId))!;
      });
    },

    async mute(auth: ApplicationAuth, id: string, body: unknown) {
      const data = parse(chatMuteSchema, body);
      const client = await pool.connect();
      try {
        const { conversation } = await open(client, auth, id);
        await ensureChatMember(client, conversation.id, auth.profileId);
        await setChatMuted(client, conversation.id, auth.profileId, data.muted);
      } finally {
        client.release();
      }
    },

    async addMembers(auth: ApplicationAuth, id: string, body: unknown, requestId?: string) {
      const data = parse(chatMembersSchema, body);
      return withTransaction(pool, async (client) => {
        const { conversation } = await open(client, auth, id);
        if (conversation.kind !== 'channel')
          throw new ChatServiceError('invalid', 'Only channels have members to add.');
        if (conversation.createdBy !== auth.profileId && !can(auth, 'chat.moderate'))
          throw new ChatServiceError('forbidden', 'Only the channel creator can add people.');
        const known = new Set((await listChatPeopleAccess(client)).map((p) => p.id));
        const added = data.profileIds.filter((p) => known.has(p));
        for (const profileId of added) await ensureChatMember(client, conversation.id, profileId);
        await insertAuditEvent(client, {
          actorProfileId: auth.profileId,
          action: 'chat.members_added',
          targetType: 'chat_conversation',
          targetId: conversation.id,
          metadata: { added },
          requestId,
        });
        return { members: await listChatMembers(client, conversation.id) };
      });
    },

    async leave(auth: ApplicationAuth, id: string) {
      return withTransaction(pool, async (client) => {
        const { conversation } = await open(client, auth, id);
        if (conversation.kind === 'direct')
          throw new ChatServiceError('invalid', 'You cannot leave a direct chat.');
        await removeChatMember(client, conversation.id, auth.profileId);
      });
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
export type { ChatProfileAccess };
