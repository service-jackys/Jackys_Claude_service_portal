-- Modification #226: overriding the tier unit rate of a line in the Thomson
-- Quote Calculator is a permission. Admin has it; any other role gets it in
-- Roles & permissions.
INSERT INTO permissions (code, description)
VALUES
  ('thomson_sale.override_rate', 'Thomson Quote Calculator: override the tier unit rate of a quote line')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'thomson_sale.override_rate'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
