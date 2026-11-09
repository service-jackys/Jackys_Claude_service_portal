-- Modification #222 (modification.md): Admin -> AI settings. One row holding the
-- provider, model and an ENCRYPTED API key, used for the optional AI wording of
-- the Thomson Smart advice. The key is never returned by the API.
CREATE TABLE ai_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'openrouter', 'custom')),
  base_url text,
  model text NOT NULL DEFAULT '',
  api_key_encrypted text,
  key_hint text,
  enabled boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL
);

INSERT INTO permissions (code, description)
VALUES ('ai_settings.manage', 'Admin: set the AI provider, model and API key')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'ai_settings.manage'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
