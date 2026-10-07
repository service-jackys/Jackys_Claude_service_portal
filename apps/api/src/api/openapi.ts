import type { RouteDefinition } from './route-catalog.js';

const problemResponse = {
  description: 'RFC 7807-style error response',
  content: {
    'application/problem+json': {
      schema: { $ref: '#/components/schemas/Problem' },
    },
  },
};

const responseDefinitions: Record<number, object> = {
  200: { description: 'Successful response' },
  201: { description: 'Resource created' },
  204: { description: 'No content' },
  400: problemResponse,
  401: problemResponse,
  403: problemResponse,
  404: problemResponse,
  409: problemResponse,
  422: problemResponse,
  429: { ...problemResponse, headers: { 'Retry-After': { schema: { type: 'integer' } } } },
  500: problemResponse,
  501: problemResponse,
};

const requestBodies = {
  bootstrap: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/BootstrapRequest' },
      },
    },
  },
  login: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/LoginRequest' },
      },
    },
  },
  staffUser: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/StaffUserRequest' },
      },
    },
  },
  changePassword: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ChangePasswordRequest' },
      },
    },
  },
  budgetVarianceConfig: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  },
  budgetVersionCreate: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  },
  budgetVersionUpdate: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  },
  rolePermissions: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/RolePermissionsRequest' },
      },
    },
  },
  updateStaffUser: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/UpdateStaffUserRequest' },
      },
    },
  },
  publicComplaint: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/PublicComplaintRequest' },
      },
    },
  },
  complaintNotes: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ComplaintNotesRequest' },
      },
    },
  },
  complaintStatus: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ComplaintStatusRequest' },
      },
    },
  },
  b2bBranchLink: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/B2bBranchLinkRequest' },
      },
    },
  },
  customer: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/CustomerRequest' },
      },
    },
  },
  branch: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/BranchRequest' },
      },
    },
  },
  technician: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/TechnicianRequest' },
      },
    },
  },
  salesman: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/SalesmanRequest' },
      },
    },
  },
  salesChannel: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/SalesChannelRequest' },
      },
    },
  },
  availability: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AvailabilityRequest' },
      },
    },
  },
  appointment: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentRequest' },
      },
    },
  },
  appointmentAssignment: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentAssignmentRequest' },
      },
    },
  },
  appointmentSchedule: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentScheduleRequest' },
      },
    },
  },
  appointmentStatus: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentStatusRequest' },
      },
    },
  },
  serviceJobCardCreate: {
    required: false,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ServiceJobCardCreateRequest' },
      },
    },
  },
  serviceJobCardUpdate: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ServiceJobCardUpdateRequest' },
      },
    },
  },
  serviceJobCardStatus: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ServiceJobCardStatusRequest' },
      },
    },
  },
  draftSchedule: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/DraftScheduleRequest' },
      },
    },
  },
  quotation: {
    required: false,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/QuotationRequest' },
      },
    },
  },
  inspection: {
    required: false,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/InspectionRequest' },
      },
    },
  },
  vasSale: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/VasSaleRequest' },
      },
    },
  },
  amcContract: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AmcContractRequest' },
      },
    },
  },
  rateCardSale: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/RateCardSaleRequest' },
      },
    },
  },
  thomsonSale: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ThomsonSaleRequest' },
      },
    },
  },
  warrantyApprovalCreate: {
    required: false,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/WarrantyApprovalCreateRequest' },
      },
    },
  },
  warrantyApprovalDecision: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/WarrantyApprovalDecisionRequest' },
      },
    },
  },
};

