import type { RequestHandler } from 'express';
import type { RateCardViewService } from './service.js';

export function createRateCardViewHandlers(
  service: RateCardViewService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    view: [
      requirePermission('rate_card.view'),
      async (_request, response, next) => {
        try {
          // Rates can change at any time through the admin pages.
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.view());
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
