-- Modification #297: the weekly ROI email can carry data blocks, and each block has
-- its own permission so a role only ever sees what belongs to it.
--   tasks.roi_management_summary  the revenue Management Summary (AED figures)
--   tasks.roi_customer_care       customer care activity (counts and quantities, no AED)
--   tasks.roi_field_ops           field operations (counts and quantities, no AED)
-- Only administrators get them here; tick them per role on the Roles page.
-- "Use the Tasks (ROI) tab" (tasks.use) still lets anyone send their own ROI.
INSERT INTO permissions (code, description)
VALUES
  ('tasks.roi_management_summary', 'ROI: include the Management Summary (revenue figures in AED)'),
  ('tasks.roi_customer_care', 'ROI: include the Customer care activity block (counts, no revenue)'),
  ('tasks.roi_field_ops', 'ROI: include the Field operations block (counts, no revenue)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'tasks.roi_management_summary', 'tasks.roi_customer_care', 'tasks.roi_field_ops'
)
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
