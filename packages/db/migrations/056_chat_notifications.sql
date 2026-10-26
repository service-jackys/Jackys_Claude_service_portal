-- Modification #144: chat phase 4 -- notifications (background push and email on mention).
CREATE TABLE chat_preferences (
  profile_id bigint PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  email_on_mention boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_push_subscriptions (
  id bigserial PRIMARY KEY,
  profile_id bigint NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_push_subscriptions_profile_idx ON chat_push_subscriptions (profile_id);
