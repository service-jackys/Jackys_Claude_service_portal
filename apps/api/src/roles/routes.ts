import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { RoleServiceError, type RoleService } from './service.js';

export function createRoleHandlers(
  service: RoleService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    matrix: [
      requirePermission('admin.users'),
      async (_request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.matrix());
        } catch (error) {
          next(error);
        }
      },
    ],
    update: [
      requirePermission('admin.users'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json(
            await service.setPermissions(String(request.params.role), request.body, auth.profileId),
          );
        } catch (error) {
          if (error instanceof RoleServiceError) {
            problem(response, error.status, error.code, 'Request failed', error.message);
            return;
          }
          if (error instanceof ZodError) {
            problem(
              response,
              400,
              'invalid-request',
              'Bad Request',
              'Send { permissions: [...] }.',
            );
            return;
          }
          next(error);
        }
      },
    ],
  };
}
