import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { QuotationServiceError, type QuotationService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof QuotationServiceError)) throw error;
  problem(response, 404, 'not-found', 'Not Found', error.message);
}

export function createQuotationHandlers(
  service: QuotationService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('quotation.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            quotations: result.items,
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
      requirePermission('quotation.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            quotation: await service.create(
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
      requirePermission('quotation.read'),
      async (request, response, next) => {
        try {
          response.json({ quotation: await service.detail(String(request.params.id)) });
        } catch (error) {
          if (error instanceof QuotationServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    update: [
      requirePermission('quotation.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            quotation: await service.update(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof QuotationServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
