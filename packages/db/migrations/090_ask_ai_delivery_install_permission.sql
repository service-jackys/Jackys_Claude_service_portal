-- Modification #239: Ask AI on the Delivery and installation jobs pages (counts and statuses only).
INSERT INTO permissions (code, description)
VALUES ('ai_ask.delivery_install', 'Ask AI about the Delivery and installation jobs pages (counts and statuses only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_ask.delivery_install'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
