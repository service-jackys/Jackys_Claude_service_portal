import type { RequestHandler } from 'express';
import { problem } from '../api/problem.js';
import { AuditServiceError, type AuditService } from './service.js';

export function createAuditHandlers(
  service: AuditService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('audit.read'),
      async (request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.list(request.query));
        } catch (error) {
          if (error instanceof AuditServiceError) {
            problem(response, 400, error.code, 'Bad Request', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    filters: [
      requirePermission('audit.read'),
      async (_request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.filters());
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
