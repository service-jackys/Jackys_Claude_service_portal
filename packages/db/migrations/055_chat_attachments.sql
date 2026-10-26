-- Modification #142: chat phase 2b -- files and site photos in chat.
-- A file is uploaded first (message_id NULL) and attached when the message is sent.
CREATE TABLE chat_attachments (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  message_id bigint REFERENCES chat_messages (id) ON DELETE CASCADE,
  uploaded_by bigint NOT NULL REFERENCES profiles (id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_attachments_message_idx ON chat_attachments (message_id);
CREATE INDEX chat_attachments_conversation_idx ON chat_attachments (conversation_id);

-- A message may now be only attachments (empty text).
ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_body_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_body_check CHECK (length(body) <= 4000);
