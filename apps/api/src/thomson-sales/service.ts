import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  thomsonSaleWriteSchema,
  thomsonSaleListQuerySchema,
  thomsonSaleStatusSchema,
  type ThomsonSaleWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  changeThomsonSaleStatus,
  findThomsonSaleById,
  insertThomsonSale,
  listThomsonSales,
  type ThomsonSaleContent,
} from '../../../../packages/db/src/thomson-sales.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateThomsonSaleReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class ThomsonSaleServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: ThomsonSaleWriteInput): ThomsonSaleContent {
  return {
    saleDate: input.saleDate ?? null,
    clientName: input.clientName ?? null,
    contactNumber: input.contactNumber ?? null,
    siteLocation: input.siteLocation ?? null,
    transportSharePercent: input.transportSharePercent,
    lineItems: input.lineItems,
    totalPrice: input.totalPrice,
    totalCost: input.totalCost,
    margin: input.margin,
    contractRef: input.contractRef ?? null,
    schedule: input.schedule ?? null,
  };
}

export function createThomsonSaleService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = thomsonSaleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.saleDate ?? new Date().toISOString().slice(0, 10);
      const thomsonSaleReference = await allocateThomsonSaleReference(client, scopeDate);
      const thomsonSale = await insertThomsonSale(client, {
        thomsonSaleReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'thomson_sale.created',
        targetType: 'thomson_sale',
        targetId: thomsonSale.id,
        metadata: {
          thomsonSaleReference: thomsonSale.thomsonSaleReference,
          totalPrice: thomsonSale.totalPrice,
        },
        requestId,
      });
      return thomsonSale;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = thomsonSaleListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listThomsonSales(client, {
        search: data.search,
        status: data.status,
        page: data.page,
        pageSize: data.pageSize,
      });
    } finally {
      client.release();
    }
  }

  async function detail(id: string) {
    const client = await pool.connect();
    try {
      const thomsonSale = await findThomsonSaleById(client, id);
      if (!thomsonSale)
        throw new ThomsonSaleServiceError('not-found', 'The Thomson sale was not found.');
      return thomsonSale;
    } finally {
      client.release();
    }
  }

  async function setStatus(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const change = thomsonSaleStatusSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const result = await changeThomsonSaleStatus(
        client,
        id,
        change.status === 'Sold'
          ? { status: 'Sold', soldDate: change.soldDate }
          : change.status === 'Lost'
            ? { status: 'Lost', reason: change.reason ?? null }
            : { status: 'Quote' },
        profileId,
      );
      if (result === null)
        throw new ThomsonSaleServiceError('not-found', 'The Thomson sale was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'thomson_sale.status_changed',
        targetType: 'thomson_sale',
        targetId: result.id,
        metadata: {
          thomsonSaleReference: result.thomsonSaleReference,
          status: result.status,
          soldDate: result.soldDate,
        },
        requestId,
      });
      return result;
    });
  }

  return { create, list, detail, setStatus };
}

export type ThomsonSaleService = ReturnType<typeof createThomsonSaleService>;
