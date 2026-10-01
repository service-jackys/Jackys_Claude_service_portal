import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  amcContractWriteSchema,
  amcContractListQuerySchema,
  type AmcContractWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  findAmcContractById,
  insertAmcContract,
  listAmcContracts,
  type AmcContractContent,
} from '../../../../packages/db/src/amc-contracts.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { allocateAmcContractReference } from '../../../../packages/db/src/references.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class AmcContractServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

function toContent(input: AmcContractWriteInput): AmcContractContent {
  return {
    contractDate: input.contractDate ?? null,
    contractPeriod: input.contractPeriod ?? null,
    clientName: input.clientName ?? null,
    attentionTo: input.attentionTo ?? null,
    siteLocation: input.siteLocation ?? null,
    planKey: input.planKey,
    planLabel: input.planLabel,
    coverage: input.coverage ?? null,
    coverageDetail: input.coverageDetail ?? null,
    visitsText: input.visitsText ?? null,
    annualVisits: input.annualVisits,
    appliances: input.appliances,
    totalCount: input.totalCount,
    totalValue: input.totalValue,
    laborCost: input.laborCost,
    transportCost: input.transportCost,
    partsReserve: input.partsReserve,
    directCost: input.directCost,
    overhead: input.overhead,
    priceExclVat: input.priceExclVat,
    priceInclVat: input.priceInclVat,
    commencementDate: input.commencementDate ?? null,
    contractRef: input.contractRef ?? null,
  };
}

export function createAmcContractService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = amcContractWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const scopeDate = data.contractDate ?? new Date().toISOString().slice(0, 10);
      const amcContractReference = await allocateAmcContractReference(client, scopeDate);
      const amcContract = await insertAmcContract(client, {
        amcContractReference,
        createdBy: profileId,
        content: toContent(data),
      });
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'amc_contract.created',
        targetType: 'amc_contract',
        targetId: amcContract.id,
        metadata: {
          amcContractReference: amcContract.amcContractReference,
          planKey: amcContract.planKey,
        },
        requestId,
      });
      return amcContract;
    });
  }

  async function list(query: Record<string, unknown>) {
    const data = amcContractListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      return listAmcContracts(client, {
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
      const amcContract = await findAmcContractById(client, id);
      if (!amcContract)
        throw new AmcContractServiceError('not-found', 'The AMC contract was not found.');
      return amcContract;
    } finally {
      client.release();
    }
  }

  return { create, list, detail };
}

export type AmcContractService = ReturnType<typeof createAmcContractService>;
