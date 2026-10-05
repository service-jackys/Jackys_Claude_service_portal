-- Modifications #52 (Reports page), #53 (Activity log screen) and #54 (read-only
-- Rate Card page): the permissions those three pages need.
--
-- reports.read and audit.read have existed since 001 but were only granted to
-- admin. The legacy portal let every signed-in staff member download reports,
-- so sales and management get reports.read; management also gets audit.read
-- (the Activity log). rate_card.view is new: the Rate Card page is just a
-- price list that sales and the service desk look at, so it must not depend
-- on pricing_config.read (admin + management only).

INSERT INTO permissions (code, description)
VALUES ('rate_card.view', 'View the read-only Rate Card page')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'rate_card.view'
WHERE roles.code IN ('user', 'sales', 'management', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'reports.read'
WHERE roles.code IN ('sales', 'management')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'audit.read'
WHERE roles.code = 'management'
ON CONFLICT DO NOTHING;
