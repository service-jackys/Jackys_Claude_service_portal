import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { createDbPool } from '../../../../packages/db/src/client.js';
import {
  ensureLocalAdminProfile,
  ensureLocalProfile,
  updateProfileAccessByEmail,
} from '../../../../packages/db/src/profiles.js';
import { problem } from './problem.js';
import type { AuthUser, LocalAuth } from '../auth/local-auth.js';
import {
  createApplicationAuth,
  withEffectivePermissions,
  type ApplicationAuth,
} from '../auth/application-auth.js';
import { createComplaintHandlers } from '../complaints/routes.js';
import { createComplaintService } from '../complaints/service.js';
import { createLocalComplaintRateLimiter } from '../complaints/rate-limit.js';
import { createCustomerHandlers } from '../customers/routes.js';
import { createCustomerService } from '../customers/service.js';
import { createBranchHandlers } from '../branches/routes.js';
import { createBranchService } from '../branches/service.js';
import { createTechnicianHandlers } from '../technicians/routes.js';
import { createTechnicianService } from '../technicians/service.js';
import { createSalesmanHandlers } from '../salesmen/routes.js';
import { createSalesmanService } from '../salesmen/service.js';
import { createSalesChannelHandlers } from '../sales-channels/routes.js';
import { createSalesChannelService } from '../sales-channels/service.js';
import { createAppointmentHandlers } from '../appointments/routes.js';
import { createAppointmentService } from '../appointments/service.js';
import { createScheduleHandlers } from '../schedules/routes.js';
import { createScheduleService } from '../schedules/service.js';
import { createServiceJobCardHandlers } from '../job-cards/routes.js';
import { createServiceJobCardService } from '../job-cards/service.js';
import { createQuotationHandlers } from '../quotations/routes.js';
import { createQuotationService } from '../quotations/service.js';
import { createInspectionHandlers } from '../inspections/routes.js';
import { createInspectionService } from '../inspections/service.js';
import { createVasSaleHandlers } from '../vas-sales/routes.js';
import { createVasSaleService } from '../vas-sales/service.js';
import { createAmcContractHandlers } from '../amc-contracts/routes.js';
import { createAmcContractService } from '../amc-contracts/service.js';
import { createRateCardSaleHandlers } from '../rate-card-sales/routes.js';
import { createRateCardSaleService } from '../rate-card-sales/service.js';
import { createThomsonSaleHandlers } from '../thomson-sales/routes.js';
import { createThomsonSaleService } from '../thomson-sales/service.js';
import { createDailyListHandlers } from '../daily-list/routes.js';
import { createDailyListService } from '../daily-list/service.js';
import { createRoleHandlers } from '../roles/routes.js';
import { createRoleService } from '../roles/service.js';
import { createAuditHandlers } from '../audit/routes.js';
import { createAuditService } from '../audit/service.js';
import { recordAuthEvent } from '../audit/record.js';
import { createRateCardViewHandlers } from '../rate-card-view/routes.js';
import { createRateCardViewService } from '../rate-card-view/service.js';
import { createStockMasterHandlers } from '../stock-master/routes.js';
import { createStockMasterService } from '../stock-master/service.js';
import { createReportHandlers } from '../reports/routes.js';
import { createReportService } from '../reports/service.js';
import { createRevenueDashboardHandlers } from '../revenue-dashboard/routes.js';
import { createRevenueDashboardService } from '../revenue-dashboard/service.js';
import { createAttachmentHandlers } from '../attachments/routes.js';
import { createAttachmentService } from '../attachments/service.js';
import { createWarrantyApprovalHandlers } from '../warranty-approvals/routes.js';
import { createWarrantyApprovalService } from '../warranty-approvals/service.js';
import { createDashboardHandlers } from '../dashboard/routes.js';
import { createDashboardService } from '../dashboard/service.js';
import { createPricingConfigHandlers } from '../pricing-config/routes.js';
import { createPricingConfigService } from '../pricing-config/service.js';

export type RouteDefinition = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  operationId: string;
  tags: string[];
  summary: string;
  security?: 'bearerAuth' | 'optionalBearerAuth';
  requestBody?:
    | 'bootstrap'
    | 'login'
    | 'staffUser'
    | 'updateStaffUser'
    | 'changePassword'
    | 'rolePermissions'
    | 'publicComplaint'
    | 'complaintNotes'
    | 'complaintStatus'
    | 'b2bBranchLink'
    | 'customer'
    | 'branch'
    | 'technician'
    | 'availability'
    | 'salesman'
    | 'salesChannel'
    | 'appointment'
    | 'appointmentAssignment'
    | 'appointmentSchedule'
    | 'appointmentStatus'
    | 'draftSchedule'
    | 'serviceJobCardCreate'
    | 'serviceJobCardUpdate'
    | 'serviceJobCardStatus'
    | 'quotation'
    | 'inspection'
    | 'vasSale'
    | 'amcContract'
    | 'rateCardSale'
    | 'thomsonSale'
    | 'warrantyApprovalCreate'
    | 'warrantyApprovalDecision';
  parameters?: object[];
  responseContentType?: string;
  responses: number[];
  handlers: RequestHandler[];
};

const appVersion = '0.1.0';

const paginationParameters: object[] = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  {
    name: 'pageSize',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
];

