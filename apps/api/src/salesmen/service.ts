import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  masterDataListQuerySchema,
  salesmanWriteSchema,
} from '../../../../packages/contracts/src/index.js';
import { insertSalesman, listSalesmen } from '../../../../packages/db/src/salesmen.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

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

  return { create, list };
}

export type SalesmanService = ReturnType<typeof createSalesmanService>;
