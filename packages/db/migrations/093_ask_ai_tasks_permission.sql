-- Modification #242: Ask AI on the Tasks pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.tasks', 'Ask AI about the Tasks pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.tasks'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
