import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  masterDataListQuerySchema,
  salesChannelWriteSchema,
} from '../../../../packages/contracts/src/index.js';
import {
  insertSalesChannel,
  listSalesChannels,
} from '../../../../packages/db/src/sales-channels.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export function createSalesChannelService(pool: Pool) {
  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = salesChannelWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const salesChannel = await insertSalesChannel(client, data);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'sales_channel.created',
        targetType: 'sales_channel',
        targetId: salesChannel.id,
        metadata: { active: salesChannel.active },
        requestId,
      });
      return salesChannel;
    });
  }

  async function list(input: unknown) {
    const query = masterDataListQuerySchema.parse(input);
    const client = await pool.connect();
    try {
      return await listSalesChannels(client, query);
    } finally {
      client.release();
    }
  }

  return { create, list };
}

export type SalesChannelService = ReturnType<typeof createSalesChannelService>;
