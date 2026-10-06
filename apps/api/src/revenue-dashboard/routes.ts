import type { RequestHandler } from 'express';
import multer from 'multer';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import {
  MAX_WORKBOOK_BYTES,
  RevenueDashboardServiceError,
  type RevenueDashboardService,
} from './service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_WORKBOOK_BYTES, files: 1 },
});

export function createRevenueDashboardHandlers(
  service: RevenueDashboardService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    importWorkbook: [
      requirePermission('revenue_dashboard.write'),
      upload.single('file'),
      async (request, response, next) => {
        try {
          const file = (request as unknown as { file?: Express.Multer.File }).file;
          if (!file) {
            problem(response, 400, 'invalid-file', 'Bad Request', 'No file was uploaded.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          const batch = await service.importWorkbook(
            (request.body as { kind?: unknown } | undefined)?.kind,
            { originalname: file.originalname, size: file.size, buffer: file.buffer },
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(201).json({ batch });
        } catch (error) {
          if (error instanceof RevenueDashboardServiceError) {
            problem(response, 400, error.code, 'Bad Request', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    batches: [
      requirePermission('revenue_dashboard.read'),
      async (_request, response, next) => {
        try {
          response.json(await service.batches());
        } catch (error) {
          next(error);
        }
      },
    ],
    summary: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          response.json(await service.summary(request.query));
        } catch (error) {
          next(error);
        }
      },
    ],
    lines: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          const result = await service.lines(request.query);
          response.json({
            batch: result.batch,
            lines: result.items,
            revenue: result.revenue,
            pagination: {
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              totalPages: Math.ceil(result.total / result.pageSize),
            },
          });
        } catch (error) {
          next(error);
        }
      },
    ],
    group: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          response.json(await service.group(request.query));
        } catch (error) {
          next(error);
        }
      },
    ],
    matrix: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          response.json(await service.matrix(request.query));
        } catch (error) {
          next(error);
        }
      },
    ],
    exceptions: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          response.json(await service.exceptions(request.query));
        } catch (error) {
          next(error);
        }
      },
    ],
    exportWorkbook: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const buffer = await service.exportWorkbook(
            request.query,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .set('Content-Disposition', 'attachment; filename="service-revenue-report.xlsx"')
            .send(buffer);
        } catch (error) {
          if (error instanceof RevenueDashboardServiceError) {
            problem(response, 404, error.code, 'Not Found', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    activity: [
      requirePermission('revenue_dashboard.read'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          await service.recordActivity(
            request.query,
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(204).end();
        } catch (error) {
          if (error instanceof RevenueDashboardServiceError) {
            problem(response, 400, error.code, 'Bad Request', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    budget: [
      requirePermission('revenue_dashboard.read'),
      async (_request, response, next) => {
        try {
          response.json(await service.budget());
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
