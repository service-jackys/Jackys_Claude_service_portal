import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  rateCardSaleWriteSchema,
  rateCardSaleListQuerySchema,
  type RateCardSaleWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findRateCardSaleById,
  insertRateCardSale,
  listRateCardSales,
  type RateCardSaleContent,
} from '../../../../packages/db/src/rate-card-sales.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateRateCardSaleReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class RateCardSaleServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: RateCardSaleWriteInput): RateCardSaleContent {
  return {
    saleDate: input.saleDate ?? null,
    clientName: input.clientName ?? null,
    contactNumber: input.contactNumber ?? null,
    siteLocation: input.siteLocation ?? null,
    lineItems: input.lineItems,
    totalValue: input.totalValue,
    contractRef: input.contractRef ?? null,
  };
}

export function createRateCardSaleService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = rateCardSaleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.saleDate ?? new Date().toISOString().slice(0, 10);
      const rateCardSaleReference = await allocateRateCardSaleReference(client, scopeDate);
      const rateCardSale = await insertRateCardSale(client, {
        rateCardSaleReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'rate_card_sale.created',
        targetType: 'rate_card_sale',
        targetId: rateCardSale.id,
        metadata: {
          rateCardSaleReference: rateCardSale.rateCardSaleReference,
          totalValue: rateCardSale.totalValue,
        },
        requestId,
      });
      return rateCardSale;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = rateCardSaleListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listRateCardSales(client, {
        search: data.search,
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
      const rateCardSale = await findRateCardSaleById(client, id);
      if (!rateCardSale)
        throw new RateCardSaleServiceError('not-found', 'The Rate Card sale was not found.');
      return rateCardSale;
    } finally {
      client.release();
    }
  }

  return { create, list, detail };
}

export type RateCardSaleService = ReturnType<typeof createRateCardSaleService>;
