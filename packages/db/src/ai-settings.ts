import type { PoolClient } from 'pg';

export type AiProvider = 'anthropic' | 'openrouter' | 'custom';

export type AiSettingsRow = {
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  apiKeyEncrypted: string | null;
  keyHint: string | null;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  updatedAt: Date | null;
};

const columns = `
  provider,
  base_url AS "baseUrl",
  model,
  api_key_encrypted AS "apiKeyEncrypted",
  key_hint AS "keyHint",
  enabled,
  last_tested_at AS "lastTestedAt",
  last_test_ok AS "lastTestOk",
  last_test_message AS "lastTestMessage",
  updated_at AS "updatedAt"
`;

const empty: AiSettingsRow = {
  provider: 'anthropic',
  baseUrl: null,
  model: '',
  apiKeyEncrypted: null,
  keyHint: null,
  enabled: false,
  lastTestedAt: null,
  lastTestOk: null,
  lastTestMessage: null,
  updatedAt: null,
};

export async function readAiSettings(client: PoolClient): Promise<AiSettingsRow> {
  const result = await client.query<AiSettingsRow>(
    `SELECT ${columns} FROM ai_settings WHERE id = 1`,
  );
  return result.rows[0] ?? empty;
}

/** apiKey: undefined keeps the stored key, null clears it, otherwise replaces it. */
export async function saveAiSettings(
  client: PoolClient,
  input: {
    provider: AiProvider;
    baseUrl: string | null;
    model: string;
    enabled: boolean;
    apiKey: { encrypted: string; hint: string } | null | undefined;
    profileId: string;
  },
): Promise<AiSettingsRow> {
  const keyChanged = input.apiKey !== undefined;
  await client.query(
    `INSERT INTO ai_settings (id, provider, base_url, model, enabled, api_key_encrypted, key_hint, updated_by)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       provider = EXCLUDED.provider,
       base_url = EXCLUDED.base_url,
       model = EXCLUDED.model,
       enabled = EXCLUDED.enabled,
       api_key_encrypted = CASE WHEN $8::boolean THEN EXCLUDED.api_key_encrypted ELSE ai_settings.api_key_encrypted END,
       key_hint = CASE WHEN $8::boolean THEN EXCLUDED.key_hint ELSE ai_settings.key_hint END,
       last_test_ok = CASE WHEN $8::boolean THEN NULL ELSE ai_settings.last_test_ok END,
       last_test_message = CASE WHEN $8::boolean THEN NULL ELSE ai_settings.last_test_message END,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [
      input.provider,
      input.baseUrl,
      input.model,
      input.enabled,
      input.apiKey ? input.apiKey.encrypted : null,
      input.apiKey ? input.apiKey.hint : null,
      input.profileId,
      keyChanged,
    ],
  );
  return readAiSettings(client);
}

export async function recordAiTest(
  client: PoolClient,
  ok: boolean,
  message: string,
): Promise<void> {
  await client.query(
    `UPDATE ai_settings SET last_tested_at = now(), last_test_ok = $1, last_test_message = $2 WHERE id = 1`,
    [ok, message.slice(0, 300)],
  );
}
