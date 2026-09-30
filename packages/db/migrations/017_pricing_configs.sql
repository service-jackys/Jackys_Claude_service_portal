-- Phase 6 (Commercial/pricing -- see modification.md #26): admin entry for
-- VAS price banding & split, Rate Card, D+I, AMC and Thomson pricing, all
-- ported from the legacy Apps Script prototype's "Management" tab (code.gs /
-- index_sep_15.html, attached for reference). Default values load from the
-- master Excel workbook, but once an admin saves a change the system has no
-- further dependency on Excel: admin can always change values, always
-- revert to the Excel default, and -- unlike the legacy system, which only
-- ever kept a single current row per domain with no history -- every save
-- is versioned so a past saved entry can be browsed and restored later.
--
-- One generic table holds the CURRENT value for each of 7 pricing domains
-- (a handful of VAS sub-domains plus rate card / D+I / AMC / Thomson), keyed
-- by domain name with the value itself as an opaque jsonb payload -- the
-- shape is validated in application code (packages/contracts) per domain,
-- not by the database. History/versioning reuses the existing audit_events
-- table (see packages/db/src/audit.ts) rather than a second parallel
-- history table: every save/reset/restore inserts an audit_events row with
-- target_type='pricing_config', target_id=pricing_configs.id, and the full
-- payload snapshot in metadata, so "load a past entry" is just looking up
-- that audit_events row and "restore" is applying its metadata.payload as a
-- new current value (itself logged as a new event).

CREATE TABLE pricing_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  is_override boolean NOT NULL DEFAULT false,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_configs_domain_check CHECK (domain IN (
    'vas_price_bands',
    'vas_pricing_params',
    'vas_profit_split',
    'rate_card',
    'dandi_pricing',
    'amc_pricing',
    'thomson_pricing'
  )),
  CONSTRAINT pricing_configs_payload_check CHECK (jsonb_typeof(payload) = 'object' OR jsonb_typeof(payload) = 'array')
);

CREATE INDEX pricing_configs_updated_idx ON pricing_configs (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('pricing_config.read', 'View admin pricing configuration (VAS, rate card, D+I, AMC, Thomson)'),
  ('pricing_config.write', 'Change admin pricing configuration and revert to Excel defaults')
ON CONFLICT (code) DO NOTHING;

-- Read: admin + management can see the active pricing masters and their
-- history. Write: admin-only, matching how every other master-data list in
-- this system (salesmen, sales channels, branch master data) is managed --
-- and matching the user's own "admin can always change values" framing.
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'pricing_config.read'
WHERE roles.code IN ('admin', 'management')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'pricing_config.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
