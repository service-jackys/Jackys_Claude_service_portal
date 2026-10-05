import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ScheduleServiceError, type ScheduleService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof ScheduleServiceError)) throw error;
  const status = error.code === 'not-found' ? 404 : 409;
  const type =
    error.code === 'invalid-status' ? 'invalid-schedule-status' : `schedule-${error.code}`;
  problem(response, status, type, status === 404 ? 'Not Found' : 'Conflict', error.message);
}

function profileId(response: Parameters<RequestHandler>[1]): string {
  return (response.locals.auth as ApplicationAuth).profileId;
}

export function createScheduleHandlers(
  service: ScheduleService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    awaiting: [
      requirePermission('scheduler.read'),
      async (_request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json({ drafts: await service.awaiting() });
        } catch (error) {
          next(error);
        }
      },
    ],
    list: [
      requirePermission('scheduler.read'),
      async (request, response, next) => {
        try {
          const result = await service.list({
            page: Number(request.query.page ?? 1),
            pageSize: Number(request.query.pageSize ?? 25),
          });
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            drafts: result.items,
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
      requirePermission('scheduler.write'),
      async (request, response, next) => {
        try {
          const key = request.header('idempotency-key')?.trim();
          if (!key) {
            problem(
              response,
              400,
              'missing-idempotency-key',
              'Invalid request',
              'The Idempotency-Key header is required.',
            );
            return;
          }
          const result = await service.create(
            request.body,
            key,
            profileId(response),
            request.header('x-request-id') ?? undefined,
          );
          response.status(201).json(result);
        } catch (error) {
          next(error);
        }
      },
    ],
    detail: [
      requirePermission('scheduler.read'),
      async (request, response, next) => {
        try {
          response.json(await service.detail(String(request.params.id)));
        } catch (error) {
          if (error instanceof ScheduleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    update: [
      requirePermission('scheduler.write'),
      async (request, response, next) => {
        try {
          response.json(
            await service.update(
              String(request.params.id),
              request.body,
              profileId(response),
              request.header('x-request-id') ?? undefined,
            ),
          );
        } catch (error) {
          if (error instanceof ScheduleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    promote: [
      requirePermission('scheduler.write'),
      async (request, response, next) => {
        try {
          response.json(
            await service.promote(
              String(request.params.id),
              profileId(response),
              request.header('x-request-id') ?? undefined,
            ),
          );
        } catch (error) {
          if (error instanceof ScheduleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    cancel: [
      requirePermission('scheduler.write'),
      async (request, response, next) => {
        try {
          response.json({
            draft: await service.cancel(
              String(request.params.id),
              profileId(response),
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ScheduleServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
