import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import { problem } from '../api/problem.js';
import type { DailyListService } from './service.js';

export function createDailyListHandlers(
  service: DailyListService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.list(request.query));
        } catch (error) {
          if (error instanceof ZodError) {
            problem(
              response,
              400,
              'invalid-request',
              'Bad Request',
              error.issues[0]?.message ?? 'Invalid request.',
            );
            return;
          }
          next(error);
        }
      },
    ],
  };
}
