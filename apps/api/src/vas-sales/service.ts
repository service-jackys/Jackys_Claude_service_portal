import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  vasSaleWriteSchema,
  vasSaleListQuerySchema,
  type VasSaleWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findVasSaleById,
  insertVasSale,
  listVasSales,
  type VasSaleContent,
} from '../../../../packages/db/src/vas-sales.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateVasSaleReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class VasSaleServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: VasSaleWriteInput): VasSaleContent {
  return {
    saleDate: input.saleDate ?? null,
    customerName: input.customerName ?? null,
    contactNumber: input.contactNumber ?? null,
    address: input.address ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    purchaseDate: input.purchaseDate ?? null,
    itemCode: input.itemCode ?? null,
    itemDescription: input.itemDescription ?? null,
    planKey: input.planKey,
    vasProduct: input.vasProduct,
    sellingPrice: input.sellingPrice,
    planFee: input.planFee,
    deductible: input.deductible ?? 0,
    serviceFeeText: input.serviceFeeText ?? null,
    contractRef: input.contractRef ?? null,
  };
}

export function createVasSaleService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = vasSaleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.saleDate ?? new Date().toISOString().slice(0, 10);
      const vasSaleReference = await allocateVasSaleReference(client, scopeDate);
      const vasSale = await insertVasSale(client, {
        vasSaleReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'vas_sale.created',
        targetType: 'vas_sale',
        targetId: vasSale.id,
        metadata: { vasSaleReference: vasSale.vasSaleReference, planKey: vasSale.planKey },
        requestId,
      });
      return vasSale;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = vasSaleListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listVasSales(client, {
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
      const vasSale = await findVasSaleById(client, id);
      if (!vasSale) throw new VasSaleServiceError('not-found', 'The VAS sale was not found.');
      return vasSale;
    } finally {
      client.release();
    }
  }

  return { create, list, detail };
}

export type VasSaleService = ReturnType<typeof createVasSaleService>;
