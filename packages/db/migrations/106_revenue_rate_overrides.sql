-- Modification #290: custom rates for the Service Revenue Dashboard (Rate card tab).
--
-- One row. payload is NULL while the dashboard uses the rates of the uploaded workbook; once an admin
-- locks custom rates it holds the full rate set. The workbook revenue of every line stays in
-- revenue_lines.workbook_revenue, so resetting to the workbook rates restores the figures exactly.
CREATE TABLE revenue_rate_overrides (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload jsonb,
  locked_at timestamptz,
  applied_batch_id bigint REFERENCES revenue_import_batches (id) ON DELETE SET NULL,
  applied_at timestamptz,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO revenue_rate_overrides (id) VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, description)
VALUES ('revenue_dashboard.rate_card_edit', 'Edit and lock the Service Revenue Dashboard rate card, and apply it to Pricing Masters')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'revenue_dashboard.rate_card_edit'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
