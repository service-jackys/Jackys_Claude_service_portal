import type { AiProvider } from '../../../../packages/db/src/ai-settings.js';

export type ProviderConfig = {
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  apiKey: string;
};

export class AiProviderError extends Error {}

type FetchLike = typeof fetch;

const DEFAULT_BASE: Record<AiProvider, string | null> = {
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
  custom: null,
};

/** The address must be https (http only for a server on the same machine). */
export function resolveBaseUrl(provider: AiProvider, baseUrl: string | null): string {
  const base = (baseUrl && baseUrl.trim()) || DEFAULT_BASE[provider];
  if (!base) throw new AiProviderError('A base URL is needed for a custom provider.');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new AiProviderError('The base URL is not a valid address.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new AiProviderError('The base URL must start with https://.');
  return url.toString().replace(/\/+$/, '');
}

/** One short completion. Anthropic uses its Messages API; the others use the common chat/completions format. */
export async function completeText(
  config: ProviderConfig,
  system: string,
  user: string,
  options: { maxTokens?: number; timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(config.provider, config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const anthropic = config.provider === 'anthropic';
    const response = await doFetch(anthropic ? base + '/v1/messages' : base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: anthropic
        ? {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify(
        anthropic
          ? {
              model: config.model,
              max_tokens: options.maxTokens ?? 300,
              system,
              messages: [{ role: 'user', content: user }],
            }
          : {
              model: config.model,
              max_tokens: options.maxTokens ?? 300,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
            },
      ),
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 200);
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message ?? parsed?.message ?? detail;
      } catch {
        /* keep the raw text */
      }
      throw new AiProviderError('The provider answered ' + response.status + ': ' + detail);
    }
    const body = JSON.parse(raw);
    const text = anthropic
      ? (body?.content ?? []).map((part: { text?: string }) => part.text ?? '').join('')
      : body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim())
      throw new AiProviderError('The provider returned no text.');
    return text.trim();
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if ((error as Error).name === 'AbortError')
      throw new AiProviderError('The provider did not answer in time.');
    throw new AiProviderError('Could not reach the provider: ' + (error as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
