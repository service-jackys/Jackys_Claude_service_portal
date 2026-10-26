import type { Pool, PoolClient } from 'pg';
import {
  chatConversationCreateSchema,
  chatMembersSchema,
  chatMessageEditSchema,
  chatMessageWriteSchema,
  chatPinSchema,
  chatPushSubscribeSchema,
  chatPushUnsubscribeSchema,
  chatReactionSchema,
  chatSearchQuerySchema,
  chatSettingsSchema,
  chatMessagesQuerySchema,
  chatMuteSchema,
  chatReadSchema,
} from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  canReadChatRecord,
  createChatChannel,
  deleteChatMessage,
  deleteChatPushSubscription,
  editChatMessage,
  ensureChatMember,
  findChatAttachment,
  findChatConversation,
  getChatPreferences,
  insertChatAttachment,
  findChatMessage,
  findChatRecord,
  findOrCreateDirectConversation,
  findOrCreateRecordConversation,
  insertChatMessage,
  isChatMember,
  listChatConversations,
  listChatMemberReads,
  listChatMembers,
  listChatMessages,
  listChatPeopleAccess,
  listPinnedChatMessages,
  saveChatPushSubscription,
  searchChatMessages,
  setChatPreferences,
  setChatPinned,
  toggleChatReaction,
  markChatAnswered,
  markChatRead,
  removeChatMember,
  setChatMuted,
  type ChatConversationRow,
  type ChatMessageRow,
  type ChatProfileAccess,
} from '../../../../packages/db/src/chat.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import type { ApplicationAuth } from '../auth/application-auth.js';
import {
  deleteAttachmentFile,
  readAttachmentFile,
  saveAttachmentFile,
  validateAttachment,
} from '../attachments/storage.js';
import { mailEnabled } from '../mail/mailer.js';
import { onlineProfileIds, sendToProfiles } from './hub.js';
import { createChatNotifier, type ChatNotifier } from './notifier.js';
import { pushEnabled, vapidPublicKey } from './push.js';
import { createSignedDownloadToken, verifySignedDownloadToken } from '../attachments/signed-url.js';

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

// Signed links last 12 hours: long enough for an open chat screen, short enough that a
// forwarded link stops working. The namespace stops a job-card attachment token being
// reused for a chat attachment that happens to share its number.
const ATTACHMENT_LINK_SECONDS = 12 * 60 * 60;
function attachmentUrl(id: string): string {
  const { token, expiresAt } = createSignedDownloadToken(`chat-${id}`, ATTACHMENT_LINK_SECONDS);
  return `/api/chat/attachments/${id}/download?token=${encodeURIComponent(token)}&expires=${expiresAt}`;
}
function withUrls<T extends ChatMessageRow>(message: T): T {
  if (!message.attachments?.length) return message;
  return {
    ...message,
    attachments: message.attachments.map((file) => ({ ...file, url: attachmentUrl(file.id) })),
  };
}

