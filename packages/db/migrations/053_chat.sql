-- Modification #140: in-portal chat (phase 1). Direct messages, channels and threads
-- attached to a job card, appointment, schedule, complaint or task.
CREATE TABLE chat_conversations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  title text,
  -- 'direct' chats are unique per pair of people: "<lower id>:<higher id>".
  direct_key text,
  record_type text,
  record_id bigint,
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_kind_check CHECK (kind IN ('direct', 'channel', 'record')),
  CONSTRAINT chat_conversations_shape_check CHECK (
    (kind = 'direct' AND direct_key IS NOT NULL AND record_type IS NULL AND record_id IS NULL)
    OR (kind = 'channel' AND title IS NOT NULL AND direct_key IS NULL AND record_type IS NULL AND record_id IS NULL)
    OR (kind = 'record' AND direct_key IS NULL AND record_type IS NOT NULL AND record_id IS NOT NULL)
  ),
  CONSTRAINT chat_conversations_record_type_check CHECK (
    record_type IS NULL OR record_type IN ('job_card', 'appointment', 'schedule', 'complaint', 'task')
  ),
  CONSTRAINT chat_conversations_title_check CHECK (title IS NULL OR length(trim(title)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX chat_conversations_direct_unique ON chat_conversations (direct_key)
  WHERE kind = 'direct';
CREATE UNIQUE INDEX chat_conversations_record_unique ON chat_conversations (record_type, record_id)
  WHERE kind = 'record';
CREATE UNIQUE INDEX chat_conversations_channel_title_unique ON chat_conversations (lower(title))
  WHERE kind = 'channel';

-- Membership. Direct chats and channels are visible only to members. Record threads
-- are visible to anyone who can open the record; a row here means the person follows
-- the thread (unread counts) and holds their read position.
CREATE TABLE chat_members (
  conversation_id bigint NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  profile_id bigint NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  last_read_message_id bigint NOT NULL DEFAULT 0,
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, profile_id)
);

CREATE INDEX chat_members_profile_idx ON chat_members (profile_id);

CREATE TABLE chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  sender_id bigint NOT NULL REFERENCES profiles (id),
  body text NOT NULL,
  reply_to_id bigint REFERENCES chat_messages (id) ON DELETE SET NULL,
  -- "Needs reply": the sender wants an answer; it stays flagged until answered.
  needs_reply boolean NOT NULL DEFAULT false,
  answered_at timestamptz,
  answered_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_body_check CHECK (length(trim(body)) BETWEEN 1 AND 4000)
);

CREATE INDEX chat_messages_conversation_idx ON chat_messages (conversation_id, id);
CREATE INDEX chat_messages_open_reply_idx ON chat_messages (conversation_id)
  WHERE needs_reply AND answered_at IS NULL;

CREATE TABLE chat_message_mentions (
  message_id bigint NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  profile_id bigint NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, profile_id)
);

CREATE INDEX chat_message_mentions_profile_idx ON chat_message_mentions (profile_id, message_id);

INSERT INTO permissions (code, description)
VALUES
  ('chat.use', 'Use Chat: direct messages, channels and record threads'),
  ('chat.create_channel', 'Create group channels in Chat'),
  ('chat.moderate', 'Moderate Chat channels')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'chat.use'
WHERE roles.code IN ('user', 'sales', 'management', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN ('chat.create_channel', 'chat.moderate')
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
