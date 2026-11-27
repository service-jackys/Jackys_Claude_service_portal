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

// The Quote Calculators (modification.md #114) only need the rate data of their
// own product. Holders of quote_calculators.use can read exactly these domains
// without pricing_config.read; every other domain (the rate card, ...) still
// needs pricing_config.read. The D+I Quote Calculator reads dandi_pricing, but
// its internal labour-cost inputs are blanked for anyone without
// pricing_config.read (see redactForCalculator).
export const QUOTE_CALCULATOR_DOMAINS: readonly PricingConfigDomain[] = [
  'vas_price_bands',
  'vas_pricing_params',
  'amc_pricing',
  'amc_pricing_v2',
  'thomson_pricing',
  'dandi_pricing',
  'appliance_master',
];

// The D+I configuration carries our internal labour cost (cost per hour and
// minutes per unit). A calculator user needs the rates, discounts, regions and
// factors, not the cost, so those two inputs are zeroed unless the user may
// read the pricing configuration.
export function redactForCalculator<T extends { payload?: unknown }>(
  domain: PricingConfigDomain,
  record: T,
  canReadConfig: boolean,
): T {
  if (domain !== 'dandi_pricing' || canReadConfig) return record;
  const payload = { ...(record.payload as Record<string, unknown>) };
  payload.laborCostPerHour = 0;
  payload.laborMinutes = { fridge: 0, washer: 0, cooker: 0, dishwasher: 0 };
  return { ...record, payload };
}

export function createPricingConfigHandlers(
  service: PricingConfigService,
  requirePermission: (permission: string) => RequestHandler,
  requireAnyPermission: (permissions: string[]) => RequestHandler = (permissions) =>
    requirePermission(permissions[0] ?? ''),
): Record<string, RequestHandler[]> {
  const readConfig = requirePermission('pricing_config.read');
  const readConfigOrCalculator = requireAnyPermission([
    'pricing_config.read',
    'quote_calculators.use',
  ]);
  const readGate: RequestHandler = (request, response, next) => {
    const domain = parseDomain(String(request.params.domain));
    const gate =
      domain && QUOTE_CALCULATOR_DOMAINS.includes(domain) ? readConfigOrCalculator : readConfig;
    return gate(request, response, next);
  };
  return {
    get: [
      readGate,
      async (request, response, next) => {
        // Never let the browser cache or conditionally-revalidate this: the value can
        // change any time via Save/Reset/Restore, and a stale 304 with no body was being
        // mis-handled as a load failure by the client (see modification.md #26 follow-up).
        response.setHeader('Cache-Control', 'no-store');
        try {
          const domain = parseDomain(String(request.params.domain));
          if (!domain) {
            problem(response, 404, 'not-found', 'Not Found', 'Unknown pricing config domain.');
            return;
          }
          const auth = response.locals.auth as { permissions?: string[] } | undefined;
          const canReadConfig =
            !!auth?.permissions &&
            (auth.permissions.includes('*') || auth.permissions.includes('pricing_config.read'));
          response.json(redactForCalculator(domain, await service.get(domain), canReadConfig));
        } catch (error) {
          next(error);
        }
      },
    ],
    fridgeLogic: [
      requireAnyPermission([
        'pricing_config.read',
        'quote_calculators.use',
        'di_jobs.read',
        'revenue_dashboard.read',
      ]),
      async (_request, response, next) => {
        response.setHeader('Cache-Control', 'no-store');
        try {
          response.json(await service.fridgeLogic());
        } catch (error) {
          next(error);
        }
      },
    ],
    save: [
      requirePermission('pricing_config.write'),
      async (request, response, next) => {
        // Never let the browser cache or conditionally-revalidate this: the value can
        // change any time via Save/Reset/Restore, and a stale 304 with no body was being
        // mis-handled as a load failure by the client (see modification.md #26 follow-up).
        response.setHeader('Cache-Control', 'no-store');
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
        // Never let the browser cache or conditionally-revalidate this: the value can
        // change any time via Save/Reset/Restore, and a stale 304 with no body was being
        // mis-handled as a load failure by the client (see modification.md #26 follow-up).
        response.setHeader('Cache-Control', 'no-store');
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
        // Never let the browser cache or conditionally-revalidate this: the value can
        // change any time via Save/Reset/Restore, and a stale 304 with no body was being
        // mis-handled as a load failure by the client (see modification.md #26 follow-up).
        response.setHeader('Cache-Control', 'no-store');
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
        // Never let the browser cache or conditionally-revalidate this: the value can
        // change any time via Save/Reset/Restore, and a stale 304 with no body was being
        // mis-handled as a load failure by the client (see modification.md #26 follow-up).
        response.setHeader('Cache-Control', 'no-store');
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
