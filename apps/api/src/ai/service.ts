import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  aiAdviceRequestSchema,
  aiAskRequestSchema,
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

const ASK_GUIDE: Record<string, string> = {
  pricing_admin:
    'the Admin pricing pages (VAS price bands, rate cards, Delivery & Installation, AMC admin rates and the Thomson pricing master). ' +
    'Explain what a setting does, point out values that look inconsistent, unusually high or low, or that would squeeze margin, and suggest what to review.',
  masters:
    'the Admin Masters (reference lists such as appliances, regions, sub-groups and codes). ' +
    'Help the admin keep the lists clean: spot duplicates, gaps, odd values or inconsistent naming in the rows shown, and suggest fixes.',
  amc:
    'the AMC (annual maintenance contract) quote calculators. ' +
    'Explain how the plan prices were reached, compare plans, point out where the price is capped, discounted or below the minimum margin, and suggest how to improve the quote.',
  vas:
    'the VAS (value added service / extended protection plan) quote calculator. ' +
    'Explain how the plan fee, service fee and claims allowed follow from the selling price and value band, compare the plans, and suggest which plan to offer.',
  complaints:
    'the Complaints list of the service centre. ' +
    'Explain the status mix, ageing and trends, point out what is piling up or unusual (by status, month, region, brand, warranty), and suggest what to follow up first.',
  appointments:
    'the Appointments schedule of the service centre. ' +
    'Explain the status mix, what is overdue or coming up, how busy each day or month is, and the split by region, brand, warranty and customer type, and suggest what to schedule or chase first.',
  job_cards:
    'the Service job cards of the service centre. ' +
    'Explain the job status mix, what is waiting for spares, customer approval or closure approval, how long open jobs have been waiting, and the split by month, brand, warranty and source, and suggest which jobs to chase first.',
  quotations:
    'the Quotations list of the service centre. ' +
    'Explain how many quotations are pending, approved or rejected, how long pending ones have waited, which are invoiced in the ERP, the value by status and month, and suggest which pending quotations to chase first.',
  revenue:
    'the Service revenue and Budget dashboards. ' +
    'Explain trends, budget versus actual and variances, say what is behind a gap using only the figures given, and suggest where to look or act.',
};

const PERSONAL_KEY =
  /customer|client|contact|phone|mobile|e-?mail|address|whatsapp|passport|emirates|owner|assignee|assigned|created_?by|updated_?by|saved_?by|staff|employee|person|location|project_?name/i;

// Defence in depth: the page already leaves personal fields out; this removes
// any that slipped through and keeps the payload small.
export function sanitiseAskContext(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
  if (depth >= 8) return undefined;
  if (Array.isArray(value))
    return value.slice(0, 60).map((item) => sanitiseAskContext(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (PERSONAL_KEY.test(key)) continue;
      const cleaned = sanitiseAskContext(item, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

import { buildOpsSnapshot, OPS_SECTIONS } from './ops-snapshot.js';
import { buildWorkbookSnapshot, type WorkbookAccess } from './workbook.js';

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

  async function ask(input: unknown, workbookAccess?: WorkbookAccess) {
    const data = aiAskRequestSchema.parse(input);
    if (data.messages[data.messages.length - 1].role !== 'user')
      throw new AiServiceError('invalid', 'The last message must be a question.');
    const opsEntry = OPS_SECTIONS[data.section];
    const portal =
      data.includePortalData === true && opsEntry && workbookAccess?.can?.(opsEntry.read)
        ? await buildOpsSnapshot(pool, data.section)
        : null;
    const wanted = data.includeWorkbook === true && data.section === 'revenue' && workbookAccess;
    const workbook =
      wanted && (workbookAccess.revenue || workbookAccess.budget)
        ? await buildWorkbookSnapshot(pool, workbookAccess)
        : null;
    const context = JSON.stringify(
      sanitiseAskContext(
        workbook
          ? { onScreen: data.context, workbook }
          : portal
            ? { onScreen: data.context, portalData: portal }
            : data.context,
      ),
    );
    if (context.length > 60000)
      throw new AiServiceError(
        'invalid',
        'There is too much on this page to send. Narrow it down and ask again.',
      );
    const config = configFrom(await load());
    const system =
      "You are an assistant inside the staff portal of Jacky's Distribution (after-sales service, appliance installation and maintenance, UAE). " +
      'You are helping with ' +
      ASK_GUIDE[data.section] +
      ' The page is: ' +
      data.title +
      '. PAGE DATA is the only source of figures: never invent or assume numbers that are not in it, and say so when it does not contain what is needed. ' +
      (workbook
        ? 'PAGE DATA has two parts: onScreen (what the person is looking at) and workbook (summaries of the uploaded workbooks for all periods). Use workbook for questions beyond the screen. '
        : portal
          ? 'PAGE DATA has two parts: onScreen (what the person is looking at) and portalData (counts and statuses across all records, no personal details). Use portalData for questions beyond the screen. '
          : '') +
      'You may do simple arithmetic on the given figures; show the numbers you used. Amounts are in AED. ' +
      'You cannot change anything in the portal; when a change is wanted, say what to change and where. ' +
      'Answer in plain text, under 150 words, no markdown headings or bold; use short lines starting with "- " for lists.';
    try {
      const text = await completeChat(
        config,
        system + '\n\nPAGE DATA (JSON):\n' + context,
        data.messages,
        {
          maxTokens: 600,
          timeoutMs: 30000,
          fetchImpl: deps.fetchImpl,
        },
      );
      return { text };
    } catch (error) {
      if (error instanceof AiProviderError)
        throw new AiServiceError('provider-failed', error.message);
      throw error;
    }
  }

  return { get, status, save, test, advise, chat, ask };
}

export type AiService = ReturnType<typeof createAiService>;
