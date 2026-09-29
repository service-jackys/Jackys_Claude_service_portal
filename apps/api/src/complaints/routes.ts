import type { RequestHandler } from 'express';
import { complaintListQuerySchema } from '../../../../packages/contracts/src/index.js';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ComplaintServiceError, type ComplaintService } from './service.js';

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof ComplaintServiceError)) throw error;
  if (error.code === 'not-found') {
    problem(response, 404, 'not-found', 'Not Found', error.message);
    return;
  }
  if (error.code === 'invalid-transition') {
    problem(response, 409, 'invalid-status-transition', 'Conflict', error.message);
    return;
  }
  problem(response, 409, 'complaint-conflict', 'Conflict', error.message);
}

export function createComplaintHandlers(
  service: ComplaintService,
  requirePermission: (permission: string) => RequestHandler,
  allowSubmission: (request: Parameters<RequestHandler>[0]) => boolean,
): Record<string, RequestHandler[]> {
  return {
    submit: [
      (request, response, next) => {
        if (!allowSubmission(request)) {
          response.setHeader('Retry-After', '60');
          problem(
            response,
            429,
            'rate-limit-exceeded',
            'Too Many Requests',
            'Too many complaint submissions were received. Try again later.',
          );
          return;
        }
        Promise.resolve()
          .then(() => service.submit(request.body, request.header('x-request-id') ?? undefined))
          .then((complaint) => response.status(201).json({ complaint }))
          .catch(next);
      },
    ],
    searchB2bBranches: [
      requirePermission('complaints.write'),
      (request, response, next) => {
        const query = typeof request.query.query === 'string' ? request.query.query : undefined;
        Promise.resolve()
          .then(() => service.searchB2bBranches(query))
          .then((branches) => response.json({ branches }))
          .catch(next);
      },
    ],
    linkB2bBranch: [
      requirePermission('complaints.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const complaint = await service.linkB2bBranch(
            String(request.params.id),
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.json({ complaint });
        } catch (error) {
          if (error instanceof ComplaintServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    list: [
      requirePermission('complaints.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          response.json({
            complaints: result.items,
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
      requirePermission('complaints.read'),
      async (request, response, next) => {
        try {
          const id = String(request.params.id);
          response.json(await service.detail(id));
        } catch (error) {
          if (error instanceof ComplaintServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    notes: [
      requirePermission('complaints.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const complaint = await service.addNotes(
            String(request.params.id),
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.json({ complaint });
        } catch (error) {
          if (error instanceof ComplaintServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    status: [
      requirePermission('complaints.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const complaint = await service.changeStatus(
            String(request.params.id),
            request.body,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.json({ complaint });
        } catch (error) {
          if (error instanceof ComplaintServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}

export function parseComplaintListQuery(input: unknown) {
  return complaintListQuerySchema.parse(input);
}
