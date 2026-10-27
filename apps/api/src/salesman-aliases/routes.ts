import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { SalesmanAliasServiceError, type SalesmanAliasService } from './service.js';

function fail(
  error: unknown,
  response: Parameters<RequestHandler>[1],
  next: (e?: unknown) => void,
) {
  if (error instanceof SalesmanAliasServiceError) {
    if (error.code === 'not-found') problem(response, 404, 'not-found', 'Not Found', error.message);
    else if (error.code === 'duplicate') {
      problem(response, 409, 'salesman-alias-duplicate', 'Conflict', error.message);
    } else problem(response, 400, `salesman-alias-${error.code}`, 'Bad Request', error.message);
    return;
  }
  if (error instanceof ZodError) {
    problem(
      response,
      400,
      'validation',
      'Bad Request',
      error.issues.map((i) => i.message).join(' '),
    );
    return;
  }
  next(error);
}

export function createSalesmanAliasHandlers(
  service: SalesmanAliasService,
  requirePermission: (permission: string) => RequestHandler,
): Record<'list' | 'create' | 'remove', RequestHandler[]> {
  const profile = (response: Parameters<RequestHandler>[1]) =>
    (response.locals.auth as ApplicationAuth).profileId;
  const requestId = (request: Parameters<RequestHandler>[0]) =>
    request.header('x-request-id') ?? undefined;
  return {
    list: [
      requirePermission('salesmen.read'),
      async (_request, response, next) => {
        try {
          response.json(await service.list());
        } catch (error) {
          fail(error, response, next);
        }
      },
    ],
    create: [
      requirePermission('salesmen.write'),
      async (request, response, next) => {
        try {
          response
            .status(201)
            .json(await service.create(request.body, profile(response), requestId(request)));
        } catch (error) {
          fail(error, response, next);
        }
      },
    ],
    remove: [
      requirePermission('salesmen.write'),
      async (request, response, next) => {
        try {
          response.json(
            await service.remove(String(request.params.id), profile(response), requestId(request)),
          );
        } catch (error) {
          fail(error, response, next);
        }
      },
    ],
  };
}
