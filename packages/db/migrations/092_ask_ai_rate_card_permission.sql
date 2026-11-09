-- Modification #241: Ask AI on the Rate card pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.rate_card', 'Ask AI about the Rate card pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.rate_card'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
