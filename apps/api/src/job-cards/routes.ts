import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ServiceJobCardError, type ServiceJobCardService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof ServiceJobCardError)) throw error;
  const status = error.code === 'not-found' ? 404 : 409;
  const type =
    error.code === 'invalid-transition' ? 'invalid-status-transition' : `job-card-${error.code}`;
  problem(response, status, type, status === 404 ? 'Not Found' : 'Conflict', error.message);
}

export function createServiceJobCardHandlers(
  service: ServiceJobCardService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
          response.json({
            jobCards: result.items,
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
    prefill: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          response.json(await service.prefill(String(request.params.appointmentId)));
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    create: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            jobCard: await service.create(
              String(request.params.appointmentId),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    walkInCreate: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            jobCard: await service.createWalkIn(
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    awaiting: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          const result = await service.listAwaiting(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 50);
          response.json({
            appointments: result.items,
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
    walkInContactCheck: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.walkInContactCheck(request.query.contact));
        } catch (error) {
          next(error);
        }
      },
    ],
    updateContent: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            jobCard: await service.updateContent(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    byAppointment: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json(await service.byAppointment(String(request.params.appointmentId)));
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    detail: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json(await service.detail(String(request.params.id)));
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    history: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json({ history: await service.history(String(request.params.id)) });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    status: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            jobCard: await service.changeStatus(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    prefillFromQuotation: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          response.json(await service.prefillFromQuotation(String(request.params.quotationId)));
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    createFromQuotation: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            jobCard: await service.createFromQuotation(
              String(request.params.quotationId),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    byQuotation: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json(await service.byQuotation(String(request.params.quotationId)));
        } catch (error) {
          if (error instanceof ServiceJobCardError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
