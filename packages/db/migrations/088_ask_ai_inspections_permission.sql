-- Modification #237: Ask AI on the Inspections pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.inspections', 'Ask AI about the Inspections pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.inspections'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
