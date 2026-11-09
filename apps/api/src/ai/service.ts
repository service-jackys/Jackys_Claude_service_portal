import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  aiAdviceRequestSchema,
  aiChatRequestSchema,
  aiSettingsWriteSchema,
} from '../../../../packages/contracts/src/index.js';
import {
  readAiSettings,
  recordAiTest,
  saveAiSettings,
  type AiSettingsRow,
} from '../../../../packages/db/src/ai-settings.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { decryptSecret, encryptSecret, keyHint } from './crypto.js';
import { AiProviderError, completeChat, completeText, resolveBaseUrl } from './provider.js';

export class AiServiceError extends Error {
  constructor(
    public readonly code: 'not-configured' | 'provider-failed' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

type Deps = { fetchImpl?: typeof fetch; secret?: string };

const ADVICE_SYSTEM =
  'You advise the service manager of an appliance installation company in the UAE. ' +
  'Write 2 to 4 short sentences of plain advice (under 90 words, no markdown, no bullet lists) ' +
  'about how to shorten a long installation project. Use ONLY the figures given; never invent numbers, ' +
  'and never recommend an option marked as outside the margin guard. Amounts are in AED.';

const CHAT_SYSTEM =
  "You are a pricing and margin assistant inside the Thomson Quote Calculator of Jacky's Distribution " +
  '(installation of built-in kitchen appliances, UAE). Help the service manager understand and improve the quote below. ' +
  'The QUOTE DATA is the only source of figures: use it, never invent or assume numbers that are not in it, ' +
  'and say so when the data does not contain what is needed. You may do simple arithmetic on the given figures; ' +
  'show the numbers you used. Margin = price minus cost; margin % = margin divided by price. Amounts are in AED. ' +
  'minMarginPct is the lowest margin the company accepts: warn when a suggestion would go below it. ' +
  'You cannot change the quote or its prices; if a change is wanted, say what to change in the calculator ' +
  '(quantities, transport share, add-on switches, crew or phases). ' +
  'Answer in plain text, under 120 words, no markdown headings or bold; use short lines starting with "- " for lists.';

export function createAiService(pool: Pool, deps: Deps = {}) {
  const secret = () =>
    deps.secret ?? process.env.AI_SETTINGS_SECRET ?? process.env.ATTACHMENT_URL_SECRET ?? '';

  const publicView = (row: AiSettingsRow) => ({
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    hasKey: !!row.apiKeyEncrypted,
    keyHint: row.keyHint,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    secretConfigured: secret().length >= 16,
  });

  async function load() {
    const client = await pool.connect();
    try {
      return await readAiSettings(client);
    } finally {
      client.release();
    }
  }

  function configFrom(row: AiSettingsRow) {
    if (!row.enabled || !row.apiKeyEncrypted || !row.model)
      throw new AiServiceError('not-configured', 'AI is not set up.');
    try {
      return {
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: decryptSecret(row.apiKeyEncrypted, secret()),
      };
    } catch {
      throw new AiServiceError(
        'not-configured',
        'The stored key cannot be read. Enter the API key again in Admin > AI settings.',
      );
    }
  }

  async function get() {
    return publicView(await load());
  }

  async function status() {
    const row = await load();
    return { available: row.enabled && !!row.apiKeyEncrypted && !!row.model };
  }

  async function save(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = aiSettingsWriteSchema.parse(input);
    if (data.provider === 'custom' && !data.baseUrl)
      throw new AiServiceError('invalid', 'A base URL is needed for a custom provider.');
    try {
      resolveBaseUrl(data.provider, data.baseUrl ?? null);
    } catch (error) {
      throw new AiServiceError('invalid', (error as Error).message);
    }
    let apiKey: { encrypted: string; hint: string } | null | undefined;
    if (data.apiKey === undefined) apiKey = undefined;
    else if (data.apiKey === '') apiKey = null;
    else {
      if (secret().length < 16)
        throw new AiServiceError(
          'invalid',
          'The server has no secret to encrypt the key with. Set AI_SETTINGS_SECRET (at least 16 characters) and restart the API.',
        );
      apiKey = { encrypted: encryptSecret(data.apiKey, secret()), hint: keyHint(data.apiKey) };
    }
    return withTransaction(pool, async (client) => {
      const row = await saveAiSettings(client, {
        provider: data.provider,
        baseUrl: data.baseUrl || null,
        model: data.model,
        enabled: data.enabled,
        apiKey,
        profileId,
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'ai_settings.saved',
        targetType: 'ai_settings',
        targetId: '1',
        // The key itself is never logged.
        metadata: {
          provider: row.provider,
          model: row.model,
          enabled: row.enabled,
          keyChanged: data.apiKey !== undefined,
        },
        requestId,
      });
      return publicView(row);
    });
  }

  async function test() {
    const row = await load();
    const config = configFrom(row);
    let ok = true;
    let message = 'Connected.';
    try {
      const reply = await completeText(
        config,
        'Reply with the single word: ready',
        'Connection test',
        {
          maxTokens: 20,
          timeoutMs: 15000,
          fetchImpl: deps.fetchImpl,
        },
      );
      message = 'Connected. The model replied: ' + reply.slice(0, 60);
    } catch (error) {
      ok = false;
      message = (error as Error).message;
    }
    const client = await pool.connect();
    try {
      await recordAiTest(client, ok, message);
    } finally {
      client.release();
    }
    return { ok, message };
  }

  async function advise(input: unknown) {
    const data = aiAdviceRequestSchema.parse(input);
    const config = configFrom(await load());
    try {
      const text = await completeText(config, ADVICE_SYSTEM, JSON.stringify(data), {
        maxTokens: 300,
        timeoutMs: 20000,
        fetchImpl: deps.fetchImpl,
      });
      return { text };
    } catch (error) {
      if (error instanceof AiProviderError)
        throw new AiServiceError('provider-failed', error.message);
      throw error;
    }
  }

  async function chat(input: unknown) {
    const data = aiChatRequestSchema.parse(input);
    if (data.messages[data.messages.length - 1].role !== 'user')
      throw new AiServiceError('invalid', 'The last message must be a question.');
    const config = configFrom(await load());
    try {
      const text = await completeChat(
        config,
        CHAT_SYSTEM + '\n\nQUOTE DATA (JSON):\n' + JSON.stringify(data.quote),
        data.messages,
        { maxTokens: 500, timeoutMs: 30000, fetchImpl: deps.fetchImpl },
      );
      return { text };
    } catch (error) {
      if (error instanceof AiProviderError)
        throw new AiServiceError('provider-failed', error.message);
      throw error;
    }
  }

  return { get, status, save, test, advise, chat };
}

export type AiService = ReturnType<typeof createAiService>;
