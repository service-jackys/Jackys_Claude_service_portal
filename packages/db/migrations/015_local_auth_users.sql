-- Persists Team logins (the local-development email/password sign-in used
-- by this staff portal) so they survive an `npm run dev` restart. Until now
-- these lived only in the server process's memory (a plain JS Map), which
-- is why every restart wiped every teammate login back to zero and any
-- role/active change made through "Team logins" was lost with it -- see
-- modification.md #20. The permission side of this was already safe (the
-- `profiles`/`profile_roles` tables from 001_initial_schema.sql), only the
-- login credential itself wasn't. Session tokens stay in-memory on
-- purpose -- signing out on every restart is normal and expected.

CREATE TABLE local_auth_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_auth_users_role_check CHECK (role IN ('user', 'sales', 'management', 'admin')),
  CONSTRAINT local_auth_users_email_check CHECK (length(trim(email)) BETWEEN 3 AND 320),
  CONSTRAINT local_auth_users_name_check CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX local_auth_users_email_unique ON local_auth_users (lower(email));
