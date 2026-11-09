-- Modification #230: Admin > Archive holds pages that were replaced (the
-- original AMC calculator and AMC admin rates). Admin only by default.
INSERT INTO permissions (code, description)
VALUES ('archive.view', 'Open the Admin Archive (replaced pages kept for reference)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'archive.view'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
