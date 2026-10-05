-- Modification #55: password handling for Team logins.
--
-- must_change_password: a login an administrator creates (or whose password an
-- administrator resets) carries a temporary password, so its owner is forced
-- to choose their own before they can use the portal. The bootstrap
-- administrator and every login that exists today keep working as before.
-- password_changed_at records the last time the owner chose a password.
ALTER TABLE local_auth_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
