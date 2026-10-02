import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ThomsonSaleServiceError, type ThomsonSaleService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof ThomsonSaleServiceError)) throw error;
  problem(response, 404, 'not-found', 'Not Found', error.message);
}

export function createThomsonSaleHandlers(
  service: ThomsonSaleService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('thomson_sale.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            thomsonSales: result.items,
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
      requirePermission('thomson_sale.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            thomsonSale: await service.create(
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
      requirePermission('thomson_sale.read'),
      async (request, response, next) => {
        try {
          response.json({ thomsonSale: await service.detail(String(request.params.id)) });
        } catch (error) {
          if (error instanceof ThomsonSaleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
