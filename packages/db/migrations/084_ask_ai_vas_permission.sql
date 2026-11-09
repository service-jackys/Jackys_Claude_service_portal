-- Modification #233: Ask AI on the VAS Quote Calculator and issued quotes.
INSERT INTO permissions (code, description)
VALUES ('ai_ask.vas', 'Ask AI about the VAS Quote Calculator and issued VAS sales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.vas'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
