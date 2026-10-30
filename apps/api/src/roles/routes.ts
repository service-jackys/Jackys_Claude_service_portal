import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { RoleServiceError, type RoleService } from './service.js';

function handleError(
  error: unknown,
  response: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
  hint: string,
): void {
  if (error instanceof RoleServiceError) {
    problem(response, error.status, error.code, 'Request failed', error.message);
    return;
  }
  if (error instanceof ZodError) {
    problem(response, 400, 'invalid-request', 'Bad Request', hint);
    return;
  }
  next(error);
}

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
    create: [
      requirePermission('admin.users'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json(await service.create(request.body, auth.profileId));
        } catch (error) {
          handleError(error, response, next, 'Send { name, copyFrom? }.');
        }
      },
    ],
    rename: [
      requirePermission('admin.users'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json(
            await service.rename(String(request.params.role), request.body, auth.profileId),
          );
        } catch (error) {
          handleError(error, response, next, 'Send { name }.');
        }
      },
    ],
    remove: [
      requirePermission('admin.users'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json(await service.remove(String(request.params.role), auth.profileId));
        } catch (error) {
          handleError(error, response, next, 'Bad request.');
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
