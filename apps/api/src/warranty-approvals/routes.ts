import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { WarrantyApprovalError, type WarrantyApprovalService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof WarrantyApprovalError)) throw error;
  if (error.code === 'not-found') {
    problem(response, 404, 'not-found', 'Not Found', error.message);
    return;
  }
  if (error.code === 'source-not-found') {
    problem(response, 400, 'source-not-found', 'Bad Request', error.message);
    return;
  }
  problem(response, 409, 'already-decided', 'Conflict', error.message);
}

export function createWarrantyApprovalHandlers(
  service: WarrantyApprovalService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    create: [
      requirePermission('warranty_approval.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const approval = await service.create(
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(201).json({ approval });
        } catch (error) {
          if (error instanceof WarrantyApprovalError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    list: [
      requirePermission('warranty_approval.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          response.json({
            approvals: result.items,
            pagination: {
              page: Number(request.query.page ?? 1),
              pageSize: Number(request.query.pageSize ?? 25),
              total: result.total,
              totalPages: Math.ceil(result.total / Number(request.query.pageSize ?? 25)),
            },
          });
        } catch (error) {
          next(error);
        }
      },
    ],
    detail: [
      requirePermission('warranty_approval.read'),
      async (request, response, next) => {
        try {
          const approval = await service.detail(String(request.params.id));
          response.json({ approval });
        } catch (error) {
          if (error instanceof WarrantyApprovalError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    publicDetail: [
      async (request, response, next) => {
        try {
          const approval = await service.publicDetail(String(request.params.token));
          response.json({ approval });
        } catch (error) {
          if (error instanceof WarrantyApprovalError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    decide: [
      async (request, response, next) => {
        try {
          const approval = await service.decide(
            String(request.params.token),
            request.body,
            request.header('x-request-id') ?? undefined,
          );
          response.json({ approval });
        } catch (error) {
          if (error instanceof WarrantyApprovalError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
