import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { AppointmentServiceError, type AppointmentService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof AppointmentServiceError)) throw error;
  const status =
    error.code === 'not-found'
      ? 404
      : error.code === 'invalid-transition' ||
          error.code === 'technician-unavailable' ||
          error.code === 'technician-conflict' ||
          error.code === 'active-appointment-conflict' ||
          error.code === 'complaint-not-schedulable' ||
          error.code === 'terminal-appointment' ||
          error.code === 'message-unavailable'
        ? 409
        : 500;
  const type =
    error.code === 'invalid-transition' ? 'invalid-status-transition' : `appointment-${error.code}`;
  problem(response, status, type, status === 404 ? 'Not Found' : 'Conflict', error.message);
}

export function createAppointmentHandlers(
  service: AppointmentService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1);
          const pageSize = Number(request.query.pageSize ?? 25);
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
    create: [
      requirePermission('appointments.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const appointment = await service.create(
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response
            .status(201)
            .json({ appointment, warnings: await service.sourceWarnings(appointment) });
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    detail: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          response.json(await service.detail(String(request.params.id)));
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    history: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          response.json({ history: await service.history(String(request.params.id)) });
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    ics: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          response.type('text/calendar').send(await service.ics(String(request.params.id)));
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    messages: [
      requirePermission('appointments.read'),
      async (request, response, next) => {
        try {
          response.json(await service.messages(String(request.params.id)));
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    prepareMessage: [
      requirePermission('appointments.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response
            .status(201)
            .json(
              await service.prepareMessage(
                String(request.params.id),
                request.body,
                auth.profileId,
                request.header('x-request-id') ?? undefined,
              ),
            );
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    assignment: [
      requirePermission('appointments.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            appointment: await service.assign(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    schedule: [
      requirePermission('appointments.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            appointment: await service.reschedule(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    status: [
      requirePermission('appointments.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            appointment: await service.changeStatus(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof AppointmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
