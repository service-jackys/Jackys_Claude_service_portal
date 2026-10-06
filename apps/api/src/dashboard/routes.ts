import type { RequestHandler } from 'express';
import type { DashboardService } from './service.js';

export function createDashboardHandlers(
  service: DashboardService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    summary: [
      requirePermission('dashboard.read'),
      async (_request, response, next) => {
        try {
          response.json({ summary: await service.summary() });
        } catch (error) {
          next(error);
        }
      },
    ],
    board: [
      requirePermission('dashboard.read'),
      async (_request, response, next) => {
        try {
          response.json({ board: await service.board() });
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
