-- Modification #154: masters for Delivery & Installation (CSIDI / CSIDO / CSIII)
-- capture. Phase 1 of the plan in claude/dandi-activity-capture-plan-2026-10-27.
--
--  1. category_mappings: item group -> installable yes/no -> pricing category.
--     Replaces the hidden "Category Mapping" sheet of the master workbook. An
--     item whose group is not installable can only be delivered (CSIDO).
--  2. sales_channels.reporting_name: the workbook's name for a channel
--     (JDI -> HAA, JER-C/INS -> INS), set by the admin.
--  3. billing_rules.brand / brand_match: a rule may also depend on the item
--     brand ("is" or "is not"), e.g. one salesman's VENUS items go to one
--     channel and every other brand to his own channel.

CREATE TABLE category_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_name text NOT NULL,
  installable boolean NOT NULL DEFAULT false,
  pricing_category text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_mappings_group_check CHECK (length(trim(group_name)) BETWEEN 1 AND 200),
  CONSTRAINT category_mappings_pricing_check CHECK (
    NOT installable OR (pricing_category IS NOT NULL AND length(trim(pricing_category)) > 0)
  )
);
CREATE UNIQUE INDEX category_mappings_group_unique ON category_mappings (lower(trim(group_name)));

-- Seeded from the workbook's Category Mapping sheet (installable categories).
INSERT INTO category_mappings (group_name, installable, pricing_category, notes)
VALUES
  ('FRIDGE', true, 'Freestanding Refrigerator', 'From the master workbook.'),
  ('FREEZER', true, 'Freestanding Refrigerator', 'From the master workbook.'),
  ('WASHING MACHINE', true, 'Freestanding Washing Machine', 'From the master workbook.'),
  ('COOKER', true, 'Freestanding Cooker', 'From the master workbook.');

ALTER TABLE sales_channels ADD COLUMN reporting_name text;
UPDATE sales_channels SET reporting_name = 'HAA' WHERE lower(name) = 'jdi' AND reporting_name IS NULL;
UPDATE sales_channels SET reporting_name = 'INS' WHERE lower(name) = 'jer-c/ins' AND reporting_name IS NULL;

ALTER TABLE billing_rules ADD COLUMN brand text;
ALTER TABLE billing_rules ADD COLUMN brand_match text NOT NULL DEFAULT 'is';
ALTER TABLE billing_rules ADD CONSTRAINT billing_rules_brand_match_check
  CHECK (brand_match IN ('is', 'is_not'));
ALTER TABLE billing_rules DROP CONSTRAINT billing_rules_has_condition;
ALTER TABLE billing_rules ADD CONSTRAINT billing_rules_has_condition
  CHECK (salesman IS NOT NULL OR branch_keyword IS NOT NULL OR brand IS NOT NULL);

INSERT INTO permissions (code, description)
VALUES
  ('category_mappings.read', 'View the delivery & installation category mapping'),
  ('category_mappings.write', 'Manage the delivery & installation category mapping (admin)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'category_mappings.read'
WHERE roles.code IN ('admin', 'management', 'sales')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'category_mappings.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
