import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { VasSaleServiceError, type VasSaleService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof VasSaleServiceError)) throw error;
  problem(response, 404, 'not-found', 'Not Found', error.message);
}

export function createVasSaleHandlers(
  service: VasSaleService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('vas_sale.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            vasSales: result.items,
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
      requirePermission('vas_sale.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            vasSale: await service.create(
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
    detail: [
      requirePermission('vas_sale.read'),
      async (request, response, next) => {
        try {
          response.json({ vasSale: await service.detail(String(request.params.id)) });
        } catch (error) {
          if (error instanceof VasSaleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
