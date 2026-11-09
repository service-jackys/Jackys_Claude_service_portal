-- Modification #229: Ask AI across the portal. One permission per section so
-- an admin decides who may ask the AI about pricing admin, masters, AMC or
-- revenue pages. Admin has all of them; other roles get them in Roles &
-- permissions.
INSERT INTO permissions (code, description)
VALUES
  ('ai_ask.pricing_admin', 'Ask AI about the Admin pricing pages'),
  ('ai_ask.masters', 'Ask AI about the Admin Masters'),
  ('ai_ask.amc', 'Ask AI about the AMC quote calculators'),
  ('ai_ask.revenue', 'Ask AI about the Service revenue and Budget dashboards')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code LIKE 'ai_ask.%'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
