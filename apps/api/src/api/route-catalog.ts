import type { Express, RequestHandler } from 'express';
import { createDbPool } from '../../../../packages/db/src/client.js';
import { ensureLocalAdminProfile } from '../../../../packages/db/src/profiles.js';
import { problem } from './problem.js';
import type { AuthUser, LocalAuth } from '../auth/local-auth.js';
import { createApplicationAuth } from '../auth/application-auth.js';
import { createComplaintHandlers } from '../complaints/routes.js';
import { createComplaintService } from '../complaints/service.js';
import { createLocalComplaintRateLimiter } from '../complaints/rate-limit.js';
import { createCustomerHandlers } from '../customers/routes.js';
import { createCustomerService } from '../customers/service.js';
import { createBranchHandlers } from '../branches/routes.js';
import { createBranchService } from '../branches/service.js';
import { createTechnicianHandlers } from '../technicians/routes.js';
import { createTechnicianService } from '../technicians/service.js';
import { createAppointmentHandlers } from '../appointments/routes.js';
import { createAppointmentService } from '../appointments/service.js';
import { createScheduleHandlers } from '../schedules/routes.js';
import { createScheduleService } from '../schedules/service.js';
import { createServiceJobCardHandlers } from '../job-cards/routes.js';
import { createServiceJobCardService } from '../job-cards/service.js';

export type RouteDefinition = {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  operationId: string;
  tags: string[];
  summary: string;
  security?: 'bearerAuth' | 'optionalBearerAuth';
  requestBody?:
    | 'bootstrap'
    | 'login'
    | 'publicComplaint'
    | 'complaintNotes'
    | 'complaintStatus'
    | 'customer'
    | 'branch'
    | 'technician'
    | 'availability'
    | 'appointment'
    | 'appointmentAssignment'
    | 'appointmentSchedule'
    | 'appointmentStatus'
    | 'draftSchedule'
    | 'serviceJobCardStatus';
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

export function createRouteCatalog(localAuth: LocalAuth | null): RouteDefinition[] {
  const databaseUrl = process.env.DATABASE_URL;
  const pool = databaseUrl ? createDbPool(databaseUrl) : null;
  const requirePermission = pool
    ? createApplicationAuth(pool, localAuth).requirePermission
    : (_permission: string) =>
        (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => {
          providerUnavailable(response);
        };
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
        create: [
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
  const scheduleHandlers = pool
    ? createScheduleHandlers(createScheduleService(pool), requirePermission)
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
        promote: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
        cancel: [
          (_request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) =>
            providerUnavailable(response),
        ],
      };
  const routes: RouteDefinition[] = [
    {
      method: 'get',
      path: '/',
      operationId: 'getRoot',
      tags: ['System'],
      summary: 'Get service metadata',
      responses: [200],
      handlers: [
        (_request, response) => {
          response.json({
            name: "Jacky's Service Portal API",
            version: appVersion,
            status: 'ok',
            links: { api: '/api', health: '/health' },
          });
        },
      ],
    },
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
                'Local bootstrap has already been consumed for this process.',
              );
              return;
            }
            if (pool) {
              await ensureLocalAdminProfile(pool, result.user.email, result.user.name);
            }
            response.status(201).json({ token: result.token, user: result.user });
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
              problem(
                response,
                401,
                'invalid-credentials',
                'Unauthorized',
                'The email or password is incorrect.',
              );
              return;
            }
            response.json({ token: result.token, user: result.user });
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
        (request, response, next) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          localAuth.requireAuth(request, response, next);
        },
        (_request, response) => {
          response.json({ user: response.locals.auth.user as AuthUser });
        },
      ],
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
        (request, response) => {
          if (!localAuth) {
            providerUnavailable(response);
            return;
          }
          const authorization = request.header('authorization');
          const token = authorization?.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length).trim()
            : undefined;
          if (token) localAuth.revokeToken(token);
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
          {
            name: 'availableTime',
            in: 'query',
            schema: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
          },
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
        method: 'post' as const,
        path: '/api/appointments/{appointmentId}/job-card',
        operationId: 'createServiceJobCard',
        tags: ['Service Job Cards'],
        summary: 'Create a service job card for an appointment',
        security: 'bearerAuth' as const,
        parameters: [
          { name: 'appointmentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: [201, 401, 403, 404, 409, 500],
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