export function createChatService(pool: Pool, notifier?: ChatNotifier) {
  const notify = notifier ?? createChatNotifier(pool);
  // ---- live events (see hub.ts): small nudges; screens refetch through the normal API.
  async function followers(conversationId: string) {
    const client = await pool.connect();
    try {
      return await listChatMemberReads(client, conversationId);
    } finally {
      client.release();
    }
  }
  async function changed(conversationId: string) {
    try {
      sendToProfiles(
        (await followers(conversationId)).map((m) => m.profileId),
        { type: 'change', data: { conversationId } },
      );
    } catch {
      /* live updates are best effort; polling still catches up */
    }
  }
  async function announce(auth: ApplicationAuth, conversationId: string, message: ChatMessageRow) {
    try {
      const client = await pool.connect();
      let title: string | null = null;
      let kind = 'direct';
      let recordType: string | null = null;
      let recordId: string | null = null;
      try {
        const conversation = await findChatConversation(client, conversationId);
        if (conversation) {
          kind = conversation.kind;
          recordType = conversation.recordType;
          recordId = conversation.recordId === null ? null : String(conversation.recordId);
          title = conversation.title;
          if (kind === 'record') {
            const record = await findChatRecord(
              client,
              conversation.recordType as never,
              String(conversation.recordId),
            );
            title = record?.label ?? null;
          }
        }
      } finally {
        client.release();
      }
      const people = await followers(conversationId);
      const mentioned = new Set(message.mentions.map((m) => m.id));
      const preview = message.body
        ? message.body.slice(0, 140)
        : message.attachments.length
          ? message.attachments.some((f) => f.contentType.startsWith('image/'))
            ? 'Sent a photo'
            : 'Sent a file'
          : '';
      const byId = new Map(people.map((m) => [m.profileId, m]));
      sendToProfiles(
        people.map((m) => m.profileId),
        (profileId) =>
          profileId === auth.profileId
            ? { type: 'change', data: { conversationId } }
            : {
                type: 'message',
                data: {
                  conversationId,
                  messageId: message.id,
                  senderId: auth.profileId,
                  senderName: auth.displayName,
                  preview,
                  kind,
                  title,
                  recordType,
                  recordId,
                  mention: mentioned.has(profileId),
                  muted: Boolean(byId.get(profileId)?.muted),
                },
              },
      );
      const online = new Set(onlineProfileIds());
      await notify.dispatch({
        conversationId,
        messageId: message.id,
        senderName: auth.displayName,
        title: title ?? (kind === 'direct' ? auth.displayName : 'Chat'),
        preview,
        recipients: people
          .filter((m) => m.profileId !== auth.profileId)
          .map((m) => ({
            profileId: m.profileId,
            muted: m.muted,
            mention: mentioned.has(m.profileId),
            online: online.has(m.profileId),
          })),
      });
    } catch {
      /* best effort */
    }
  }

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

  const api = {
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
        return (await listChatMessages(client, id, q)).map(withUrls);
      } finally {
        client.release();
      }
    },

    async send(auth: ApplicationAuth, id: string, body: unknown, requestId?: string) {
      const data = parse(chatMessageWriteSchema, body);
      const sent = await withTransaction(pool, async (client) => {
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
        const attachmentIds = [...new Set(data.attachmentIds)];
        if (!data.body && !attachmentIds.length)
          throw new ChatServiceError('invalid', 'Write a message or attach a file.');
        for (const attachmentId of attachmentIds) {
          const file = await findChatAttachment(client, attachmentId);
          if (
            !file ||
            file.conversationId !== conversation.id ||
            file.uploadedBy !== auth.profileId ||
            file.messageId !== null
          )
            throw new ChatServiceError(
              'invalid',
              'An attached file could not be found. Upload it again.',
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
          attachmentIds,
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
            attachments: attachmentIds.length,
          },
          requestId,
        });
        return withUrls(message);
      });
      await announce(auth, sent.conversationId, sent);
      return sent;
    },

    async read(auth: ApplicationAuth, id: string, body: unknown) {
      const data = parse(chatReadSchema, body);
      const client = await pool.connect();
      try {
        const { conversation } = await open(client, auth, id);
        await ensureChatMember(client, conversation.id, auth.profileId);
        await markChatRead(client, conversation.id, auth.profileId, data.messageId);
        const people = await listChatMemberReads(client, conversation.id);
        sendToProfiles(
          people.filter((m) => m.profileId !== auth.profileId).map((m) => m.profileId),
          {
            type: 'read',
            data: {
              conversationId: conversation.id,
              profileId: auth.profileId,
              messageId: data.messageId,
            },
          },
        );
      } finally {
        client.release();
      }
    },

    async reads(auth: ApplicationAuth, id: string) {
      const client = await pool.connect();
      try {
        await open(client, auth, id);
        return await listChatMemberReads(client, id);
      } finally {
        client.release();
      }
    },

    async typing(auth: ApplicationAuth, id: string) {
      const client = await pool.connect();
      try {
        const { conversation } = await open(client, auth, id);
        const people = await listChatMemberReads(client, conversation.id);
        sendToProfiles(
          people.filter((m) => m.profileId !== auth.profileId).map((m) => m.profileId),
          {
            type: 'typing',
            data: {
              conversationId: conversation.id,
              profileId: auth.profileId,
              name: auth.displayName,
            },
          },
        );
      } finally {
        client.release();
      }
    },

    presence() {
      return onlineProfileIds();
    },

    async answer(auth: ApplicationAuth, messageId: string) {
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        await open(client, auth, message.conversationId);
        await markChatAnswered(client, messageId, auth.profileId);
        return withUrls((await findChatMessage(client, messageId))!);
      });
    },

    async pins(auth: ApplicationAuth, id: string) {
      const client = await pool.connect();
      try {
        await open(client, auth, id);
        return (await listPinnedChatMessages(client, id)).map(withUrls);
      } finally {
        client.release();
      }
    },

    async edit(auth: ApplicationAuth, messageId: string, body: unknown, requestId?: string) {
      const data = parse(chatMessageEditSchema, body);
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        const { conversation, record } = await open(client, auth, message.conversationId);
        if (message.senderId !== auth.profileId)
          throw new ChatServiceError('forbidden', 'You can only edit your own messages.');
        if (message.deleted) throw new ChatServiceError('invalid', 'That message was deleted.');
        const mentionIds = [...new Set(data.mentionIds)].filter((m) => m !== auth.profileId);
        if (mentionIds.length) {
          const allowed = new Set((await who(client, conversation, record)).map((p) => p.id));
          if (mentionIds.some((m) => !allowed.has(m)))
            throw new ChatServiceError(
              'invalid',
              'You can only mention people who can see this conversation.',
            );
        }
        await editChatMessage(client, messageId, data.body, mentionIds);
        await insertAuditEvent(client, {
          actorProfileId: auth.profileId,
          action: 'chat.message_edited',
          targetType: 'chat_message',
          targetId: messageId,
          metadata: { conversationId: conversation.id, previousBody: message.body },
          requestId,
        });
        return withUrls((await findChatMessage(client, messageId))!);
      });
    },

    async remove(auth: ApplicationAuth, messageId: string, requestId?: string) {
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        const { conversation } = await open(client, auth, message.conversationId);
        if (message.senderId !== auth.profileId && !can(auth, 'chat.moderate'))
          throw new ChatServiceError('forbidden', 'You can only delete your own messages.');
        if (message.deleted) return withUrls(message);
        await deleteChatMessage(client, messageId, auth.profileId);
        await insertAuditEvent(client, {
          actorProfileId: auth.profileId,
          action: 'chat.message_deleted',
          targetType: 'chat_message',
          targetId: messageId,
          metadata: {
            conversationId: conversation.id,
            byModerator: message.senderId !== auth.profileId,
            previousBody: message.body,
          },
          requestId,
        });
        return withUrls((await findChatMessage(client, messageId))!);
      });
    },

    async react(auth: ApplicationAuth, messageId: string, body: unknown) {
      const data = parse(chatReactionSchema, body);
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        await open(client, auth, message.conversationId);
        if (message.deleted) throw new ChatServiceError('invalid', 'That message was deleted.');
        await toggleChatReaction(client, messageId, auth.profileId, data.emoji);
        return withUrls((await findChatMessage(client, messageId))!);
      });
    },

    async pin(auth: ApplicationAuth, messageId: string, body: unknown, requestId?: string) {
      const data = parse(chatPinSchema, body);
      return withTransaction(pool, async (client) => {
        const message = await findChatMessage(client, messageId);
        if (!message) throw new ChatServiceError('not-found', 'Message not found.');
        await open(client, auth, message.conversationId);
        if (message.deleted) throw new ChatServiceError('invalid', 'That message was deleted.');
        await setChatPinned(client, messageId, auth.profileId, data.pinned);
        await insertAuditEvent(client, {
          actorProfileId: auth.profileId,
          action: data.pinned ? 'chat.message_pinned' : 'chat.message_unpinned',
          targetType: 'chat_message',
          targetId: messageId,
          metadata: { conversationId: message.conversationId },
          requestId,
        });
        return withUrls((await findChatMessage(client, messageId))!);
      });
    },

    async search(auth: ApplicationAuth, query: unknown) {
      const q = parse(chatSearchQuerySchema, query);
      const client = await pool.connect();
      try {
        const hits = await searchChatMessages(client, auth.profileId, q.q, q.limit * 3);
        const result = [];
        const seen = new Map<string, boolean>();
        for (const hit of hits) {
          if (hit.kind === 'record') {
            const key = `${hit.recordType}:${hit.recordId}`;
            if (!seen.has(key)) {
              const record = await findChatRecord(
                client,
                hit.recordType as never,
                String(hit.recordId),
              );
              seen.set(key, Boolean(record && canReadChatRecord(me(auth), record)));
            }
            if (!seen.get(key)) continue;
          }
          result.push(hit);
          if (result.length >= q.limit) break;
        }
        return result;
      } finally {
        client.release();
      }
    },

    async uploadAttachment(
      auth: ApplicationAuth,
      id: string,
      file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
      requestId?: string,
    ) {
      try {
        validateAttachment(file);
      } catch (error) {
        throw new ChatServiceError('invalid', (error as Error).message);
      }
      const client = await pool.connect();
      try {
        const { conversation } = await open(client, auth, id);
        const storageKey = await saveAttachmentFile(file.buffer, file.mimetype);
        try {
          const row = await insertChatAttachment(client, {
            conversationId: conversation.id,
            uploadedBy: auth.profileId,
            fileName: file.originalname.slice(0, 200) || 'file',
            contentType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
          });
          await insertAuditEvent(client, {
            actorProfileId: auth.profileId,
            action: 'chat.attachment_uploaded',
            targetType: 'chat_attachment',
            targetId: row.id,
            metadata: {
              conversationId: conversation.id,
              fileName: row.fileName,
              contentType: row.contentType,
              sizeBytes: row.sizeBytes,
            },
            requestId,
          });
          return {
            id: row.id,
            fileName: row.fileName,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
            url: attachmentUrl(row.id),
          };
        } catch (error) {
          await deleteAttachmentFile(storageKey);
          throw error;
        }
      } finally {
        client.release();
      }
    },

    // Authorised by the signed token alone so it works as an <img src> / <a href>.
    async downloadAttachment(id: string, token: string, expires: string) {
      const client = await pool.connect();
      try {
        const file = await findChatAttachment(client, id);
        if (!file || !verifySignedDownloadToken(`chat-${id}`, token, Number(expires)))
          throw new ChatServiceError('not-found', 'This download link is not valid.');
        if (file.messageId) {
          const message = await findChatMessage(client, file.messageId);
          if (!message || message.deleted)
            throw new ChatServiceError('not-found', 'This file is no longer available.');
        }
        return { file, buffer: await readAttachmentFile(file.storageKey) };
      } finally {
        client.release();
      }
    },

    async settings(auth: ApplicationAuth) {
      const client = await pool.connect();
      try {
        const prefs = await getChatPreferences(client, auth.profileId);
        return {
          emailOnMention: prefs.emailOnMention,
          emailAvailable: mailEnabled(),
          pushAvailable: pushEnabled(),
          vapidPublicKey: pushEnabled() ? vapidPublicKey() : null,
        };
      } finally {
        client.release();
      }
    },

    async updateSettings(auth: ApplicationAuth, body: unknown) {
      const data = parse(chatSettingsSchema, body);
      const client = await pool.connect();
      try {
        await setChatPreferences(client, auth.profileId, data.emailOnMention);
      } finally {
        client.release();
      }
    },

    async pushSubscribe(auth: ApplicationAuth, body: unknown, userAgent: string | null) {
      const data = parse(chatPushSubscribeSchema, body);
      if (!pushEnabled())
        throw new ChatServiceError('invalid', 'Background alerts are not set up on the server.');
      const client = await pool.connect();
      try {
        await saveChatPushSubscription(client, {
          profileId: auth.profileId,
          endpoint: data.endpoint,
          p256dh: data.keys.p256dh,
          auth: data.keys.auth,
          userAgent: userAgent?.slice(0, 300) ?? null,
        });
      } finally {
        client.release();
      }
    },

    async pushUnsubscribe(auth: ApplicationAuth, body: unknown) {
      const data = parse(chatPushUnsubscribeSchema, body);
      const client = await pool.connect();
      try {
        await deleteChatPushSubscription(client, data.endpoint, auth.profileId);
      } finally {
        client.release();
      }
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

  // Edits, deletes, reactions, pins and answers nudge everyone following the thread.
  const live = (run: (...args: never[]) => Promise<ChatMessageRow>) =>
    (async (...args: never[]) => {
      const message = await run(...args);
      await changed(message.conversationId);
      return message;
    }) as never;
  return {
    ...api,
    answer: live(api.answer as never) as typeof api.answer,
    edit: live(api.edit as never) as typeof api.edit,
    remove: live(api.remove as never) as typeof api.remove,
    react: live(api.react as never) as typeof api.react,
    pin: live(api.pin as never) as typeof api.pin,
  };
}

export type ChatService = ReturnType<typeof createChatService>;
export type { ChatProfileAccess };
