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

export function createAiHandlers(
  service: AiService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
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
