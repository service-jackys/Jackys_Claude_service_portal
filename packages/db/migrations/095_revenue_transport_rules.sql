-- Modification #249: transport rules (2-trip daily cap) with portal-wide admin toggles.
--
-- revenue_lines.workbook_revenue keeps the revenue exactly as the uploaded master workbook gave it.
-- revenue_lines.revenue becomes the figure under the active transport rules, so every existing report
-- follows the toggles without changing its SQL. With the default rules and the new master workbook
-- both columns are equal.

ALTER TABLE revenue_lines ADD COLUMN workbook_revenue numeric;
UPDATE revenue_lines SET workbook_revenue = revenue WHERE workbook_revenue IS NULL;

CREATE TABLE revenue_transport_rules (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  daily_cap boolean NOT NULL DEFAULT true,
  delivery_only_cap boolean NOT NULL DEFAULT false,
  mixed_invoice_transport boolean NOT NULL DEFAULT true,
  max_trips smallint NOT NULL DEFAULT 2 CHECK (max_trips BETWEEN 1 AND 10),
  applied_batch_id bigint REFERENCES revenue_import_batches (id) ON DELETE SET NULL,
  applied_at timestamptz,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO revenue_transport_rules (id) VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, description)
VALUES ('revenue_dashboard.transport_rules', 'Change the transport rules (2-trip daily cap toggles) for the whole Service Revenue Dashboard')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'revenue_dashboard.transport_rules'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
