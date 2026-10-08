import type { RequestHandler } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { InvoiceServiceError, type InvoiceService } from './service.js';

export function createInvoiceHandlers(
  service: InvoiceService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    ledger: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json(await service.ledger(request.query));
        } catch (error) {
          next(error);
        }
      },
    ],
    exportLedger: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const result = await service.exportLedger(
            request.query,
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
          if (error instanceof InvoiceServiceError) {
            problem(response, 404, 'billing-no-rows', 'Not Found', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    list: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          const result = await service.list(request.query);
          const page = Number(request.query.page ?? 1) || 1;
          const pageSize = Number(request.query.pageSize ?? 50) || 50;
          response.json({
            invoices: result.items,
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
    summary: [
      requirePermission('service_job_card.read'),
      async (_request, response, next) => {
        try {
          response.json({ summary: await service.summary() });
        } catch (error) {
          next(error);
        }
      },
    ],
    listRules: [
      requirePermission('service_job_card.read'),
      async (_request, response, next) => {
        try {
          response.json({ billingRules: await service.rules() });
        } catch (error) {
          next(error);
        }
      },
    ],
    createRule: [
      requirePermission('sales_channels.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            billingRule: await service.createRule(
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    ],
    updateRule: [
      requirePermission('sales_channels.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          response.json({
            billingRule: await service.updateRule(
              String(request.params.id),
              request.body,
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof InvoiceServiceError) {
            problem(response, 404, 'billing-rule-not-found', 'Not Found', error.message);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
