-- Modification #141: chat phase 2a -- edit, delete, pin, reactions and message search.
-- Every change to a message bumps `rev` (a global counter) so open threads can ask
-- "what changed since revision N" and pick up new messages, edits, deletes, pins,
-- reactions and answered flags with one cheap query.
CREATE SEQUENCE chat_message_rev_seq;

ALTER TABLE chat_messages
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  ADD COLUMN pinned_at timestamptz,
  ADD COLUMN pinned_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  ADD COLUMN rev bigint NOT NULL DEFAULT nextval('chat_message_rev_seq');

CREATE INDEX chat_messages_rev_idx ON chat_messages (conversation_id, rev);
CREATE INDEX chat_messages_pinned_idx ON chat_messages (conversation_id) WHERE pinned_at IS NOT NULL;

CREATE TABLE chat_reactions (
  message_id bigint NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  profile_id bigint NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, profile_id, emoji),
  CONSTRAINT chat_reactions_emoji_check CHECK (length(emoji) BETWEEN 1 AND 16)
);
