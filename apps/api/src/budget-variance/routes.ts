import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { BudgetVarianceServiceError, type BudgetVarianceService } from './service.js';

const statusFor = { 'invalid-input': 400, 'not-found': 404, conflict: 409 } as const;

export function createBudgetVarianceHandlers(
  service: BudgetVarianceService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  const guard =
    (
      run: (
        request: Parameters<RequestHandler>[0],
        response: Parameters<RequestHandler>[1],
      ) => Promise<void>,
    ): RequestHandler =>
    async (request, response, next) => {
      try {
        await run(request, response);
      } catch (error) {
        if (error instanceof BudgetVarianceServiceError) {
          const status = statusFor[error.code];
          problem(
            response,
            status,
            error.code,
            status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : 'Bad Request',
            error.message,
          );
          return;
        }
        next(error);
      }
    };
  const auth = (response: Parameters<RequestHandler>[1]) => response.locals.auth as ApplicationAuth;
  const rid = (request: Parameters<RequestHandler>[0]) =>
    request.header('x-request-id') ?? undefined;
  return {
    config: [
      requirePermission('revenue_dashboard.read'),
      guard(async (_request, response) => {
        response.json(await service.config());
      }),
    ],
    saveConfig: [
      requirePermission('revenue_dashboard.write'),
      guard(async (request, response) => {
        await service.saveConfig(request.body, auth(response).profileId, rid(request));
        response.json(await service.config());
      }),
    ],
    variance: [
      requirePermission('revenue_dashboard.read'),
      guard(async (request, response) => {
        response.json(await service.variance(request.query));
      }),
    ],
    createVersion: [
      requirePermission('revenue_dashboard.write'),
      guard(async (request, response) => {
        const version = await service.createVersion(
          request.body,
          auth(response).profileId,
          rid(request),
        );
        response.status(201).json({ version });
      }),
    ],
    version: [
      requirePermission('revenue_dashboard.read'),
      guard(async (request, response) => {
        response.json(await service.versionDetail(String(request.params.versionId)));
      }),
    ],
    updateVersion: [
      requirePermission('revenue_dashboard.write'),
      guard(async (request, response) => {
        await service.updateVersion(
          String(request.params.versionId),
          request.body,
          auth(response).profileId,
          rid(request),
        );
        response.json(await service.versionDetail(String(request.params.versionId)));
      }),
    ],
  };
}
