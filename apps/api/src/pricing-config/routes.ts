import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import {
  pricingConfigDomainSchema,
  pricingConfigRestoreSchema,
  type PricingConfigDomain,
} from '../../../../packages/contracts/src/index.js';
import { PricingConfigServiceError, type PricingConfigService } from './service.js';

function parseDomain(value: string): PricingConfigDomain | null {
  const result = pricingConfigDomainSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function createPricingConfigHandlers(
  service: PricingConfigService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    get: [
      requirePermission('pricing_config.read'),
      async (request, response, next) => {
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          response.json(await service.get(domain));
        } catch (error) {
          next(error);
        }
      },
    ],
    save: [
      requirePermission('pricing_config.write'),
      async (request, response, next) => {
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          response.json(
            await service.save(
              domain,
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    ],
    reset: [
      requirePermission('pricing_config.write'),
      async (request, response, next) => {
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          response.json(
            await service.reset(
              domain,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    ],
    history: [
      requirePermission('pricing_config.read'),
      async (request, response, next) => {
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          const limit = request.query.limit ? Number(request.query.limit) : undefined;
          response.json({ history: await service.history(domain, limit) });
        } catch (error) {
          next(error);
        }
      },
    ],
    restore: [
      requirePermission('pricing_config.write'),
      async (request, response, next) => {
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          const { auditEventId } = pricingConfigRestoreSchema.parse(request.body);
          const auth = response.locals.auth as ApplicationAuth;
          response.json(
            await service.restore(
              domain,
              String(auditEventId),
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          );
        } catch (error) {
          if (error instanceof PricingConfigServiceError) {
            problem(response, 404, 'not-found', 'Not Found', error.message);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
