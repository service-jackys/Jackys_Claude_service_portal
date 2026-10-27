import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  deleteSalesmanAlias,
  insertSalesmanAlias,
  listSalesmanAliases,
} from '../../../../packages/db/src/salesman-aliases.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class SalesmanAliasServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'duplicate' | 'unknown-salesman' | 'same-name',
    message: string,
  ) {
    super(message);
  }
}

export const salesmanAliasWriteSchema = z
  .object({
    alias: z.string().trim().min(1).max(200),
    salesmanId: z.string().regex(/^\d+$/),
  })
  .strict();

const pgCode = (error: unknown) =>
  error && typeof error === 'object' ? (error as { code?: string }).code : undefined;

export function createSalesmanAliasService(pool: Pool) {
  async function list() {
    const client = await pool.connect();
    try {
      return { aliases: await listSalesmanAliases(client) };
    } finally {
      client.release();
    }
  }

  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = salesmanAliasWriteSchema.parse(input);
    try {
      return await withTransaction(pool, async (client) => {
        const salesman = await client.query<{ name: string }>(
          'SELECT name FROM salesmen WHERE id = $1',
          [data.salesmanId],
        );
        if (!salesman.rows[0]) {
          throw new SalesmanAliasServiceError(
            'unknown-salesman',
            'Choose a salesman from the list.',
          );
        }
        if (salesman.rows[0].name.trim().toLowerCase() === data.alias.toLowerCase()) {
          throw new SalesmanAliasServiceError(
            'same-name',
            'That is already the salesman’s own name; an alias must be a different spelling.',
          );
        }
        const record = await insertSalesmanAlias(client, data, profileId);
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'salesman_alias.created',
          targetType: 'salesman_alias',
          targetId: record.id,
          metadata: { alias: record.alias, salesman: record.salesmanName },
          requestId,
        });
        return { alias: record };
      });
    } catch (error) {
      if (pgCode(error) === '23505') {
        throw new SalesmanAliasServiceError(
          'duplicate',
          `"${data.alias}" is already an alias. Remove the existing one first.`,
        );
      }
      throw error;
    }
  }

  async function remove(id: string, profileId: string, requestId: string = randomUUID()) {
    if (!/^\d+$/.test(id)) throw new SalesmanAliasServiceError('not-found', 'Alias not found.');
    return withTransaction(pool, async (client) => {
      const record = await deleteSalesmanAlias(client, id);
      if (!record) throw new SalesmanAliasServiceError('not-found', 'Alias not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'salesman_alias.deleted',
        targetType: 'salesman_alias',
        targetId: record.id,
        metadata: { alias: record.alias, salesman: record.salesmanName },
        requestId,
      });
      return { removed: true };
    });
  }

  return { list, create, remove };
}

export type SalesmanAliasService = ReturnType<typeof createSalesmanAliasService>;
