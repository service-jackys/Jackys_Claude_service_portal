import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { AiServiceError, type AiService } from './service.js';

function handleError(
  error: unknown,
  response: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): void {
  if (!(error instanceof AiServiceError)) {
    next(error);
    return;
  }
  if (error.code === 'invalid')
    problem(response, 400, 'validation', 'Invalid AI settings', error.message);
  else if (error.code === 'not-configured')
    problem(response, 409, 'ai-not-configured', 'AI is not set up', error.message);
  else problem(response, 502, 'ai-provider-failed', 'The AI provider failed', error.message);
}

// Each section is its own permission so an admin can decide who may ask about
// pricing, masters, AMC or revenue (modification #229).
export const ASK_AI_PERMISSIONS: Record<string, string> = {
  pricing_admin: 'ai_ask.pricing_admin',
  masters: 'ai_ask.masters',
  amc: 'ai_ask.amc',
  revenue: 'ai_ask.revenue',
  vas: 'ai_ask.vas',
  complaints: 'ai_ask.complaints',
  appointments: 'ai_ask.appointments',
  job_cards: 'ai_ask.job_cards',
  quotations: 'ai_ask.quotations',
  inspections: 'ai_ask.inspections',
};

export function createAiHandlers(
  service: AiService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  const gates: Record<string, RequestHandler> = Object.fromEntries(
    Object.values(ASK_AI_PERMISSIONS).map((code) => [code, requirePermission(code)]),
  );
  return {
    get: [
      requirePermission('ai_settings.manage'),
      async (_request, response, next) => {
        try {
          response.json({ aiSettings: await service.get() });
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    save: [
      requirePermission('ai_settings.manage'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            aiSettings: await service.save(
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    test: [
      requirePermission('ai_settings.manage'),
      async (_request, response, next) => {
        try {
          response.json(await service.test());
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    status: [
      requirePermission('quote_calculators.use'),
      async (_request, response, next) => {
        try {
          response.json(await service.status());
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    chat: [
      requirePermission('quote_calculators.use'),
      async (request, response, next) => {
        try {
          response.json(await service.chat(request.body));
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    ask: [
      (request, response, next) => {
        const code = ASK_AI_PERMISSIONS[String((request.body as { section?: unknown })?.section)];
        if (!code) {
          problem(response, 400, 'validation', 'Invalid request', 'Unknown section.');
          return;
        }
        gates[code](request, response, next);
      },
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const has = (code: string) =>
            auth.permissions.includes('*') || auth.permissions.includes(code);
          response.json(
            await service.ask(request.body, {
              revenue: has('revenue_dashboard.read'),
              budget: has('revenue_dashboard.budget_actual'),
              can: has,
            }),
          );
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
    advice: [
      requirePermission('quote_calculators.use'),
      async (request, response, next) => {
        try {
          response.json(await service.advise(request.body));
        } catch (error) {
          handleError(error, response, next);
        }
      },
    ],
  };
}
