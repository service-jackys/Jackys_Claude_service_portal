-- Custom roles (modification.md #176).
--
-- Until now `roles.code` was limited to the four built-in roles by a CHECK
-- constraint, and `local_auth_users.role` had the same CHECK. This migration
-- lets an administrator create their own roles (for example "Finance",
-- "Sales Coordinator", "Receptionist") from Roles & permissions:
--   * the CHECK on roles.code becomes a format check (lower-case code)
--   * roles get an is_builtin flag; the four built-ins are protected from
--     rename/delete in the API
--   * local_auth_users.role becomes a foreign key to roles.code, so a login can
--     only hold a role that exists and a role that still has logins cannot be
--     deleted (ON DELETE RESTRICT, same as profile_roles).
-- The role names must also be unique (case-insensitive) so the picker never
-- shows two identical entries.

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_code_check;
ALTER TABLE roles
  ADD CONSTRAINT roles_code_format_check CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$');

ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_builtin boolean NOT NULL DEFAULT false;
UPDATE roles SET is_builtin = true WHERE code IN ('user', 'sales', 'management', 'admin');

ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS roles_display_name_lower_key ON roles (lower(display_name));

ALTER TABLE local_auth_users DROP CONSTRAINT IF EXISTS local_auth_users_role_check;
ALTER TABLE local_auth_users
  ADD CONSTRAINT local_auth_users_role_fkey
  FOREIGN KEY (role) REFERENCES roles (code) ON DELETE RESTRICT;
