-- Finance → Service Revenue Dashboard: tab-wise access (#109).
-- revenue_dashboard.read stays the master "may open Finance" switch; these
-- decide which tabs / pages / downloads a role gets. Existing holders of
-- revenue_dashboard.read keep everything they could see before.
INSERT INTO permissions (code, description)
VALUES
  ('revenue_dashboard.tab_overview', 'Service Revenue Dashboard tab: Overview'),
  ('revenue_dashboard.tab_explorer', 'Service Revenue Dashboard tab: Explorer (job-level rows)'),
  ('revenue_dashboard.tab_reports', 'Service Revenue Dashboard tab: Reports (drill-down, summaries)'),
  ('revenue_dashboard.tab_logic', 'Service Revenue Dashboard tab: Logic applied'),
  ('revenue_dashboard.budget_actual', 'Finance page: Budget vs Actual'),
  ('revenue_dashboard.budget_variance', 'Finance page: Budget Variance'),
  ('revenue_dashboard.export', 'Download Excel exports from the Service Revenue Dashboard')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'revenue_dashboard.read'
JOIN permissions p ON p.code LIKE 'revenue_dashboard.%'
  AND p.code NOT IN ('revenue_dashboard.read', 'revenue_dashboard.write')
ON CONFLICT DO NOTHING;
