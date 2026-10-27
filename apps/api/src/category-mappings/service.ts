import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { categoryMappingWriteSchema } from '../../../../packages/contracts/src/index.js';
import {
  insertCategoryMapping,
  listCategoryMappings,
  listUnmappedGroups,
  PRICING_CATEGORIES,
  updateCategoryMapping,
} from '../../../../packages/db/src/category-mappings.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class CategoryMappingServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'invalid-category' | 'duplicate',
    message: string,
  ) {
    super(message);
  }
}

function checkPricingCategory(value: string | null | undefined, installable: boolean): void {
  if (!installable) return;
  if (!(PRICING_CATEGORIES as readonly string[]).includes(value ?? '')) {
    throw new CategoryMappingServiceError(
      'invalid-category',
      `The pricing category must be one of: ${PRICING_CATEGORIES.join(', ')}.`,
    );
  }
}

function isDuplicate(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: string }).code === '23505',
  );
}

export function createCategoryMappingService(pool: Pool) {
  async function list() {
    const client = await pool.connect();
    try {
      return {
        categoryMappings: await listCategoryMappings(client),
        unmappedGroups: await listUnmappedGroups(client),
        pricingCategories: [...PRICING_CATEGORIES],
      };
    } finally {
      client.release();
    }
  }

  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = categoryMappingWriteSchema.parse(input);
    checkPricingCategory(data.pricingCategory, data.installable);
    try {
      return await withTransaction(pool, async (client) => {
        const record = await insertCategoryMapping(client, data);
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'category_mapping.created',
          targetType: 'category_mapping',
          targetId: record.id,
          metadata: {
            groupName: record.groupName,
            installable: record.installable,
            pricingCategory: record.pricingCategory,
          },
          requestId,
        });
        return record;
      });
    } catch (error) {
      if (isDuplicate(error)) {
        throw new CategoryMappingServiceError(
          'duplicate',
          `The group "${data.groupName}" is already mapped. Edit the existing row instead.`,
        );
      }
      throw error;
    }
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = categoryMappingWriteSchema.parse(input);
    checkPricingCategory(data.pricingCategory, data.installable);
    try {
      return await withTransaction(pool, async (client) => {
        const record = await updateCategoryMapping(client, id, data);
        if (!record)
          throw new CategoryMappingServiceError('not-found', 'The category mapping was not found.');
        await insertAuditEvent(client, {
          actorProfileId: profileId,
          action: 'category_mapping.updated',
          targetType: 'category_mapping',
          targetId: id,
          metadata: {
            groupName: record.groupName,
            installable: record.installable,
            pricingCategory: record.pricingCategory,
            active: record.active,
          },
          requestId,
        });
        return record;
      });
    } catch (error) {
      if (isDuplicate(error)) {
        throw new CategoryMappingServiceError(
          'duplicate',
          `The group "${data.groupName}" is already mapped. Edit the existing row instead.`,
        );
      }
      throw error;
    }
  }

  return { list, create, update };
}

export type CategoryMappingService = ReturnType<typeof createCategoryMappingService>;