export function createOpenApiDocument(routes: RouteDefinition[]) {
  const paths: Record<string, Record<string, object>> = {};

  for (const route of routes) {
    const responses: Record<string, object> = {};
    for (const status of route.responses) {
      responses[String(status)] = responseDefinitions[status];
    }
    if (route.responseContentType) {
      responses['200'] = {
        description: 'Successful response',
        content: { [route.responseContentType]: { schema: { type: 'string' } } },
      };
    }

    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      tags: route.tags,
      summary: route.summary,
      responses,
    };
    if (route.security === 'bearerAuth') operation.security = [{ bearerAuth: [] }];
    if (route.security === 'optionalBearerAuth') operation.security = [{}, { bearerAuth: [] }];
    if (route.requestBody) operation.requestBody = requestBodies[route.requestBody];
    if (route.parameters) operation.parameters = route.parameters;

    paths[route.path] ??= {};
    paths[route.path][route.method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: "Jacky's Service Portal API",
      version: '0.1.0',
      description: 'Local development contract for the service portal migration API.',
    },
    servers: [{ url: '/', description: 'Current host' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Opaque session token',
        },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'detail'],
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            status: { type: 'integer', minimum: 400, maximum: 599 },
            detail: { type: 'string' },
          },
        },
        AuthUser: {
          type: 'object',
          required: ['id', 'email', 'name', 'role', 'permissions', 'active'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['user', 'sales', 'management', 'admin'] },
            permissions: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
          },
        },
        AuthSession: {
          type: 'object',
          required: ['token', 'user'],
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/AuthUser' },
          },
        },
        BootstrapRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['bootstrapToken', 'email', 'name', 'password'],
          properties: {
            bootstrapToken: { type: 'string', minLength: 32, maxLength: 256 },
            email: { type: 'string', format: 'email', maxLength: 320 },
            name: { type: 'string', minLength: 1, maxLength: 120 },
            password: { type: 'string', minLength: 12, maxLength: 200 },
          },
        },
        LoginRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        StaffUserRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'name', 'password', 'role'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            name: { type: 'string', minLength: 1, maxLength: 120 },
            password: { type: 'string', minLength: 12, maxLength: 200 },
            role: { type: 'string', enum: ['user', 'sales', 'management', 'admin'] },
          },
        },
        UpdateStaffUserRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['user', 'sales', 'management', 'admin'] },
            active: { type: 'boolean' },
            password: { type: 'string', minLength: 12, maxLength: 200 },
          },
        },
        ChangePasswordRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
            newPassword: { type: 'string', minLength: 12, maxLength: 200 },
          },
        },
        RolePermissionsRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['permissions'],
          properties: {
            permissions: { type: 'array', items: { type: 'string' }, maxItems: 200 },
          },
        },
        PublicComplaintRequest: {
          type: 'object',
          additionalProperties: false,
          // contactNumber is required by default, optional only for a B2B
          // submission -- see
          // publicComplaintSchema's superRefine in packages/contracts
          // (modification.md #1). Not expressible as a plain top-level
          // `required` entry, so it's left optional here and enforced by
          // the Zod schema at request time.
          required: ['customerType', 'customerName', 'description'],
          properties: {
            customerType: { type: 'string', enum: ['B2C', 'B2B', 'B2B-SalesChannel'] },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            customerEmail: { type: 'string', format: 'email', maxLength: 320 },
            address: { type: 'string', minLength: 1, maxLength: 500 },
            region: { type: 'string', minLength: 1, maxLength: 120 },
            brand: { type: 'string', minLength: 1, maxLength: 120 },
            model: { type: 'string', minLength: 1, maxLength: 120 },
            serialOrItemCode: { type: 'string', minLength: 1, maxLength: 120 },
            description: { type: 'string', minLength: 1, maxLength: 10000 },
            b2bBranchSchool: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactPerson: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerNumber: { type: 'string', minLength: 1, maxLength: 100 },
            salesOrderNumber: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        B2bBranchLinkRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['custCode'],
          properties: {
            custCode: {
              type: 'string',
              pattern: '^\\d+$',
              maxLength: 40,
              nullable: true,
              description: 'Cust_Code from the b2b_branches master list, or null to unlink.',
            },
          },
        },
        ComplaintNotesRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            notes: { type: 'string', minLength: 1, maxLength: 10000 },
            warrantyClassification: { type: 'string', enum: ['', 'In Warranty', 'Out Warranty'] },
          },
        },
        ComplaintStatusRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: [
                'New',
                'Under Review',
                'Pending Information',
                'Ready for Scheduling',
                'Scheduled',
                'Closed',
                'Cancelled',
              ],
            },
            reason: { type: 'string', maxLength: 1000 },
          },
        },
        CustomerRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['customerType', 'name', 'contactNumber'],
          properties: {
            customerType: { type: 'string', enum: ['B2C', 'B2B', 'B2B-SalesChannel'] },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            email: { type: 'string', format: 'email', maxLength: 320 },
            address: { type: 'string', minLength: 1, maxLength: 500 },
            region: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        BranchRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            customerId: { type: 'string', pattern: '^\\d+$' },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            contactPerson: { type: 'string', minLength: 1, maxLength: 120 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            address: { type: 'string', minLength: 1, maxLength: 500 },
            region: { type: 'string', minLength: 1, maxLength: 120 },
            customerNumber: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        TechnicianRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            region: { type: 'string', minLength: 1, maxLength: 120 },
            phone: { type: 'string', minLength: 1, maxLength: 50 },
            email: { type: 'string', format: 'email', maxLength: 320 },
            active: { type: 'boolean' },
            maxAppointmentsPerDay: { type: 'integer', minimum: 1, maximum: 999 },
          },
        },
        SalesmanRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            active: { type: 'boolean' },
          },
        },
        SalesChannelRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            active: { type: 'boolean' },
          },
        },
        AvailabilityRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['windows'],
          properties: {
            windows: {
              type: 'array',
              maxItems: 7,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['weekday', 'startsAt', 'endsAt'],
                properties: {
                  weekday: { type: 'integer', minimum: 0, maximum: 6 },
                  startsAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
                  endsAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
                },
              },
            },
          },
        },
        AppointmentRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['appointmentDate'],
          properties: {
            complaintId: { type: 'string', pattern: '^\\d+$' },
            customerId: { type: 'string', pattern: '^\\d+$' },
            branchId: { type: 'string', pattern: '^\\d+$' },
            technicianId: { type: 'string', pattern: '^\\d+$' },
            customerType: { type: 'string', enum: ['B2C', 'B2B', 'B2B-SalesChannel'] },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            customerEmail: { type: 'string', format: 'email', maxLength: 320 },
            address: { type: 'string', minLength: 1, maxLength: 500 },
            region: { type: 'string', minLength: 1, maxLength: 120 },
            brand: { type: 'string', minLength: 1, maxLength: 120 },
            model: { type: 'string', minLength: 1, maxLength: 120 },
            itemCode: { type: 'string', minLength: 1, maxLength: 120 },
            faultDescription: { type: 'string', minLength: 1, maxLength: 10000 },
            jobWarranty: { type: 'string', minLength: 1, maxLength: 120 },
            salesOrderNumber: { type: 'string', minLength: 1, maxLength: 120 },
            b2bBranchSchool: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactPerson: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerNumber: { type: 'string', minLength: 1, maxLength: 100 },
            subGroup: { type: 'string', minLength: 1, maxLength: 120 },
            salesman: { type: 'string', minLength: 1, maxLength: 200 },
            appointmentDate: { type: 'string', format: 'date' },
          },
        },
        AppointmentAssignmentRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['technicianId'],
          properties: { technicianId: { type: ['string', 'null'], pattern: '^\\d+$' } },
        },
        AppointmentScheduleRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['appointmentDate'],
          properties: {
            appointmentDate: { type: 'string', format: 'date' },
          },
        },
        AppointmentStatusRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['Scheduled', 'In Progress', 'Completed', 'Cancelled'],
            },
            reason: { type: 'string', maxLength: 1000 },
          },
        },
        ServiceJobCardCreateRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobCardDate: { type: 'string', format: 'date' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            customerContact: { type: 'string', minLength: 1, maxLength: 50 },
            customerAddress: { type: 'string', minLength: 1, maxLength: 500 },
            itemDescription: { type: 'string', minLength: 1, maxLength: 300 },
            modelNo: { type: 'string', minLength: 1, maxLength: 120 },
            warrantyStatus: { type: 'string', minLength: 1, maxLength: 50 },
            complaint: { type: 'string', minLength: 1, maxLength: 10000 },
            serviceRendered: { type: 'string', minLength: 1, maxLength: 10000 },
            periodFrom: { type: 'string', minLength: 1, maxLength: 40 },
            periodTo: { type: 'string', minLength: 1, maxLength: 40 },
            parts: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            serviceCharge: { type: 'number', minimum: 0, maximum: 10000000 },
            amountChargeable: { type: 'number', minimum: 0, maximum: 10000000 },
            invoiceNo: { type: 'string', minLength: 1, maxLength: 120 },
            deliveryDate: { type: 'string', format: 'date' },
            technicianName: { type: 'string', minLength: 1, maxLength: 120 },
            brand: { type: 'string', minLength: 1, maxLength: 120 },
            salesman: { type: 'string', minLength: 1, maxLength: 200 },
            salesChannel: { type: 'string', minLength: 1, maxLength: 200 },
            jobFinalStatus: {
              type: 'string',
              enum: [
                'WIP',
                'Spare pending',
                'BER',
                'Rejected',
                'Repair Completed',
                'Delivered',
                'Cancelled',
              ],
            },
            schoolContactPerson: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerType: { type: 'string', enum: ['B2C', 'B2B'] },
            customerEmail: { type: 'string', minLength: 1, maxLength: 320 },
            region: { type: 'string', minLength: 1, maxLength: 80 },
            b2bBranchSchool: { type: 'string', minLength: 1, maxLength: 300 },
            salesOrderNumber: { type: 'string', minLength: 1, maxLength: 100 },
            legacyReference: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        ServiceJobCardUpdateRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobCardDate: { type: 'string', format: 'date' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            customerContact: { type: 'string', minLength: 1, maxLength: 50 },
            customerAddress: { type: 'string', minLength: 1, maxLength: 500 },
            itemDescription: { type: 'string', minLength: 1, maxLength: 300 },
            modelNo: { type: 'string', minLength: 1, maxLength: 120 },
            warrantyStatus: { type: 'string', minLength: 1, maxLength: 50 },
            complaint: { type: 'string', minLength: 1, maxLength: 10000 },
            serviceRendered: { type: 'string', minLength: 1, maxLength: 10000 },
            periodFrom: { type: 'string', minLength: 1, maxLength: 40 },
            periodTo: { type: 'string', minLength: 1, maxLength: 40 },
            parts: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            serviceCharge: { type: 'number', minimum: 0, maximum: 10000000 },
            amountChargeable: { type: 'number', minimum: 0, maximum: 10000000 },
            invoiceNo: { type: 'string', minLength: 1, maxLength: 120 },
            deliveryDate: { type: 'string', format: 'date' },
            technicianName: { type: 'string', minLength: 1, maxLength: 120 },
            brand: { type: 'string', minLength: 1, maxLength: 120 },
            salesman: { type: 'string', minLength: 1, maxLength: 200 },
            salesChannel: { type: 'string', minLength: 1, maxLength: 200 },
            jobFinalStatus: {
              type: 'string',
              enum: [
                'WIP',
                'Spare pending',
                'BER',
                'Rejected',
                'Repair Completed',
                'Delivered',
                'Cancelled',
              ],
            },
            schoolContactPerson: { type: 'string', minLength: 1, maxLength: 500 },
            schoolContactNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerNumber: { type: 'string', minLength: 1, maxLength: 100 },
            customerType: { type: 'string', enum: ['B2C', 'B2B'] },
            customerEmail: { type: 'string', minLength: 1, maxLength: 320 },
            region: { type: 'string', minLength: 1, maxLength: 80 },
            b2bBranchSchool: { type: 'string', minLength: 1, maxLength: 300 },
            salesOrderNumber: { type: 'string', minLength: 1, maxLength: 100 },
            legacyReference: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        ServiceJobCardStatusRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['Open', 'In Progress', 'Completed', 'Cancelled'],
            },
            reason: { type: 'string', maxLength: 1000 },
          },
        },
        DraftScheduleRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['complaintId', 'appointmentDate', 'appointmentTime'],
                properties: {
                  complaintId: { type: 'string', pattern: '^\\d+$' },
                  technicianId: { type: 'string', pattern: '^\\d+$' },
                  appointmentDate: { type: 'string', format: 'date' },
                  appointmentTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
                },
              },
            },
          },
        },
        QuotationRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            appointmentId: { type: 'string', pattern: '^\\d+$' },
            quotationDate: { type: 'string', format: 'date' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            projectName: { type: 'string', minLength: 1, maxLength: 200 },
            siteLocation: { type: 'string', minLength: 1, maxLength: 500 },
            dateOfCollection: { type: 'string', format: 'date' },
            technicianName: { type: 'string', minLength: 1, maxLength: 120 },
            customerComplaint: { type: 'string', minLength: 1, maxLength: 10000 },
            technicalDiagnosis: { type: 'string', minLength: 1, maxLength: 10000 },
            products: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            parts: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            labourAmount: { type: 'number', minimum: 0, maximum: 10000000 },
            preparedBy: { type: 'string', minLength: 1, maxLength: 120 },
            preparedDate: { type: 'string', format: 'date' },
            approvedBy: { type: 'string', minLength: 1, maxLength: 120 },
            approvedDate: { type: 'string', format: 'date' },
            customerSignature: { type: 'string', minLength: 1, maxLength: 200 },
            signatureDate: { type: 'string', format: 'date' },
            legacyReference: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        InspectionRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            appointmentId: { type: 'string', pattern: '^\\d+$' },
            inspectionDate: { type: 'string', format: 'date' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            projectName: { type: 'string', minLength: 1, maxLength: 200 },
            siteLocation: { type: 'string', minLength: 1, maxLength: 500 },
            dateOfCollection: { type: 'string', format: 'date' },
            technicianName: { type: 'string', minLength: 1, maxLength: 120 },
            customerComplaint: { type: 'string', minLength: 1, maxLength: 10000 },
            visualFindings: { type: 'string', minLength: 1, maxLength: 10000 },
            technicalDiagnosis: { type: 'string', minLength: 1, maxLength: 10000 },
            products: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            faultyParts: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  partNo: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 300 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  unitPrice: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            recommendedAction: { type: 'string', minLength: 1, maxLength: 10000 },
            refQuotationNo: { type: 'string', minLength: 1, maxLength: 120 },
            warrantyStatus: { type: 'string', minLength: 1, maxLength: 50 },
            estRepairCost: { type: 'number', minimum: 0, maximum: 10000000 },
            inspectedBy: { type: 'string', minLength: 1, maxLength: 120 },
            inspectedDate: { type: 'string', format: 'date' },
            reviewedBy: { type: 'string', minLength: 1, maxLength: 120 },
            reviewedDate: { type: 'string', format: 'date' },
            customerSignature: { type: 'string', minLength: 1, maxLength: 200 },
            signatureDate: { type: 'string', format: 'date' },
            legacyReference: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        VasSaleRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['planKey', 'vasProduct', 'sellingPrice', 'planFee'],
          properties: {
            saleDate: { type: 'string', format: 'date' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            address: { type: 'string', minLength: 1, maxLength: 500 },
            invoiceNumber: { type: 'string', minLength: 1, maxLength: 120 },
            purchaseDate: { type: 'string', format: 'date' },
            itemCode: { type: 'string', minLength: 1, maxLength: 120 },
            itemDescription: { type: 'string', minLength: 1, maxLength: 300 },
            planKey: { type: 'string', enum: ['ew1', 'ew2', 'di1', 'premium'] },
            vasProduct: { type: 'string', minLength: 1, maxLength: 200 },
            sellingPrice: { type: 'number', minimum: 0, maximum: 10000000 },
            planFee: { type: 'number', minimum: 0, maximum: 10000000 },
            deductible: { type: 'number', minimum: 0, maximum: 10000000 },
            serviceFeeText: { type: 'string', minLength: 1, maxLength: 300 },
            contractRef: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        AmcContractRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['appliances', 'totalCount', 'totalValue', 'plans'],
          properties: {
            contractDate: { type: 'string', format: 'date' },
            contractPeriod: { type: 'string', minLength: 1, maxLength: 50 },
            clientName: { type: 'string', minLength: 1, maxLength: 200 },
            attentionTo: { type: 'string', minLength: 1, maxLength: 200 },
            siteLocation: { type: 'string', minLength: 1, maxLength: 500 },
            appliances: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'qty', 'price'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 200 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  price: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            totalCount: { type: 'number', minimum: 0, maximum: 100000 },
            totalValue: { type: 'number', minimum: 0, maximum: 100000000 },
            // All 3 computed plans for this contract's appliance schedule
            // (modification.md #39) -- no plan is chosen at save time; the
            // plan to print is picked afterwards, per print.
            plans: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'planKey',
                  'planLabel',
                  'annualVisits',
                  'laborCost',
                  'transportCost',
                  'partsReserve',
                  'directCost',
                  'overhead',
                  'priceExclVat',
                  'priceInclVat',
                ],
                properties: {
                  planKey: { type: 'string', enum: ['basic-rm', 'standard-pmc', 'premium-pmc'] },
                  planLabel: { type: 'string', minLength: 1, maxLength: 100 },
                  coverage: { type: 'string', minLength: 1, maxLength: 200 },
                  coverageDetail: { type: 'string', minLength: 1, maxLength: 300 },
                  included: { type: 'string', minLength: 1, maxLength: 600 },
                  notIncluded: { type: 'string', minLength: 1, maxLength: 600 },
                  visitsText: { type: 'string', minLength: 1, maxLength: 100 },
                  annualVisits: { type: 'number', minimum: 0, maximum: 1000 },
                  laborCost: { type: 'number', minimum: 0, maximum: 10000000 },
                  transportCost: { type: 'number', minimum: 0, maximum: 10000000 },
                  partsReserve: { type: 'number', minimum: 0, maximum: 10000000 },
                  directCost: { type: 'number', minimum: 0, maximum: 10000000 },
                  overhead: { type: 'number', minimum: 0, maximum: 10000000 },
                  priceExclVat: { type: 'number', minimum: 0, maximum: 10000000 },
                  priceInclVat: { type: 'number', minimum: 0, maximum: 10000000 },
                },
              },
            },
            commencementDate: { type: 'string', format: 'date' },
            contractRef: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        RateCardSaleRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['lineItems', 'totalValue'],
          properties: {
            saleDate: { type: 'string', format: 'date' },
            clientName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            siteLocation: { type: 'string', minLength: 1, maxLength: 500 },
            lineItems: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['sectionLabel', 'activityName', 'rate', 'qty'],
                properties: {
                  sectionLabel: { type: 'string', minLength: 1, maxLength: 200 },
                  activityName: { type: 'string', minLength: 1, maxLength: 200 },
                  rate: { type: 'number', minimum: 0, maximum: 10000000 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                },
              },
            },
            totalValue: { type: 'number', minimum: 0, maximum: 100000000 },
            contractRef: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        ThomsonSaleRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['transportSharePercent', 'lineItems', 'totalPrice', 'totalCost', 'margin'],
          properties: {
            saleDate: { type: 'string', format: 'date' },
            clientName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            siteLocation: { type: 'string', minLength: 1, maxLength: 500 },
            transportSharePercent: { type: 'number', minimum: 0, maximum: 100 },
            lineItems: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'region',
                  'applianceName',
                  'qty',
                  'siteVisits',
                  'trainingSessions',
                  'unitRate',
                  'applianceSubtotal',
                  'addonRevenue',
                  'transportCost',
                  'totalPrice',
                  'totalCost',
                  'margin',
                ],
                properties: {
                  region: { type: 'string', minLength: 1, maxLength: 100 },
                  applianceName: { type: 'string', minLength: 1, maxLength: 200 },
                  qty: { type: 'number', minimum: 0, maximum: 100000 },
                  siteVisits: { type: 'number', minimum: 0, maximum: 1000 },
                  trainingSessions: { type: 'number', minimum: 0, maximum: 1000 },
                  unitRate: { type: 'number', minimum: 0, maximum: 10000000 },
                  applianceSubtotal: { type: 'number', minimum: 0, maximum: 100000000 },
                  addonRevenue: { type: 'number', minimum: 0, maximum: 100000000 },
                  transportCost: { type: 'number', minimum: 0, maximum: 100000000 },
                  totalPrice: { type: 'number', minimum: 0, maximum: 100000000 },
                  totalCost: { type: 'number', minimum: 0, maximum: 100000000 },
                  margin: { type: 'number', minimum: -100000000, maximum: 100000000 },
                },
              },
            },
            totalPrice: { type: 'number', minimum: 0, maximum: 100000000 },
            totalCost: { type: 'number', minimum: 0, maximum: 100000000 },
            margin: { type: 'number', minimum: -100000000, maximum: 100000000 },
            contractRef: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        WarrantyApprovalCreateRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobCardId: { type: 'string', pattern: '^\\d+$' },
            inspectionId: { type: 'string', pattern: '^\\d+$' },
            customerName: { type: 'string', minLength: 1, maxLength: 200 },
            contactNumber: { type: 'string', minLength: 1, maxLength: 50 },
            itemDescription: { type: 'string', minLength: 1, maxLength: 300 },
            warrantyStatus: { type: 'string', minLength: 1, maxLength: 50 },
            estimatedCost: { type: 'number', minimum: 0, maximum: 10000000 },
            notes: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
        WarrantyApprovalDecisionRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'decidedByName'],
          properties: {
            decision: { type: 'string', enum: ['Approved', 'Declined'] },
            decidedByName: { type: 'string', minLength: 1, maxLength: 200 },
            decisionNotes: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
        Complaint: {
          type: 'object',
          required: [
            'id',
            'complaintReference',
            'customerType',
            'customerName',
            'contactNumber',
            'description',
            'status',
          ],
          properties: {
            id: { type: 'string' },
            complaintReference: { type: 'string', pattern: '^CMP-[0-9]{6}-[0-9]{3}$' },
            customerType: { type: 'string' },
            customerName: { type: 'string' },
            contactNumber: { type: 'string' },
            customerEmail: { type: ['string', 'null'], format: 'email' },
            address: { type: ['string', 'null'] },
            region: { type: ['string', 'null'] },
            brand: { type: ['string', 'null'] },
            model: { type: ['string', 'null'] },
            serialOrItemCode: { type: ['string', 'null'] },
            description: { type: 'string' },
            salesOrderNumber: { type: ['string', 'null'] },
            b2bBranchSchool: { type: ['string', 'null'] },
            schoolContactPerson: { type: ['string', 'null'] },
            schoolContactNumber: { type: ['string', 'null'] },
            customerNumber: { type: ['string', 'null'] },
            warrantyClassification: { type: ['string', 'null'] },
            status: {
              type: 'string',
              enum: [
                'New',
                'Under Review',
                'Pending Information',
                'Ready for Scheduling',
                'Scheduled',
                'Closed',
                'Cancelled',
              ],
            },
            cceNotes: { type: ['string', 'null'] },
            submittedAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            updatedBy: { type: ['string', 'null'] },
          },
        },
        ServiceMetadata: {
          type: 'object',
          required: ['name', 'version', 'status', 'links'],
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string', enum: ['ok'] },
            links: {
              type: 'object',
              required: ['api', 'health'],
              properties: {
                api: { type: 'string' },
                health: { type: 'string' },
              },
            },
          },
        },
        Health: {
          type: 'object',
          required: ['status', 'service', 'version', 'timestamp'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            service: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
}
