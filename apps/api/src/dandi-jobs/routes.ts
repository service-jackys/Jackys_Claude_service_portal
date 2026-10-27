import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { DiJobServiceError, type DiJobService } from './jobs-service.js';

function fail(
  error: unknown,
  response: Parameters<RequestHandler>[1],
  next: (e?: unknown) => void,
) {
  if (error instanceof DiJobServiceError) {
    if (error.code === 'not-found') {
      problem(response, 404, 'not-found', 'Not Found', error.message);
    } else if (error.code === 'forbidden') {
      problem(response, 403, 'di-job-forbidden', 'Forbidden', error.message);
    } else if (error.code === 'invalid') {
      problem(response, 400, 'di-job-invalid', 'Bad Request', error.message);
    } else if (error.code === 'incomplete') {
      response
        .status(422)
        .type('application/problem+json')
        .json({
          type: 'urn:jackys-service-portal:errors:di-job-incomplete',
          title: 'Unprocessable Content',
          status: 422,
          detail: [error.message, ...error.messages].join(' '),
          messages: error.messages,
        });
    } else {
      problem(response, 409, 'di-job-conflict', 'Conflict', error.message);
    }
    return;
  }
  if (error instanceof ZodError) {
    problem(
      response,
      400,
      'validation',
      'Bad Request',
      error.issues.map((issue) => issue.message).join(' '),
    );
    return;
  }
  next(error);
}

export function createDiJobHandlers(
  service: DiJobService,
  requirePermission: (permission: string) => RequestHandler,
  hasPermission: (response: Parameters<RequestHandler>[1], permission: string) => boolean,
): Record<string, RequestHandler[]> {
  const profile = (response: Parameters<RequestHandler>[1]) =>
    (response.locals.auth as ApplicationAuth).profileId;
  const requestId = (request: Parameters<RequestHandler>[0]) =>
    request.header('x-request-id') ?? undefined;

  const wrap =
    (
      run: (
        request: Parameters<RequestHandler>[0],
        response: Parameters<RequestHandler>[1],
      ) => Promise<unknown>,
      status = 200,
    ): RequestHandler =>
    async (request, response, next) => {
      try {
        response.status(status).json(await run(request, response));
      } catch (error) {
        fail(error, response, next);
      }
    };

  return {
    options: [requirePermission('di_jobs.read'), wrap(() => service.options())],
    customers: [
      requirePermission('di_jobs.read'),
      wrap((request) => service.customers(String(request.query.query ?? ''))),
    ],
    items: [
      requirePermission('di_jobs.read'),
      wrap((request) => service.items(String(request.query.query ?? ''))),
    ],
    price: [requirePermission('di_jobs.read'), wrap((request) => service.price(request.body))],
    list: [requirePermission('di_jobs.read'), wrap((request) => service.list(request.query))],
    get: [
      requirePermission('di_jobs.read'),
      wrap((request) => service.get(String(request.params.id))),
    ],
    create: [
      requirePermission('di_jobs.write'),
      wrap(
        (request, response) => service.create(request.body, profile(response), requestId(request)),
        201,
      ),
    ],
    update: [
      requirePermission('di_jobs.write'),
      wrap((request, response) =>
        service.update(
          String(request.params.id),
          request.body,
          profile(response),
          requestId(request),
        ),
      ),
    ],
    complete: [
      requirePermission('di_jobs.write'),
      wrap((request, response) =>
        service.complete(String(request.params.id), profile(response), requestId(request)),
      ),
    ],
    cancel: [
      requirePermission('di_jobs.write'),
      wrap((request, response) =>
        service.cancel(
          String(request.params.id),
          profile(response),
          hasPermission(response, 'di_jobs.reopen'),
          requestId(request),
        ),
      ),
    ],
    reopen: [
      requirePermission('di_jobs.reopen'),
      wrap((request, response) =>
        service.reopen(String(request.params.id), profile(response), requestId(request)),
      ),
    ],
    compare: [
      requirePermission('di_jobs.compare'),
      wrap((request) => service.compare(request.query)),
    ],
    workedExample: [
      requirePermission('di_jobs.compare'),
      wrap((request) => service.workedExample(request.query)),
    ],
    updateSettings: [
      requirePermission('di_jobs.configure'),
      wrap((request, response) =>
        service.updateSettings(request.body, profile(response), requestId(request)),
      ),
    ],
  };
}
