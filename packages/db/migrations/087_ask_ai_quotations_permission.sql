-- Modification #236: Ask AI on the Quotations pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.quotations', 'Ask AI about the Quotations pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.quotations'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
