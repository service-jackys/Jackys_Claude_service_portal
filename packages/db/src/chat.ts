import type { PoolClient } from 'pg';

export type ChatKind = 'direct' | 'channel' | 'record';
export const CHAT_RECORD_TYPES = [
  'job_card',
  'appointment',
  'schedule',
  'complaint',
  'task',
] as const;
export type ChatRecordType = (typeof CHAT_RECORD_TYPES)[number];

// ---------------------------------------------------------------- access ----
export type ChatProfileAccess = {
  id: string;
  name: string;
  active: boolean;
  isAdmin: boolean;
  permissions: string[];
};

export async function findChatProfileAccess(
  client: PoolClient,
  profileId: string,
): Promise<ChatProfileAccess | null> {
  const result = await client.query<{
    id: string;
    name: string;
    active: boolean;
    roles: string[];
    permissions: string[];
  }>(
    `SELECT p.id, p.display_name AS name, p.active,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT pe.code) FILTER (WHERE pe.code IS NOT NULL), '{}') AS permissions
       FROM profiles p
       LEFT JOIN profile_roles pr ON pr.profile_id = p.id
       LEFT JOIN roles r ON r.id = pr.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions pe ON pe.id = rp.permission_id
      WHERE p.id = $1
      GROUP BY p.id`,
    [profileId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    active: row.active,
    isAdmin: row.roles.includes('admin'),
    permissions: row.permissions,
  };
}

export type ChatRecordInfo = {
  type: ChatRecordType;
  id: string;
  label: string;
  // Permission that lets a person open the record; null for tasks (owner / admin only).
  permission: string | null;
  ownerProfileId: string | null;
};

const recordQueries: Record<
  ChatRecordType,
  { sql: string; permission: string | null; prefix: string }
> = {
  job_card: {
    sql: `SELECT job_card_reference AS label, NULL::bigint AS owner FROM service_job_cards WHERE id = $1`,
    permission: 'service_job_card.read',
    prefix: 'Job card',
  },
  appointment: {
    sql: `SELECT appointment_reference AS label, NULL::bigint AS owner FROM appointments WHERE id = $1`,
    permission: 'appointments.read',
    prefix: 'Appointment',
  },
  complaint: {
    sql: `SELECT complaint_reference AS label, NULL::bigint AS owner FROM complaints WHERE id = $1`,
    permission: 'complaints.read',
    prefix: 'Complaint',
  },
  schedule: {
    sql: `SELECT 'Schedule #' || id::text AS label, NULL::bigint AS owner FROM draft_schedules WHERE id = $1`,
    permission: 'scheduler.read',
    prefix: 'Schedule',
  },
  task: {
    sql: `SELECT title AS label, owner_profile_id AS owner FROM roi_tasks WHERE id = $1`,
    permission: null,
    prefix: 'Task',
  },
};

export async function findChatRecord(
  client: PoolClient,
  type: ChatRecordType,
  id: string,
): Promise<ChatRecordInfo | null> {
  const spec = recordQueries[type];
  if (!spec || !/^\d+$/.test(id)) return null;
  const result = await client.query<{ label: string; owner: string | null }>(spec.sql, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    type,
    id,
    label: spec.prefix + ' ' + row.label.replace(/^Schedule /, ''),
    permission: spec.permission,
    ownerProfileId: row.owner === null ? null : String(row.owner),
  };
}

export function canReadChatRecord(
  access: { id: string; isAdmin: boolean; permissions: string[] },
  record: ChatRecordInfo,
): boolean {
  if (access.permissions.includes('*') || access.isAdmin) return true;
  if (record.permission === null) return record.ownerProfileId === access.id;
  return access.permissions.includes(record.permission);
}

// --------------------------------------------------------- conversations ----
export type ChatConversationRow = {
  id: string;
  kind: ChatKind;
  title: string | null;
  recordType: ChatRecordType | null;
  recordId: string | null;
  createdBy: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
};

const conversationColumns = `
  c.id, c.kind, c.title, c.record_type AS "recordType", c.record_id AS "recordId",
  c.created_by AS "createdBy", c.last_message_at AS "lastMessageAt", c.created_at AS "createdAt"`;

export async function findChatConversation(
  client: PoolClient,
  id: string,
): Promise<ChatConversationRow | null> {
  if (!/^\d+$/.test(id)) return null;
  const result = await client.query<ChatConversationRow>(
    `SELECT ${conversationColumns} FROM chat_conversations c WHERE c.id = $1 AND c.archived_at IS NULL`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function isChatMember(
  client: PoolClient,
  conversationId: string,
  profileId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM chat_members WHERE conversation_id = $1 AND profile_id = $2`,
    [conversationId, profileId],
  );
  return result.rowCount === 1;
}

export async function ensureChatMember(
  client: PoolClient,
  conversationId: string,
  profileId: string,
): Promise<void> {
  // A new follower starts at the latest message, so old history is not "unread".
  await client.query(
    `INSERT INTO chat_members (conversation_id, profile_id, last_read_message_id)
     VALUES ($1, $2, COALESCE((SELECT max(id) FROM chat_messages WHERE conversation_id = $1), 0))
     ON CONFLICT DO NOTHING`,
    [conversationId, profileId],
  );
}

export async function removeChatMember(
  client: PoolClient,
  conversationId: string,
  profileId: string,
): Promise<void> {
  await client.query(`DELETE FROM chat_members WHERE conversation_id = $1 AND profile_id = $2`, [
    conversationId,
    profileId,
  ]);
}

export async function findOrCreateDirectConversation(
  client: PoolClient,
  a: string,
  b: string,
): Promise<ChatConversationRow> {
  const [low, high] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  const key = `${low}:${high}`;
  await client.query(
    `INSERT INTO chat_conversations (kind, direct_key, created_by) VALUES ('direct', $1, $2)
     ON CONFLICT DO NOTHING`,
    [key, a],
  );
  const result = await client.query<ChatConversationRow>(
    `SELECT ${conversationColumns} FROM chat_conversations c WHERE c.direct_key = $1`,
    [key],
  );
  const row = result.rows[0]!;
  await ensureChatMember(client, row.id, low);
  await ensureChatMember(client, row.id, high);
  return row;
}

export async function createChatChannel(
  client: PoolClient,
  title: string,
  createdBy: string,
  memberIds: string[],
): Promise<ChatConversationRow> {
  const created = await client.query<{ id: string }>(
    `INSERT INTO chat_conversations (kind, title, created_by) VALUES ('channel', $1, $2) RETURNING id`,
    [title, createdBy],
  );
  const id = created.rows[0]!.id;
  for (const member of new Set([createdBy, ...memberIds]))
    await ensureChatMember(client, id, member);
  return (await findChatConversation(client, id))!;
}

export async function findOrCreateRecordConversation(
  client: PoolClient,
  type: ChatRecordType,
  recordId: string,
  createdBy: string,
): Promise<ChatConversationRow> {
  await client.query(
    `INSERT INTO chat_conversations (kind, record_type, record_id, created_by)
     VALUES ('record', $1, $2, $3) ON CONFLICT DO NOTHING`,
    [type, recordId, createdBy],
  );
  const result = await client.query<ChatConversationRow>(
    `SELECT ${conversationColumns} FROM chat_conversations c
      WHERE c.kind = 'record' AND c.record_type = $1 AND c.record_id = $2`,
    [type, recordId],
  );
  return result.rows[0]!;
}

export type ChatMemberRow = { profileId: string; name: string };

export async function listChatMembers(
  client: PoolClient,
  conversationId: string,
): Promise<ChatMemberRow[]> {
  const result = await client.query<ChatMemberRow>(
    `SELECT m.profile_id AS "profileId", p.display_name AS name
       FROM chat_members m JOIN profiles p ON p.id = m.profile_id
      WHERE m.conversation_id = $1 ORDER BY p.display_name`,
    [conversationId],
  );
  return result.rows;
}

export type ChatPerson = { id: string; name: string };

// Active people who can use chat (the chat.use permission, or the admin role), with the
// permissions needed to decide which record threads they may open.
export async function listChatPeopleAccess(client: PoolClient): Promise<ChatProfileAccess[]> {
  const result = await client.query<{
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
  }>(
    `SELECT p.id, p.display_name AS name,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT pe.code) FILTER (WHERE pe.code IS NOT NULL), '{}') AS permissions
       FROM profiles p
       LEFT JOIN profile_roles pr ON pr.profile_id = p.id
       LEFT JOIN roles r ON r.id = pr.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions pe ON pe.id = rp.permission_id
      WHERE p.active
      GROUP BY p.id
     HAVING 'admin' = ANY(array_agg(r.code)) OR 'chat.use' = ANY(array_agg(pe.code))
      ORDER BY p.display_name`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    active: true,
    isAdmin: row.roles.includes('admin'),
    permissions: row.permissions,
  }));
}

// -------------------------------------------------------------- listing ----
export type ChatConversationSummary = ChatConversationRow & {
  muted: boolean;
  unread: number;
  mentionsUnread: number;
  needsReplyOpen: number;
  lastBody: string | null;
  lastSenderName: string | null;
  recordLabel: string | null;
  otherProfileId: string | null;
  otherName: string | null;
};

export async function listChatConversations(
  client: PoolClient,
  profileId: string,
): Promise<ChatConversationSummary[]> {
  const result = await client.query<ChatConversationSummary>(
    `SELECT ${conversationColumns}, m.muted,
       (SELECT count(*) FROM chat_messages x
         WHERE x.conversation_id = c.id AND x.id > m.last_read_message_id
           AND x.sender_id <> $1)::int AS unread,
       (SELECT count(*) FROM chat_message_mentions mm
          JOIN chat_messages x ON x.id = mm.message_id
         WHERE mm.profile_id = $1 AND x.conversation_id = c.id
           AND x.id > m.last_read_message_id AND x.sender_id <> $1)::int AS "mentionsUnread",
       (SELECT count(*) FROM chat_messages x
         WHERE x.conversation_id = c.id AND x.needs_reply AND x.answered_at IS NULL
           AND x.sender_id <> $1
           AND (c.kind = 'direct' OR EXISTS (
                 SELECT 1 FROM chat_message_mentions mm
                  WHERE mm.message_id = x.id AND mm.profile_id = $1)))::int AS "needsReplyOpen",
       lm.body AS "lastBody", lp.display_name AS "lastSenderName",
       CASE c.record_type
         WHEN 'job_card' THEN (SELECT 'Job card ' || job_card_reference FROM service_job_cards WHERE id = c.record_id)
         WHEN 'appointment' THEN (SELECT 'Appointment ' || appointment_reference FROM appointments WHERE id = c.record_id)
         WHEN 'complaint' THEN (SELECT 'Complaint ' || complaint_reference FROM complaints WHERE id = c.record_id)
         WHEN 'schedule' THEN 'Schedule #' || c.record_id::text
         WHEN 'task' THEN (SELECT 'Task ' || title FROM roi_tasks WHERE id = c.record_id)
       END AS "recordLabel",
       o.profile_id AS "otherProfileId", op.display_name AS "otherName"
     FROM chat_members m
     JOIN chat_conversations c ON c.id = m.conversation_id AND c.archived_at IS NULL
     LEFT JOIN LATERAL (
       SELECT body, sender_id FROM chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
     ) lm ON true
     LEFT JOIN profiles lp ON lp.id = lm.sender_id
     LEFT JOIN chat_members o ON c.kind = 'direct' AND o.conversation_id = c.id AND o.profile_id <> $1
     LEFT JOIN profiles op ON op.id = o.profile_id
    WHERE m.profile_id = $1
    ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC`,
    [profileId],
  );
  return result.rows.map((row) => ({
    ...row,
    id: String(row.id),
    recordId: row.recordId === null ? null : String(row.recordId),
    otherProfileId: row.otherProfileId === null ? null : String(row.otherProfileId),
  }));
}

// -------------------------------------------------------------- messages ----
export type ChatMessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  replyToId: string | null;
  replyTo: { id: string; senderName: string; body: string } | null;
  needsReply: boolean;
  answeredAt: Date | null;
  answeredByName: string | null;
  mentions: { id: string; name: string }[];
  createdAt: Date;
};

const messageSelect = `
  SELECT x.id, x.conversation_id AS "conversationId", x.sender_id AS "senderId",
         sp.display_name AS "senderName", x.body, x.reply_to_id AS "replyToId",
         CASE WHEN rt.id IS NULL THEN NULL
              ELSE json_build_object('id', rt.id::text, 'senderName', rtp.display_name,
                                     'body', left(rt.body, 160)) END AS "replyTo",
         x.needs_reply AS "needsReply", x.answered_at AS "answeredAt",
         ap.display_name AS "answeredByName",
         COALESCE((SELECT json_agg(json_build_object('id', mp.id::text, 'name', mp.display_name)
                                   ORDER BY mp.display_name)
                     FROM chat_message_mentions mm JOIN profiles mp ON mp.id = mm.profile_id
                    WHERE mm.message_id = x.id), '[]'::json) AS mentions,
         x.created_at AS "createdAt"
    FROM chat_messages x
    JOIN profiles sp ON sp.id = x.sender_id
    LEFT JOIN chat_messages rt ON rt.id = x.reply_to_id
    LEFT JOIN profiles rtp ON rtp.id = rt.sender_id
    LEFT JOIN profiles ap ON ap.id = x.answered_by`;

function shape(row: ChatMessageRow): ChatMessageRow {
  return {
    ...row,
    id: String(row.id),
    conversationId: String(row.conversationId),
    senderId: String(row.senderId),
    replyToId: row.replyToId === null ? null : String(row.replyToId),
  };
}

export async function listChatMessages(
  client: PoolClient,
  conversationId: string,
  options: { after?: string; before?: string; limit: number },
): Promise<ChatMessageRow[]> {
  if (options.after) {
    const result = await client.query<ChatMessageRow>(
      `${messageSelect} WHERE x.conversation_id = $1 AND x.id > $2 ORDER BY x.id LIMIT $3`,
      [conversationId, options.after, options.limit],
    );
    return result.rows.map(shape);
  }
  const result = await client.query<ChatMessageRow>(
    `${messageSelect} WHERE x.conversation_id = $1 AND ($2::bigint IS NULL OR x.id < $2)
      ORDER BY x.id DESC LIMIT $3`,
    [conversationId, options.before ?? null, options.limit],
  );
  return result.rows.map(shape).reverse();
}

export async function findChatMessage(
  client: PoolClient,
  id: string,
): Promise<ChatMessageRow | null> {
  if (!/^\d+$/.test(id)) return null;
  const result = await client.query<ChatMessageRow>(`${messageSelect} WHERE x.id = $1`, [id]);
  return result.rows[0] ? shape(result.rows[0]) : null;
}

export async function insertChatMessage(
  client: PoolClient,
  input: {
    conversationId: string;
    senderId: string;
    body: string;
    replyToId: string | null;
    needsReply: boolean;
    mentionIds: string[];
  },
): Promise<ChatMessageRow> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO chat_messages (conversation_id, sender_id, body, reply_to_id, needs_reply)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.conversationId, input.senderId, input.body, input.replyToId, input.needsReply],
  );
  const id = String(inserted.rows[0]!.id);
  for (const mentioned of new Set(input.mentionIds)) {
    await client.query(
      `INSERT INTO chat_message_mentions (message_id, profile_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, mentioned],
    );
  }
  await client.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [
    input.conversationId,
  ]);
  // Answering: a reply from someone else closes the "needs reply" it quotes.
  if (input.replyToId) {
    await client.query(
      `UPDATE chat_messages SET answered_at = now(), answered_by = $2
        WHERE id = $1 AND needs_reply AND answered_at IS NULL AND sender_id <> $2`,
      [input.replyToId, input.senderId],
    );
  }
  await markChatRead(client, input.conversationId, input.senderId, id);
  return (await findChatMessage(client, id))!;
}

export async function markChatAnswered(
  client: PoolClient,
  messageId: string,
  profileId: string,
): Promise<void> {
  await client.query(
    `UPDATE chat_messages SET answered_at = now(), answered_by = $2
      WHERE id = $1 AND needs_reply AND answered_at IS NULL`,
    [messageId, profileId],
  );
}

export async function markChatRead(
  client: PoolClient,
  conversationId: string,
  profileId: string,
  messageId: string,
): Promise<void> {
  await client.query(
    `UPDATE chat_members SET last_read_message_id = GREATEST(last_read_message_id, $3::bigint)
      WHERE conversation_id = $1 AND profile_id = $2`,
    [conversationId, profileId, messageId],
  );
}

export async function setChatMuted(
  client: PoolClient,
  conversationId: string,
  profileId: string,
  muted: boolean,
): Promise<void> {
  await client.query(
    `UPDATE chat_members SET muted = $3 WHERE conversation_id = $1 AND profile_id = $2`,
    [conversationId, profileId, muted],
  );
}
