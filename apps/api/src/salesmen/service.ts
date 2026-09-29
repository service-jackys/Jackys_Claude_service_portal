import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  masterDataListQuerySchema,
  salesmanWriteSchema,
} from '../../../../packages/contracts/src/index.js';
import {
  insertSalesman,
  listSalesmen,
  updateSalesman,
} from '../../../../packages/db/src/salesmen.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class SalesmanServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export function createSalesmanService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = salesmanWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const salesman = await insertSalesman(client, data);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'salesman.created',
        targetType: 'salesman',
        targetId: salesman.id,
        metadata: { active: salesman.active },
        requestId,
      });
      return salesman;
    });
  }

  async function list(input: unknown) {
    const query = masterDataListQuerySchema.parse(input);
    const client = await pool.connect();
    try {
      return await listSalesmen(client, query);
    } finally {
      client.release();
    }
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = salesmanWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const salesman = await updateSalesman(client, id, data);
      if (!salesman) throw new SalesmanServiceError('not-found', 'The salesman was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'salesman.updated',
        targetType: 'salesman',
        targetId: id,
        metadata: { active: salesman.active },
        requestId,
      });
      return salesman;
    });
  }

  return { create, list, update };
}

export type SalesmanService = ReturnType<typeof createSalesmanService>;
