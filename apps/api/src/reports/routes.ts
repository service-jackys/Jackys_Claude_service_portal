import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ReportServiceError, type ReportService } from './service.js';

function sendReportError(response: Parameters<RequestHandler>[1], error: ReportServiceError): void {
  if (error.code === 'forbidden-report') {
    problem(response, 403, error.code, 'Forbidden', error.message);
  } else if (error.code === 'unknown-report') {
    problem(response, 404, error.code, 'Not Found', error.message);
  } else if (error.code === 'no-rows') {
    problem(response, 404, error.code, 'Not Found', error.message);
  } else {
    problem(response, 400, error.code, 'Bad Request', error.message);
  }
}

export function createReportHandlers(
  service: ReportService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    types: [
      requirePermission('reports.read'),
      (_request, response) => {
        const auth = response.locals.auth as ApplicationAuth;
        response.setHeader('Cache-Control', 'no-store');
        response.json({ items: service.listTypes(auth.permissions) });
      },
    ],
    preview: [
      requirePermission('reports.read'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.setHeader('Cache-Control', 'no-store');
          response.json(
            await service.preview(String(request.params.type), request.query, auth.permissions),
          );
        } catch (error) {
          if (error instanceof ReportServiceError) {
            sendReportError(response, error);
            return;
          }
          next(error);
        }
      },
    ],
    download: [
      requirePermission('reports.read'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const result = await service.exportWorkbook(
            String(request.params.type),
            request.query,
            auth.permissions,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .set('Content-Disposition', `attachment; filename="${result.fileName}"`)
            .set('X-Report-Rows', String(result.rows))
            .set('Access-Control-Expose-Headers', 'Content-Disposition, X-Report-Rows')
            .send(result.buffer);
        } catch (error) {
          if (error instanceof ReportServiceError) {
            sendReportError(response, error);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
