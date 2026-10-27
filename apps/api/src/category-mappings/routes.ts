import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { CategoryMappingServiceError, type CategoryMappingService } from './service.js';

function fail(
  error: unknown,
  response: Parameters<RequestHandler>[1],
  next: (e?: unknown) => void,
) {
  if (error instanceof CategoryMappingServiceError) {
    if (error.code === 'not-found') {
      problem(response, 404, 'not-found', 'Not Found', error.message);
    } else {
      problem(response, 409, `category-mapping-${error.code}`, 'Conflict', error.message);
    }
    return;
  }
  next(error);
}

export function createCategoryMappingHandlers(
  service: CategoryMappingService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('category_mappings.read'),
      async (_request, response, next) => {
        try {
          response.json(await service.list());
        } catch (error) {
          next(error);
        }
      },
    ],
    create: [
      requirePermission('category_mappings.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            categoryMapping: await service.create(
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          fail(error, response, next);
        }
      },
    ],
    update: [
      requirePermission('category_mappings.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            categoryMapping: await service.update(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          fail(error, response, next);
        }
      },
    ],
  };
}
