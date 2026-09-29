import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { SalesmanServiceError, type SalesmanService } from './service.js';

export function createSalesmanHandlers(
  service: SalesmanService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('salesmen.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            salesmen: result.items,
            pagination: {
              page,
              pageSize,
              total: result.total,
              totalPages: Math.ceil(result.total / pageSize),
            },
          });
        } catch (error) {
          next(error);
        }
      },
    ],
    create: [
      requirePermission('salesmen.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            salesman: await service.create(
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    ],
    update: [
      requirePermission('salesmen.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const salesman = await service.update(
            String(request.params.id),
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.json({ salesman });
        } catch (error) {
          if (error instanceof SalesmanServiceError) {
            problem(response, 404, 'not-found', 'Not Found', error.message);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
