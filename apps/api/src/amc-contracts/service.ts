import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  amcContractWriteSchema,
  amcContractListQuerySchema,
  amcContractStatusSchema,
  type AmcContractWriteInput,
} from '../../../../packages/contracts/src/index.js';
import {
  changeAmcContractStatus,
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
    public readonly code: 'not-found' | 'no-plan',
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
    appliances: input.appliances,
    totalCount: input.totalCount,
    totalValue: input.totalValue,
    plans: input.plans.map((plan) => ({
      planKey: plan.planKey,
      planLabel: plan.planLabel,
      coverage: plan.coverage ?? null,
      coverageDetail: plan.coverageDetail ?? null,
      included: plan.included ?? null,
      notIncluded: plan.notIncluded ?? null,
      visitsText: plan.visitsText ?? null,
      annualVisits: plan.annualVisits,
      laborCost: plan.laborCost,
      transportCost: plan.transportCost,
      partsReserve: plan.partsReserve,
      directCost: plan.directCost,
      overhead: plan.overhead,
      priceExclVat: plan.priceExclVat,
      priceInclVat: plan.priceInclVat,
    })),
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
          planKeys: amcContract.plans.map((plan) => plan.planKey),
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
      const amcContract = await findAmcContractById(client, id);
      if (!amcContract)
        throw new AmcContractServiceError('not-found', 'The AMC contract was not found.');
      return amcContract;
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
    const change = amcContractStatusSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const result = await changeAmcContractStatus(
        client,
        id,
        change.status === 'Sold'
          ? {
              status: 'Sold',
              planKey: change.planKey,
              soldDate: change.soldDate,
              contractRef: change.contractRef ?? null,
            }
          : change.status === 'Lost'
            ? { status: 'Lost', reason: change.reason ?? null }
            : { status: 'Quote' },
        profileId,
      );
      if (result === null)
        throw new AmcContractServiceError('not-found', 'The AMC contract was not found.');
      if (result === 'no-plan')
        throw new AmcContractServiceError(
          'no-plan',
          'This AMC record does not have the chosen plan.',
        );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'amc_contract.status_changed',
        targetType: 'amc_contract',
        targetId: result.id,
        metadata: {
          amcContractReference: result.amcContractReference,
          status: result.status,
          soldPlanKey: result.soldPlanKey,
          soldPriceExclVat: result.soldPriceExclVat,
        },
        requestId,
      });
      return result;
    });
  }

  return { create, list, detail, setStatus };
}

export type AmcContractService = ReturnType<typeof createAmcContractService>;
