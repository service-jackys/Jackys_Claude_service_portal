import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { AmcContractServiceError, type AmcContractService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof AmcContractServiceError)) throw error;
  if (error.code === 'no-plan') {
    problem(response, 400, 'amc-plan-not-found', 'Bad Request', error.message);
    return;
  }
  problem(response, 404, 'not-found', 'Not Found', error.message);
}

export function createAmcContractHandlers(
  service: AmcContractService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('amc_contract.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            amcContracts: result.items,
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
      requirePermission('amc_contract.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            amcContract: await service.create(
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
      requirePermission('amc_contract.read'),
      async (request, response, next) => {
        try {
          response.json({ amcContract: await service.detail(String(request.params.id)) });
        } catch (error) {
          if (error instanceof AmcContractServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    setStatus: [
      requirePermission('amc_contract.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            amcContract: await service.setStatus(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof AmcContractServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