const revenueFilterParameters: object[] = [
  ...[
    'year',
    'month',
    'week',
    'period',
    'yearWeek',
    'jobType',
    'channel',
    'salesPerson',
    'customer',
    'costStatus',
    'billingCode',
    'jobStatus',
    'orderStatus',
  ].map((name) => ({ name, in: 'query', schema: { type: 'string', maxLength: 200 } })),
  {
    name: 'exception',
    in: 'query',
    schema: {
      type: 'string',
      enum: [
        'billingReview',
        'channelReview',
        'costReview',
        'zeroRevenue',
        'notApproved',
        'unmatchedOrder',
        'noCustomer',
      ],
    },
  },
  { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
];

const revenueDimensionEnum = [
  'year',
  'month',
  'week',
  'period',
  'yearWeek',
  'jobType',
  'channel',
  'salesPerson',
  'customer',
  'costStatus',
  'billingCode',
  'jobStatus',
  'orderStatus',
];

const appointmentListParameters: object[] = [
  ...paginationParameters,
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
  { name: 'technicianId', in: 'query', schema: { type: 'string', pattern: '^\\d+$' } },
  { name: 'branchId', in: 'query', schema: { type: 'string', pattern: '^\\d+$' } },
  { name: 'complaintId', in: 'query', schema: { type: 'string', pattern: '^\\d+$' } },
  {
    name: 'status',
    in: 'query',
    schema: { type: 'string', enum: ['Scheduled', 'In Progress', 'Completed', 'Cancelled'] },
  },
  { name: 'region', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 120 } },
  { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
];

function providerUnavailable(response: Parameters<RequestHandler>[1]): void {
  problem(
    response,
    501,
    'auth-provider-not-configured',
    'Authentication provider not configured',
    'The configured authentication provider is not available in this environment.',
  );
}

function localBootstrapUnavailable(response: Parameters<RequestHandler>[1]): void {
  problem(
    response,
    501,
    'auth-provider-not-configured',
    'Authentication provider not configured',
    'Local bootstrap is unavailable; configure the production authentication provider.',
  );
}

// pool defaults to a fresh connection built from DATABASE_URL when the
// caller doesn't already have one to share (see tests/openapi.test.ts,
// which only needs the route shapes, not a live database) -- apps/api/src
// /app.ts passes its own shared pool explicitly so Team logins
// (auth/local-auth.ts) and every other pool-backed service here reuse the
// same connection pool instead of opening a second one.
export function createRouteCatalog(
  localAuth: LocalAuth | null,
  pool: Pool | null = process.env.DATABASE_URL ? createDbPool(process.env.DATABASE_URL) : null,
): RouteDefinition[] {
  const requirePermission = pool
    ? createApplicationAuth(pool, localAuth).requirePermission
    : (_permission: string) =>
        (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
          providerUnavailable(response);
        };
  const unavailableHandlers = (names: string[]): Record<string, RequestHandler[]> =>
    Object.fromEntries(
      names.map((name) => [
        name,
        [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      ]),
    );
  const complaintHandlers = pool
    ? createComplaintHandlers(
        createComplaintService(pool),
        requirePermission,
        createLocalComplaintRateLimiter(),
      )
    : {
        submit: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
        submitStaff: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
        notes: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
        status: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
            providerUnavailable(response);
          },
        ],
      };
  const customerHandlers = pool
    ? createCustomerHandlers(createCustomerService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const branchHandlers = pool
    ? createBranchHandlers(createBranchService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const technicianHandlers = pool
    ? createTechnicianHandlers(createTechnicianService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        availability: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const salesmanHandlers = pool
    ? createSalesmanHandlers(createSalesmanService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const salesChannelHandlers = pool
    ? createSalesChannelHandlers(createSalesChannelService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const appointmentHandlers = pool
    ? createAppointmentHandlers(createAppointmentService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        history: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        ics: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        assignment: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        status: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        schedule: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const serviceJobCardHandlers = pool
    ? createServiceJobCardHandlers(createServiceJobCardService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        prefill: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        updateContent: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        walkInCreate: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        awaiting: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        walkInContactCheck: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        byAppointment: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        history: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        status: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const quotationHandlers = pool
    ? createQuotationHandlers(createQuotationService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const inspectionHandlers = pool
    ? createInspectionHandlers(createInspectionService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const vasSaleHandlers = pool
    ? createVasSaleHandlers(createVasSaleService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const amcContractHandlers = pool
    ? createAmcContractHandlers(createAmcContractService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const rateCardSaleHandlers = pool
    ? createRateCardSaleHandlers(createRateCardSaleService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const thomsonSaleHandlers = pool
    ? createThomsonSaleHandlers(createThomsonSaleService(pool), requirePermission)
    : {
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const auditHandlers = pool
    ? createAuditHandlers(createAuditService(pool), requirePermission)
    : unavailableHandlers(['list', 'filters']);
  const dailyListHandlers = pool
    ? createDailyListHandlers(createDailyListService(pool), requirePermission)
    : unavailableHandlers(['list']);
  const roleHandlers = pool
    ? createRoleHandlers(createRoleService(pool), requirePermission)
    : unavailableHandlers(['matrix', 'update']);
  const rateCardViewHandlers = pool
    ? createRateCardViewHandlers(createRateCardViewService(pool), requirePermission)
    : unavailableHandlers(['view']);
  const stockMasterHandlers = pool
    ? createStockMasterHandlers(createStockMasterService(pool), requirePermission)
    : unavailableHandlers(['upload', 'status', 'search', 'facets']);
  const reportHandlers = pool
    ? createReportHandlers(createReportService(pool), requirePermission)
    : unavailableHandlers(['types', 'preview', 'download']);
  const revenueDashboardHandlers = pool
    ? createRevenueDashboardHandlers(createRevenueDashboardService(pool), requirePermission)
    : {
        importWorkbook: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        batches: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        summary: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        lines: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        budget: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        group: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        matrix: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        exceptions: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        activity: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        exportWorkbook: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const attachmentHandlers = pool
    ? createAttachmentHandlers(createAttachmentService(pool), requirePermission)
    : {
        upload: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        download: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        remove: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const warrantyApprovalHandlers = pool
    ? createWarrantyApprovalHandlers(createWarrantyApprovalService(pool), requirePermission)
    : {
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        publicDetail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        decide: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const dashboardHandlers = pool
    ? createDashboardHandlers(createDashboardService(pool), requirePermission)
    : {
        summary: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const scheduleHandlers = pool
    ? createScheduleHandlers(createScheduleService(pool), requirePermission)
    : {
        awaiting: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        list: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        create: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        detail: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        update: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        promote: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        cancel: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const pricingConfigHandlers = pool
    ? createPricingConfigHandlers(createPricingConfigService(pool), requirePermission)
    : {
        get: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        save: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        reset: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        history: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        restore: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const routes: RouteDefinition[] = [
    {
      method: 'get',
      path: '/api',
      operationId: 'getApiInfo',
      tags: ['System'],
      summary: 'Get API metadata',
      responses: [200],
      handlers: [
        (_request, response) => {
          response.json({
            name: "Jacky's Service Portal API",
            version: appVersion,
            status: 'ok',
            environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
            capabilities: ['health', 'auth'],
          });
        },
      ],
    },
    {
      method: 'get',
      path: '/health',
      operationId: 'getHealth',
      tags: ['System'],
      summary: 'Check service health',
      responses: [200],
      handlers: [
        (_request, response) => {
          response.json({
            status: 'ok',
            service: 'jackys-service-portal',
            version: appVersion,
            timestamp: new Date().toISOString(),
          });
        },
      ],
    },
    {
      method: 'get',
      path: '/api/health',
      operationId: 'getApiHealth',
      tags: ['System'],
      summary: 'Check API health',
      responses: [200],
      handlers: [
        (_request, response) => {
          response.json({
            status: 'ok',
            service: 'jackys-service-portal',
            version: appVersion,
            timestamp: new Date().toISOString(),
          });
        },
      ],
    },
    {
      method: 'post',
      path: '/api/auth/bootstrap',
      operationId: 'bootstrapAuth',
      tags: ['Authentication'],
      summary: 'Create the one-time local development administrator',
      requestBody: 'bootstrap',
      responses: [201, 400, 401, 409, 501],
      handlers: [
        async (request, response, next) => {
          if (!localAuth) {
            localBootstrapUnavailable(response);
            return;
          }
          try {
            const result = await localAuth.bootstrap(request.body);
            if (result.kind === 'invalid-token') {
              problem(
                response,
                401,
                'invalid-bootstrap-token',
                'Unauthorized',
                'The bootstrap token is invalid.',
              );
              return;
            }
            if (result.kind === 'unavailable') {
              problem(
                response,
                409,
                'bootstrap-unavailable',
                'Bootstrap unavailable',
                'An administrator account already exists for this installation. Bootstrap can only be used once, ever -- sign in with that account instead.',
              );
              return;
            }
            if (pool) {
              await ensureLocalAdminProfile(pool, result.user.email, result.user.name);
            }
            response.status(201).json({
              token: result.token,
              user: await withEffectivePermissions(pool, result.user),
            });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'post',
      path: '/api/auth/login',
      operationId: 'loginAuth',
      tags: ['Authentication'],
      summary: 'Create a local development session',
      requestBody: 'login',
      responses: [200, 400, 401, 501],
      handlers: [
        async (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          try {
            const result = await localAuth.login(request.body);
            if (result.kind === 'invalid-credentials') {
              const attempted = (request.body as { email?: unknown } | undefined)?.email;
              await recordAuthEvent(pool, {
                action: 'auth.login_failed',
                metadata: { email: typeof attempted === 'string' ? attempted.slice(0, 200) : null },
                requestId: request.header('x-request-id') ?? undefined,
              });
              problem(
                response,
                401,
                'invalid-credentials',
                'Unauthorized',
                'The email or password is incorrect.',
              );
              return;
            }
            await recordAuthEvent(pool, {
              action: 'auth.login',
              actorEmail: result.user.email,
              requestId: request.header('x-request-id') ?? undefined,
            });
            response.json({
              token: result.token,
              user: await withEffectivePermissions(pool, result.user),
            });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'post',
      path: '/api/auth/users',
      operationId: 'createStaffUser',
      tags: ['Authentication'],
      summary:
        'Add another local-auth user (admin only, so a teammate can test with their own login)',
      security: 'bearerAuth',
      requestBody: 'staffUser',
      responses: [201, 400, 401, 403, 409, 501],
      handlers: [
        requirePermission('admin.users'),
        async (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          try {
            const result = await localAuth.createUser(request.body);
            if (result.kind === 'email-taken') {
              problem(
                response,
                409,
                'email-taken',
                'Email already in use',
                'A local user with that email already exists.',
              );
              return;
            }
            if (pool) {
              await ensureLocalProfile(pool, result.user.email, result.user.name, result.user.role);
            }
            await recordAuthEvent(pool, {
              action: 'auth.user_created',
              actorProfileId: (response.locals.auth as ApplicationAuth).profileId,
              metadata: {
                email: result.user.email,
                name: result.user.name,
                role: result.user.role,
              },
              requestId: request.header('x-request-id') ?? undefined,
            });
            response.status(201).json({ user: result.user });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'get',
      path: '/api/auth/users',
      operationId: 'listStaffUsers',
      tags: ['Authentication'],
      summary: 'List the local-auth users created for this running server (admin only)',
      security: 'bearerAuth',
      responses: [200, 401, 403, 501],
      handlers: [
        requirePermission('admin.users'),
        async (_request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          try {
            response.json({ users: await localAuth.listUsers() });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'patch',
      path: '/api/auth/users/{id}',
      operationId: 'updateStaffUser',
      tags: ['Authentication'],
      summary:
        "Change a teammate's role and/or turn their login on or off (admin only, see modification.md #13)",
      security: 'bearerAuth',
      requestBody: 'updateStaffUser',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: [200, 400, 401, 403, 404, 409, 501],
      handlers: [
        requirePermission('admin.users'),
        async (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          const targetId = String(request.params.id);
          if (targetId === auth.subject) {
            problem(
              response,
              409,
              'cannot-modify-self',
              'Conflict',
              'You cannot change your own role or active status here.',
            );
            return;
          }
          try {
            const result = await localAuth.updateUser(targetId, request.body);
            if (result.kind === 'not-found') {
              problem(
                response,
                404,
                'not-found',
                'Not Found',
                'That teammate login was not found.',
              );
              return;
            }
            const parsedBody = request.body as {
              role?: string;
              active?: boolean;
              password?: string;
            };
            if (pool) {
              await updateProfileAccessByEmail(pool, result.user.email, {
                active: parsedBody.active,
                roleCode: parsedBody.role,
              });
            }
            if (result.passwordReset) {
              await recordAuthEvent(pool, {
                action: 'auth.password_reset',
                actorProfileId: auth.profileId,
                metadata: { email: result.user.email },
                requestId: request.header('x-request-id') ?? undefined,
              });
            }
            if (parsedBody.role !== undefined || parsedBody.active !== undefined) {
              await recordAuthEvent(pool, {
                action: 'auth.user_updated',
                actorProfileId: auth.profileId,
                metadata: {
                  email: result.user.email,
                  ...(parsedBody.role !== undefined ? { role: parsedBody.role } : {}),
                  ...(parsedBody.active !== undefined ? { active: parsedBody.active } : {}),
                },
                requestId: request.header('x-request-id') ?? undefined,
              });
            }
            response.json({ user: result.user });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'get',
      path: '/api/auth/me',
      operationId: 'getCurrentUser',
      tags: ['Authentication'],
      summary: 'Get the authenticated user',
      security: 'bearerAuth',
      responses: [200, 401, 501],
      handlers: [
        async (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          await localAuth.requireAuth(request, response, next);
        },
        async (_request, response, next) => {
          try {
            response.json({
              user: await withEffectivePermissions(pool, response.locals.auth.user as AuthUser),
            });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'post',
      path: '/api/auth/change-password',
      operationId: 'changeOwnPassword',
      tags: ['Authentication'],
      summary: 'Choose a new password for the signed-in user (also clears a forced change)',
      security: 'bearerAuth',
      requestBody: 'changePassword',
      responses: [200, 400, 401, 403, 501],
      handlers: [
        async (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          await localAuth.requireAuth(request, response, next);
        },
        async (request, response, next) => {
          try {
            const { token, user } = response.locals.auth as { token: string; user: AuthUser };
            const result = await localAuth!.changePassword(user.id, token, request.body);
            if (result.kind === 'wrong-current') {
              problem(
                response,
                403,
                'wrong-current-password',
                'Forbidden',
                'The current password is incorrect.',
              );
              return;
            }
            if (result.kind === 'same-password') {
              problem(
                response,
                400,
                'same-password',
                'Bad Request',
                'Choose a password different from the current one.',
              );
              return;
            }
            if (result.kind === 'not-found') {
              problem(response, 401, 'unauthorized', 'Unauthorized', 'Sign in again.');
              return;
            }
            await recordAuthEvent(pool, {
              action: 'auth.password_changed',
              actorEmail: result.user.email,
              metadata: { email: result.user.email },
              requestId: request.header('x-request-id') ?? undefined,
            });
            response.json({ user: await withEffectivePermissions(pool, result.user) });
          } catch (error) {
            next(error);
          }
        },
      ],
    },
    {
      method: 'get',
      path: '/api/role-matrix',
      operationId: 'getRoleMatrix',
      tags: ['Authentication'],
      summary: 'Which permissions each role carries (admin only)',
      security: 'bearerAuth',
      responses: [200, 401, 403, 500],
      handlers: roleHandlers.matrix,
    },
    {
      method: 'put',
      path: '/api/role-matrix/{role}',
      operationId: 'setRolePermissions',
      tags: ['Authentication'],
      summary: "Replace one role's permissions (admin only; the admin role is fixed)",
      security: 'bearerAuth',
      requestBody: 'rolePermissions',
      parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }],
      responses: [200, 400, 401, 403, 404, 409, 500],
      handlers: roleHandlers.update,
    },
    {
      method: 'post',
      path: '/api/auth/logout',
      operationId: 'logoutAuth',
      tags: ['Authentication'],
      summary: 'Revoke a local development session',
      security: 'optionalBearerAuth',
      responses: [204, 501],
      handlers: [
        async (request, response) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          const authorization = request.header('authorization');
          const token = authorization?.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length).trim()
            : undefined;
          if (token) {
            const user = await localAuth.getUserFromToken(token);
            localAuth.revokeToken(token);
            if (user) {
              await recordAuthEvent(pool, {
                action: 'auth.logout',
                actorEmail: user.email,
                requestId: request.header('x-request-id') ?? undefined,
              });
            }
          }
          response.status(204).send();
        },
      ],
    },
    {
      method: 'get',
      path: '/api/auth/admin-check',
      operationId: 'adminCheck',
      tags: ['Authentication'],
      summary: 'Check dashboard permission',
      security: 'bearerAuth',
      responses: [200, 401, 403, 501],
      handlers: [
        localAuth?.requirePermission('dashboard.read') ??
          ((_request, response) => {
            providerUnavailable(response);
          }),
        (_request, response) => {
          response.json({ ok: true });
        },
      ],
    },
    ...[
      {
        method: 'post' as const,
        path: '/api/public/complaints',
        operationId: 'submitPublicComplaint',
        tags: ['Complaints'],
        summary: 'Submit a public complaint',
        requestBody: 'publicComplaint' as const,
        responses: [201, 400, 429, 500],
        handlers: complaintHandlers.submit,
      },
      {
        method: 'post' as const,
        path: '/api/complaints',
        operationId: 'submitStaffComplaint',
        tags: ['Complaints'],
        summary:
          "Register a service request on a customer's behalf, e.g. from a phone call or email (staff-only, see modification.md #12)",
        security: 'bearerAuth' as const,
        requestBody: 'publicComplaint' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: complaintHandlers.submitStaff,
      },
      {
        method: 'get' as const,
        path: '/api/b2b-branches',
        operationId: 'searchB2bBranches',
        tags: ['Complaints'],
        summary: 'Search the B2B Branch / School master list (staff-only, see modification.md #2)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'query', in: 'query', required: false, schema: { type: 'string' } }],
        responses: [200, 401, 403, 500],
        handlers: complaintHandlers.searchB2bBranches,
      },
      {
        method: 'get' as const,
        path: '/api/b2b-branches/{custCode}',
        operationId: 'getB2bBranch',
        tags: ['Complaints'],
        summary:
          'Look up a single B2B Branch / School by Cust_Code (staff-only, see modification.md #19)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'custCode', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: complaintHandlers.getB2bBranch,
      },
      {
        method: 'patch' as const,
        path: '/api/complaints/{id}/b2b-branch',
        operationId: 'linkComplaintB2bBranch',
        tags: ['Complaints'],
        summary: "Link (or unlink) a complaint's B2B Branch / School to the master list",
        security: 'bearerAuth' as const,
        requestBody: 'b2bBranchLink' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: complaintHandlers.linkB2bBranch,
      },
      {
        method: 'get' as const,
        path: '/api/complaints',
        operationId: 'listComplaints',
        tags: ['Complaints'],
        summary: 'List complaints',
        security: 'bearerAuth' as const,
        responses: [200, 400, 401, 403, 500],
        handlers: complaintHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/complaints/{id}',
        operationId: 'getComplaint',
        tags: ['Complaints'],
        summary: 'Get a complaint',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: complaintHandlers.detail,
      },
      {
        method: 'post' as const,
        path: '/api/complaints/{id}/notes',
        operationId: 'addComplaintNotes',
        tags: ['Complaints'],
        summary: 'Update complaint CCE notes',
        security: 'bearerAuth' as const,
        requestBody: 'complaintNotes' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: complaintHandlers.notes,
      },
      {
        method: 'patch' as const,
        path: '/api/complaints/{id}/status',
        operationId: 'updateComplaintStatus',
        tags: ['Complaints'],
        summary: 'Change complaint status',
        security: 'bearerAuth' as const,
        requestBody: 'complaintStatus' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: complaintHandlers.status,
      },
      {
        method: 'get' as const,
        path: '/api/customers',
        operationId: 'listCustomers',
        tags: ['Customers'],
        summary: 'List customers',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: customerHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/customers',
        operationId: 'createCustomer',
        tags: ['Customers'],
        summary: 'Create a customer',
        security: 'bearerAuth' as const,
        requestBody: 'customer' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: customerHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/customers/{id}',
        operationId: 'getCustomer',
        tags: ['Customers'],
        summary: 'Get a customer',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: customerHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/customers/{id}',
        operationId: 'updateCustomer',
        tags: ['Customers'],
        summary: 'Update a customer',
        security: 'bearerAuth' as const,
        requestBody: 'customer' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: customerHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/branches',
        operationId: 'listBranches',
        tags: ['Branches'],
        summary: 'List branches',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'customerId', in: 'query', schema: { type: 'string', pattern: '^\\d+$' } },
          { name: 'region', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 120 } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: branchHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/branches',
        operationId: 'createBranch',
        tags: ['Branches'],
        summary: 'Create a branch',
        security: 'bearerAuth' as const,
        requestBody: 'branch' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: branchHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/branches/{id}',
        operationId: 'getBranch',
        tags: ['Branches'],
        summary: 'Get a branch',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: branchHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/branches/{id}',
        operationId: 'updateBranch',
        tags: ['Branches'],
        summary: 'Update a branch',
        security: 'bearerAuth' as const,
        requestBody: 'branch' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: branchHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/technicians',
        operationId: 'listTechnicians',
        tags: ['Technicians'],
        summary: 'List technicians',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'active', in: 'query', schema: { type: 'boolean' } },
          { name: 'region', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 120 } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
          { name: 'availableDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: technicianHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/technicians',
        operationId: 'createTechnician',
        tags: ['Technicians'],
        summary: 'Create a technician',
        security: 'bearerAuth' as const,
        requestBody: 'technician' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: technicianHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/technicians/{id}',
        operationId: 'getTechnician',
        tags: ['Technicians'],
        summary: 'Get a technician',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: technicianHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/technicians/{id}',
        operationId: 'updateTechnician',
        tags: ['Technicians'],
        summary: 'Update a technician',
        security: 'bearerAuth' as const,
        requestBody: 'technician' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: technicianHandlers.update,
      },
      {
        method: 'put' as const,
        path: '/api/technicians/{id}/availability',
        operationId: 'replaceTechnicianAvailability',
        tags: ['Technicians'],
        summary: 'Replace technician availability',
        security: 'bearerAuth' as const,
        requestBody: 'availability' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: technicianHandlers.availability,
      },
      {
        method: 'get' as const,
        path: '/api/salesmen',
        operationId: 'listSalesmen',
        tags: ['Master data'],
        summary: 'List the salesmen master list (modification.md #8)',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'active', in: 'query', schema: { type: 'boolean' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: salesmanHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/salesmen',
        operationId: 'createSalesman',
        tags: ['Master data'],
        summary: 'Add a salesman to the master list',
        security: 'bearerAuth' as const,
        requestBody: 'salesman' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: salesmanHandlers.create,
      },
      {
        method: 'patch' as const,
        path: '/api/salesmen/{id}',
        operationId: 'updateSalesman',
        tags: ['Master data'],
        summary: 'Update a salesman on the master list',
        security: 'bearerAuth' as const,
        requestBody: 'salesman' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: salesmanHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/pricing-config/{domain}',
        operationId: 'getPricingConfig',
        tags: ['Pricing config'],
        summary:
          'Phase 6 (modification.md #26): current admin pricing config for one domain, or its Excel default if never saved',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: pricingConfigHandlers.get,
      },
      {
        method: 'put' as const,
        path: '/api/pricing-config/{domain}',
        operationId: 'savePricingConfig',
        tags: ['Pricing config'],
        summary:
          'Save an admin override for one pricing config domain (versioned via audit_events)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: pricingConfigHandlers.save,
      },
      {
        method: 'post' as const,
        path: '/api/pricing-config/{domain}/reset',
        operationId: 'resetPricingConfig',
        tags: ['Pricing config'],
        summary: 'Reset one pricing config domain back to its Excel default',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: pricingConfigHandlers.reset,
      },
      {
        method: 'get' as const,
        path: '/api/pricing-config/{domain}/history',
        operationId: 'listPricingConfigHistory',
        tags: ['Pricing config'],
        summary:
          'List past saved/reset/restored versions of one pricing config domain, newest first',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'domain', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: [200, 401, 403, 404, 500],
        handlers: pricingConfigHandlers.history,
      },
      {
        method: 'post' as const,
        path: '/api/pricing-config/{domain}/restore',
        operationId: 'restorePricingConfig',
        tags: ['Pricing config'],
        summary:
          'Restore one pricing config domain to a past saved version by its history entry id',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: pricingConfigHandlers.restore,
      },
      {
        method: 'get' as const,
        path: '/api/sales-channels',
        operationId: 'listSalesChannels',
        tags: ['Master data'],
        summary: 'List the sales channels master list (modification.md #8, super admin managed)',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'active', in: 'query', schema: { type: 'boolean' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: salesChannelHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/sales-channels',
        operationId: 'createSalesChannel',
        tags: ['Master data'],
        summary: 'Add a sales channel to the master list (super admin)',
        security: 'bearerAuth' as const,
        requestBody: 'salesChannel' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: salesChannelHandlers.create,
      },
      {
        method: 'patch' as const,
        path: '/api/sales-channels/{id}',
        operationId: 'updateSalesChannel',
        tags: ['Master data'],
        summary: 'Update a sales channel on the master list (super admin)',
        security: 'bearerAuth' as const,
        requestBody: 'salesChannel' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: salesChannelHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/daily-list',
        operationId: 'listDailyAppointments',
        tags: ['Appointments'],
        summary: 'Appointments for a day range with technician and branch, for the daily list',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'includeCancelled', in: 'query', schema: { type: 'string' } },
        ],
        responses: [200, 400, 401, 403, 500],
        handlers: dailyListHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/appointments',
        operationId: 'listAppointments',
        tags: ['Appointments'],
        summary: 'List appointments',
        security: 'bearerAuth' as const,
        parameters: appointmentListParameters,
        responses: [200, 400, 401, 403, 500],
        handlers: appointmentHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/appointments',
        operationId: 'createAppointment',
        tags: ['Appointments'],
        summary: 'Create an appointment',
        security: 'bearerAuth' as const,
        requestBody: 'appointment' as const,
        responses: [201, 400, 401, 403, 409, 500],
        handlers: appointmentHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/{id}',
        operationId: 'getAppointment',
        tags: ['Appointments'],
        summary: 'Get an appointment',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: appointmentHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/{id}/history',
        operationId: 'getAppointmentHistory',
        tags: ['Appointments'],
        summary: 'Get appointment status history',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: appointmentHandlers.history,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/{id}/ics',
        operationId: 'getAppointmentIcs',
        tags: ['Appointments'],
        summary: 'Download an appointment calendar event',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responseContentType: 'text/calendar',
        responses: [200, 401, 403, 404, 500],
        handlers: appointmentHandlers.ics,
      },
      {
        method: 'patch' as const,
        path: '/api/appointments/{id}/assignment',
        operationId: 'assignAppointment',
        tags: ['Appointments'],
        summary: 'Assign or unassign an appointment technician',
        security: 'bearerAuth' as const,
        requestBody: 'appointmentAssignment' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: appointmentHandlers.assignment,
      },
      {
        method: 'patch' as const,
        path: '/api/appointments/{id}/schedule',
        operationId: 'rescheduleAppointment',
        tags: ['Appointments'],
        summary: 'Reschedule an appointment',
        security: 'bearerAuth' as const,
        requestBody: 'appointmentSchedule' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: appointmentHandlers.schedule,
      },
      {
        method: 'patch' as const,
        path: '/api/appointments/{id}/status',
        operationId: 'updateAppointmentStatus',
        tags: ['Appointments'],
        summary: 'Change appointment status',
        security: 'bearerAuth' as const,
        requestBody: 'appointmentStatus' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: appointmentHandlers.status,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards',
        operationId: 'listServiceJobCards',
        tags: ['Service Job Cards'],
        summary: 'List service job cards',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['Open', 'In Progress', 'Completed', 'Cancelled'] },
          },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: serviceJobCardHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards/awaiting',
        operationId: 'listAppointmentsAwaitingJobCard',
        tags: ['Service Job Cards'],
        summary: 'Completed appointments that do not have a service job card yet',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: serviceJobCardHandlers.awaiting,
      },
      {
        method: 'post' as const,
        path: '/api/job-cards/walk-in',
        operationId: 'createWalkInServiceJobCard',
        tags: ['Service Job Cards'],
        summary:
          'Open a service job card for a customer who walks in (no complaint, appointment or quotation); needs customer name, contact, item and fault',
        security: 'bearerAuth' as const,
        requestBody: 'serviceJobCardCreate' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: serviceJobCardHandlers.walkInCreate,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards/walk-in/contact-check',
        operationId: 'walkInContactCheck',
        tags: ['Service Job Cards'],
        summary:
          'Open complaints, appointments and walk-in cards for the same phone number (duplicate check)',
        security: 'bearerAuth' as const,
        parameters: [
          {
            name: 'contact',
            in: 'query',
            required: true,
            schema: { type: 'string', maxLength: 50 },
          },
        ],
        responses: [200, 401, 403, 500],
        handlers: serviceJobCardHandlers.walkInContactCheck,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/{appointmentId}/job-card/prefill',
        operationId: 'prefillServiceJobCard',
        tags: ['Service Job Cards'],
        summary: 'Pull default job card content from a completed appointment',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'appointmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [200, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.prefill,
      },
      {
        method: 'post' as const,
        path: '/api/appointments/{appointmentId}/job-card',
        operationId: 'createServiceJobCard',
        tags: ['Service Job Cards'],
        summary: 'Create a service job card for an appointment',
        security: 'bearerAuth' as const,
        requestBody: 'serviceJobCardCreate' as const,
        parameters: [
          { name: 'appointmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [201, 400, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/appointments/{appointmentId}/job-card',
        operationId: 'getAppointmentJobCard',
        tags: ['Service Job Cards'],
        summary: 'Get the service job card for an appointment',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'appointmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [200, 401, 403, 404, 500],
        handlers: serviceJobCardHandlers.byAppointment,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards/{id}',
        operationId: 'getServiceJobCard',
        tags: ['Service Job Cards'],
        summary: 'Get a service job card',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: serviceJobCardHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards/{id}/history',
        operationId: 'getServiceJobCardHistory',
        tags: ['Service Job Cards'],
        summary: 'Get service job card history',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: serviceJobCardHandlers.history,
      },
      {
        method: 'patch' as const,
        path: '/api/job-cards/{id}',
        operationId: 'updateServiceJobCardContent',
        tags: ['Service Job Cards'],
        summary: "Edit a service job card's content",
        security: 'bearerAuth' as const,
        requestBody: 'serviceJobCardUpdate' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.updateContent,
      },
      {
        method: 'patch' as const,
        path: '/api/job-cards/{id}/status',
        operationId: 'updateServiceJobCardStatus',
        tags: ['Service Job Cards'],
        summary: 'Change a service job card status',
        security: 'bearerAuth' as const,
        requestBody: 'serviceJobCardStatus' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.status,
      },
      {
        method: 'get' as const,
        path: '/api/schedules/awaiting',
        operationId: 'listAwaitingDrafts',
        tags: ['Schedules'],
        summary: 'Draft schedules still waiting to be promoted or cancelled, with their jobs',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: scheduleHandlers.awaiting,
      },
      {
        method: 'get' as const,
        path: '/api/schedules/drafts',
        operationId: 'listDraftSchedules',
        tags: ['Schedules'],
        summary: 'List draft schedules',
        security: 'bearerAuth' as const,
        parameters: paginationParameters,
        responses: [200, 400, 401, 403, 500],
        handlers: scheduleHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/schedules/drafts',
        operationId: 'createDraftSchedule',
        tags: ['Schedules'],
        summary: 'Create a draft schedule',
        security: 'bearerAuth' as const,
        requestBody: 'draftSchedule' as const,
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
          },
        ],
        responses: [201, 400, 401, 403, 500],
        handlers: scheduleHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/schedules/drafts/{id}',
        operationId: 'getDraftSchedule',
        tags: ['Schedules'],
        summary: 'Get a draft schedule',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: scheduleHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/schedules/drafts/{id}',
        operationId: 'updateDraftSchedule',
        tags: ['Schedules'],
        summary: 'Update a draft schedule',
        security: 'bearerAuth' as const,
        requestBody: 'draftSchedule' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 409, 500],
        handlers: scheduleHandlers.update,
      },
      {
        method: 'post' as const,
        path: '/api/schedules/drafts/{id}/promote',
        operationId: 'promoteDraftSchedule',
        tags: ['Schedules'],
        summary: 'Promote a draft schedule',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 409, 500],
        handlers: scheduleHandlers.promote,
      },
      {
        method: 'post' as const,
        path: '/api/schedules/drafts/{id}/cancel',
        operationId: 'cancelDraftSchedule',
        tags: ['Schedules'],
        summary: 'Cancel a draft schedule',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 409, 500],
        handlers: scheduleHandlers.cancel,
      },
      {
        method: 'get' as const,
        path: '/api/quotations',
        operationId: 'listQuotations',
        tags: ['Quotations'],
        summary: 'List quotations',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'appointmentId', in: 'query', schema: { type: 'string', pattern: '^\d+$' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
          {
            name: 'unused',
            in: 'query',
            schema: { type: 'string', enum: ['true', 'false'] },
            description: 'true excludes quotations that already have a service job card.',
          },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: quotationHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/quotations',
        operationId: 'createQuotation',
        tags: ['Quotations'],
        summary: 'Create a quotation',
        security: 'bearerAuth' as const,
        requestBody: 'quotation' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: quotationHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/quotations/{id}',
        operationId: 'getQuotation',
        tags: ['Quotations'],
        summary: 'Get a quotation',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: quotationHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/quotations/{id}',
        operationId: 'updateQuotation',
        tags: ['Quotations'],
        summary: 'Edit a quotation',
        security: 'bearerAuth' as const,
        requestBody: 'quotation' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: quotationHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/quotations/{quotationId}/job-card/prefill',
        operationId: 'prefillServiceJobCardFromQuotation',
        tags: ['Service Job Cards'],
        summary: 'Pull default job card content from a saved quotation',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'quotationId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [200, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.prefillFromQuotation,
      },
      {
        method: 'post' as const,
        path: '/api/quotations/{quotationId}/job-card',
        operationId: 'createServiceJobCardFromQuotation',
        tags: ['Service Job Cards'],
        summary: 'Create a service job card from a saved quotation',
        security: 'bearerAuth' as const,
        requestBody: 'serviceJobCardCreate' as const,
        parameters: [
          { name: 'quotationId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [201, 400, 401, 403, 404, 409, 500],
        handlers: serviceJobCardHandlers.createFromQuotation,
      },
      {
        method: 'get' as const,
        path: '/api/quotations/{quotationId}/job-card',
        operationId: 'getQuotationJobCard',
        tags: ['Service Job Cards'],
        summary: 'Get the service job card created from a quotation, if any',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'quotationId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [200, 401, 403, 404, 500],
        handlers: serviceJobCardHandlers.byQuotation,
      },
      {
        method: 'get' as const,
        path: '/api/inspections',
        operationId: 'listInspections',
        tags: ['Inspections'],
        summary: 'List inspections',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'appointmentId', in: 'query', schema: { type: 'string', pattern: '^\d+$' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: inspectionHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/inspections',
        operationId: 'createInspection',
        tags: ['Inspections'],
        summary: 'Create an inspection',
        security: 'bearerAuth' as const,
        requestBody: 'inspection' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: inspectionHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/inspections/{id}',
        operationId: 'getInspection',
        tags: ['Inspections'],
        summary: 'Get an inspection',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: inspectionHandlers.detail,
      },
      {
        method: 'patch' as const,
        path: '/api/inspections/{id}',
        operationId: 'updateInspection',
        tags: ['Inspections'],
        summary: 'Edit an inspection',
        security: 'bearerAuth' as const,
        requestBody: 'inspection' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: inspectionHandlers.update,
      },
      {
        method: 'get' as const,
        path: '/api/vas-sales',
        operationId: 'listVasSales',
        tags: ['VAS Sales'],
        summary: 'List issued VAS sales',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: vasSaleHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/vas-sales',
        operationId: 'createVasSale',
        tags: ['VAS Sales'],
        summary: 'Issue a VAS sale and allocate its certificate reference',
        security: 'bearerAuth' as const,
        requestBody: 'vasSale' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: vasSaleHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/vas-sales/{id}',
        operationId: 'getVasSale',
        tags: ['VAS Sales'],
        summary: 'Get a VAS sale (e.g. to reprint its certificate)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: vasSaleHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/amc-contracts',
        operationId: 'listAmcContracts',
        tags: ['AMC Contracts'],
        summary: 'List issued AMC contracts',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: amcContractHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/amc-contracts',
        operationId: 'createAmcContract',
        tags: ['AMC Contracts'],
        summary: 'Issue an AMC contract and allocate its certificate reference',
        security: 'bearerAuth' as const,
        requestBody: 'amcContract' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: amcContractHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/amc-contracts/{id}',
        operationId: 'getAmcContract',
        tags: ['AMC Contracts'],
        summary: 'Get an AMC contract (e.g. to reprint its certificate)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: amcContractHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/rate-card-sales',
        operationId: 'listRateCardSales',
        tags: ['Rate Card Sales'],
        summary: 'List issued Rate Card sales',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: rateCardSaleHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/rate-card-sales',
        operationId: 'createRateCardSale',
        tags: ['Rate Card Sales'],
        summary: 'Issue a Rate Card sale and allocate its quotation reference',
        security: 'bearerAuth' as const,
        requestBody: 'rateCardSale' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: rateCardSaleHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/rate-card-sales/{id}',
        operationId: 'getRateCardSale',
        tags: ['Rate Card Sales'],
        summary: 'Get a Rate Card sale (e.g. to reprint its quotation)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: rateCardSaleHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/thomson-sales',
        operationId: 'listThomsonSales',
        tags: ['Thomson Sales'],
        summary: 'List issued Thomson sales',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: thomsonSaleHandlers.list,
      },
      {
        method: 'post' as const,
        path: '/api/thomson-sales',
        operationId: 'createThomsonSale',
        tags: ['Thomson Sales'],
        summary: 'Issue a Thomson sale and allocate its quotation reference',
        security: 'bearerAuth' as const,
        requestBody: 'thomsonSale' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: thomsonSaleHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/thomson-sales/{id}',
        operationId: 'getThomsonSale',
        tags: ['Thomson Sales'],
        summary: 'Get a Thomson sale (e.g. to reprint its quotation)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: thomsonSaleHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/rate-card',
        operationId: 'getRateCard',
        tags: ['Rate Card'],
        summary:
          'Read-only price list: activity rates plus D+I / Installation base rates, discounts and transport',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: rateCardViewHandlers.view,
      },
      {
        method: 'post' as const,
        path: '/api/stock/upload',
        operationId: 'uploadStockMaster',
        tags: ['Stock Master'],
        summary:
          'Upload the ERP Current Stock Valuation (.xlsx) for one channel (multipart/form-data: file, channel=JDI|JMS|TGE)',
        security: 'bearerAuth' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: stockMasterHandlers.upload,
      },
      {
        method: 'get' as const,
        path: '/api/stock/status',
        operationId: 'getStockMasterStatus',
        tags: ['Stock Master'],
        summary: 'Last upload, item counts and not-seen counts per channel',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: stockMasterHandlers.status,
      },
      {
        method: 'get' as const,
        path: '/api/stock/facets',
        operationId: 'getStockFacets',
        tags: ['Stock Master'],
        summary: 'Brands and main groups available to the item lookup, with counts',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: stockMasterHandlers.facets,
      },
      {
        method: 'get' as const,
        path: '/api/stock/items',
        operationId: 'searchStockItems',
        tags: ['Stock Master'],
        summary:
          'Search unique stock items by item code or description; optional brand and group filters (appliances ranked first)',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 80 } },
          {
            name: 'brand',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 120 },
          },
          {
            name: 'group',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 120 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 50 },
          },
        ],
        responses: [200, 400, 401, 403, 500],
        handlers: stockMasterHandlers.search,
      },
      {
        method: 'get' as const,
        path: '/api/audit-events',
        operationId: 'listAuditEvents',
        tags: ['Activity Log'],
        summary: 'Who did what and when: the audit trail, filtered by date, user, area and text',
        security: 'bearerAuth' as const,
        parameters: [
          ...paginationParameters,
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'actorId', in: 'query', schema: { type: 'string' } },
          { name: 'module', in: 'query', schema: { type: 'string', maxLength: 60 } },
          { name: 'action', in: 'query', schema: { type: 'string', maxLength: 120 } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ],
        responses: [200, 400, 401, 403, 500],
        handlers: auditHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/audit-events/filters',
        operationId: 'listAuditEventFilters',
        tags: ['Activity Log'],
        summary:
          'The users, areas and actions that appear in the audit trail (for the filter boxes)',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: auditHandlers.filters,
      },
      {
        method: 'get' as const,
        path: '/api/reports',
        operationId: 'listReportTypes',
        tags: ['Reports'],
        summary: 'List the record types the signed-in user can pull reports for',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: reportHandlers.types,
      },
      {
        method: 'get' as const,
        path: '/api/reports/{type}',
        operationId: 'previewReport',
        tags: ['Reports'],
        summary: 'Preview report rows for a record type, date range and search text',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
          ...paginationParameters,
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ],
        responses: [200, 400, 401, 403, 404, 500],
        handlers: reportHandlers.preview,
      },
      {
        method: 'get' as const,
        path: '/api/reports/{type}/export',
        operationId: 'downloadReport',
        tags: ['Reports'],
        summary:
          'Download the report rows as a formatted Excel workbook (logged in the Activity log)',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ],
        responseContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        responses: [200, 400, 401, 403, 404, 500],
        handlers: reportHandlers.download,
      },
      {
        method: 'post' as const,
        path: '/api/revenue-dashboard/import',
        operationId: 'importRevenueWorkbook',
        tags: ['Revenue Dashboard'],
        summary:
          'Upload the master revenue (.xlsm) or budget (.xlsx) workbook (multipart/form-data: file, kind=revenue|budget)',
        security: 'bearerAuth' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.importWorkbook,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/batches',
        operationId: 'listRevenueImportBatches',
        tags: ['Revenue Dashboard'],
        summary: 'List workbook uploads and which one is active for each kind',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: revenueDashboardHandlers.batches,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/summary',
        operationId: 'getRevenueDashboardSummary',
        tags: ['Revenue Dashboard'],
        summary: 'Revenue KPIs, monthly trend and mixes from the active revenue upload',
        security: 'bearerAuth' as const,
        parameters: revenueFilterParameters,
        responses: [200, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.summary,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/lines',
        operationId: 'listRevenueDashboardLines',
        tags: ['Revenue Dashboard'],
        summary: 'Job-level revenue rows (explorer) from the active revenue upload',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat(revenueFilterParameters),
        responses: [200, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.lines,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/group',
        operationId: 'getRevenueDashboardGroup',
        tags: ['Revenue Dashboard'],
        summary: 'Revenue grouped by one dimension (drill-down level) under the given filters',
        security: 'bearerAuth' as const,
        parameters: [
          {
            name: 'dimension',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: revenueDimensionEnum },
          },
          ...revenueFilterParameters,
        ],
        responses: [200, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.group,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/matrix',
        operationId: 'getRevenueDashboardMatrix',
        tags: ['Revenue Dashboard'],
        summary: 'Two-way revenue pivot (for example month by job type)',
        security: 'bearerAuth' as const,
        parameters: [
          {
            name: 'rowDimension',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: revenueDimensionEnum },
          },
          {
            name: 'columnDimension',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: revenueDimensionEnum },
          },
          ...revenueFilterParameters,
        ],
        responses: [200, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.matrix,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/exceptions',
        operationId: 'getRevenueDashboardExceptions',
        tags: ['Revenue Dashboard'],
        summary: 'Finance / data-quality exception counts and revenue at stake',
        security: 'bearerAuth' as const,
        parameters: revenueFilterParameters,
        responses: [200, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.exceptions,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/export',
        operationId: 'exportRevenueDashboardReport',
        tags: ['Revenue Dashboard'],
        summary: 'Download the filtered revenue report as a formatted Excel workbook',
        security: 'bearerAuth' as const,
        parameters: revenueFilterParameters,
        responseContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        responses: [200, 400, 401, 403, 404, 500],
        handlers: revenueDashboardHandlers.exportWorkbook,
      },
      {
        method: 'post' as const,
        path: '/api/revenue-dashboard/activity',
        operationId: 'recordRevenueDashboardActivity',
        tags: ['Revenue Dashboard'],
        summary:
          'Log that the signed-in user viewed the dashboard, copied the summary or opened an email draft (query parameters, no body)',
        security: 'bearerAuth' as const,
        parameters: [
          {
            name: 'action',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['viewed', 'email_drafted', 'summary_copied'] },
          },
          { name: 'view', in: 'query', schema: { type: 'string', maxLength: 40 } },
          { name: 'period', in: 'query', schema: { type: 'string', maxLength: 120 } },
        ],
        responses: [204, 400, 401, 403, 500],
        handlers: revenueDashboardHandlers.activity,
      },
      {
        method: 'get' as const,
        path: '/api/revenue-dashboard/budget',
        operationId: 'getBudgetVsActual',
        tags: ['Revenue Dashboard'],
        summary: 'Monthly budget (P&L) with actual revenue from the active revenue upload',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: revenueDashboardHandlers.budget,
      },
      {
        method: 'post' as const,
        path: '/api/job-cards/{jobCardId}/attachments',
        operationId: 'uploadJobCardAttachment',
        tags: ['Service Job Cards'],
        summary: 'Upload a job-card attachment (photo or PDF, multipart/form-data)',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'jobCardId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [201, 400, 401, 403, 404, 500],
        handlers: attachmentHandlers.upload,
      },
      {
        method: 'get' as const,
        path: '/api/job-cards/{jobCardId}/attachments',
        operationId: 'listJobCardAttachments',
        tags: ['Service Job Cards'],
        summary: "List a job card's attachments, each with a short-lived signed download URL",
        security: 'bearerAuth' as const,
        parameters: [{ name: 'jobCardId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: attachmentHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/attachments/{id}/download',
        operationId: 'downloadAttachment',
        tags: ['Service Job Cards'],
        summary: 'Download an attachment via a short-lived signed URL (no bearer token needed)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'expires', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responseContentType: 'application/octet-stream',
        responses: [200, 404],
        handlers: attachmentHandlers.download,
      },
      {
        method: 'delete' as const,
        path: '/api/attachments/{id}',
        operationId: 'deleteJobCardAttachment',
        tags: ['Service Job Cards'],
        summary: 'Delete a job-card attachment',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [204, 401, 403, 404, 500],
        handlers: attachmentHandlers.remove,
      },
      {
        method: 'post' as const,
        path: '/api/warranty-approvals',
        operationId: 'createWarrantyApproval',
        tags: ['Warranty Approvals'],
        summary: 'Raise an out-of-warranty approval request against a job card or inspection',
        security: 'bearerAuth' as const,
        requestBody: 'warrantyApprovalCreate' as const,
        responses: [201, 400, 401, 403, 500],
        handlers: warrantyApprovalHandlers.create,
      },
      {
        method: 'get' as const,
        path: '/api/warranty-approvals',
        operationId: 'listWarrantyApprovals',
        tags: ['Warranty Approvals'],
        summary: 'List out-of-warranty approval requests',
        security: 'bearerAuth' as const,
        parameters: paginationParameters.concat([
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['Pending', 'Approved', 'Declined'] },
          },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 200 } },
        ]),
        responses: [200, 400, 401, 403, 500],
        handlers: warrantyApprovalHandlers.list,
      },
      {
        method: 'get' as const,
        path: '/api/warranty-approvals/{id}',
        operationId: 'getWarrantyApproval',
        tags: ['Warranty Approvals'],
        summary: 'Get an out-of-warranty approval request',
        security: 'bearerAuth' as const,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 401, 403, 404, 500],
        handlers: warrantyApprovalHandlers.detail,
      },
      {
        method: 'get' as const,
        path: '/api/public/warranty-approvals/{token}',
        operationId: 'getPublicWarrantyApproval',
        tags: ['Warranty Approvals'],
        summary:
          'View an out-of-warranty approval request via its customer-facing link (no bearer token needed)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 404],
        handlers: warrantyApprovalHandlers.publicDetail,
      },
      {
        method: 'post' as const,
        path: '/api/public/warranty-approvals/{token}/decision',
        operationId: 'decideWarrantyApproval',
        tags: ['Warranty Approvals'],
        summary:
          'Submit the customer decision for an out-of-warranty approval request (no bearer token needed)',
        requestBody: 'warrantyApprovalDecision' as const,
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: [200, 400, 404, 409, 500],
        handlers: warrantyApprovalHandlers.decide,
      },
      {
        method: 'get' as const,
        path: '/api/dashboard/summary',
        operationId: 'getDashboardSummary',
        tags: ['Dashboard'],
        summary:
          'Operational summary counts across complaints, appointments, job cards, quotations, inspections, and warranty approvals',
        security: 'bearerAuth' as const,
        responses: [200, 401, 403, 500],
        handlers: dashboardHandlers.summary,
      },
    ],
  ];

  return routes;
}

export function registerRoutes(app: Express, routes: RouteDefinition[]): void {
  for (const route of routes) {
    const expressPath = route.path.replaceAll(/\{([^}]+)\}/g, ':$1');
    app[route.method](expressPath, ...route.handlers);
  }
}
