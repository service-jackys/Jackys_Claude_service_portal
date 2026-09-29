-- Modification #8 (see modification.md): four requests in one batch --
--   1. A per-technician daily appointment cap (admin-changeable, default 10)
--      and dropping appointment_time everywhere (day-only scheduling now).
--   2/3/4. New "salesmen" and "sales_channels" master tables, referenced by
--      appointments and service job cards.

-- ---------------------------------------------------------------------
-- 1a. Technician daily appointment cap
-- ---------------------------------------------------------------------
ALTER TABLE technicians
  ADD COLUMN max_appointments_per_day integer NOT NULL DEFAULT 10;
ALTER TABLE technicians
  ADD CONSTRAINT technicians_max_appointments_per_day_check
  CHECK (max_appointments_per_day > 0);

-- ---------------------------------------------------------------------
-- 2/3/4. Salesmen and Sales Channels master data
-- ---------------------------------------------------------------------
CREATE TABLE salesmen (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salesmen_name_check CHECK (length(trim(name)) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX salesmen_name_unique ON salesmen (lower(name));

-- Sales Channel is a super-admin-managed master list (the user populates it
-- themselves before end-to-end testing -- see modification.md #8); left
-- empty here on purpose.
CREATE TABLE sales_channels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_channels_name_check CHECK (length(trim(name)) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX sales_channels_name_unique ON sales_channels (lower(name));

-- Seed the salesmen list from the salesman names already on file in the B2B
-- branch master list (imported from sales invoice data), so staff aren't
-- starting from a completely empty dropdown.
INSERT INTO salesmen (name)
SELECT DISTINCT trim(salesman)
FROM b2b_branches
WHERE salesman IS NOT NULL AND length(trim(salesman)) > 0
ON CONFLICT DO NOTHING;

ALTER TABLE appointments ADD COLUMN salesman text;
ALTER TABLE service_job_cards ADD COLUMN salesman text;
ALTER TABLE service_job_cards ADD COLUMN sales_channel text;

-- ---------------------------------------------------------------------
-- 1b. Drop appointment_time -- scheduling is day-only from here on
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS appointments_schedule_idx;
DROP INDEX IF EXISTS appointments_technician_schedule_idx;

ALTER TABLE appointments DROP COLUMN appointment_time;

CREATE INDEX appointments_schedule_idx ON appointments (appointment_date);
CREATE INDEX appointments_technician_schedule_idx
  ON appointments (technician_id, appointment_date)
  WHERE technician_id IS NOT NULL AND status <> 'Cancelled';

-- Note: draft_schedules / draft_schedule_items (migration 002) still have
-- their own appointment_time column, but that table is dead code -- no API
-- route or frontend page writes to it (the live scheduling flow goes
-- through POST /api/appointments and PATCH /api/appointments/{id}/schedule
-- directly) -- so it's left alone rather than touched blind.

-- ---------------------------------------------------------------------
-- Permissions for the new master data
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, description)
VALUES
  ('salesmen.read', 'View the salesmen master list'),
  ('salesmen.write', 'Manage the salesmen master list'),
  ('sales_channels.read', 'View the sales channels master list'),
  ('sales_channels.write', 'Manage the sales channels master list (super admin)')
ON CONFLICT (code) DO NOTHING;

-- Salesmen: same audience as B2B branches / technicians (whoever schedules
-- appointments or works job cards needs to see the dropdown); write stays
-- admin-only, matching how the B2B branch master list is managed.
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'salesmen.read'
WHERE roles.code IN ('admin', 'management', 'sales')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'salesmen.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;

-- Sales Channel: explicitly a super-admin-managed list per modification.md
-- #8 -- read is still needed by anyone creating a job card, write is
-- admin-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'sales_channels.read'
WHERE roles.code IN ('admin', 'management', 'sales')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'sales_channels.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
