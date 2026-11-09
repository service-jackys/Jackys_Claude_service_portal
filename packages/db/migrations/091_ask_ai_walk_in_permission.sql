-- Modification #240: Ask AI on the Walk-in job cards pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.walk_in', 'Ask AI about the Walk-in job cards pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.walk_in'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
