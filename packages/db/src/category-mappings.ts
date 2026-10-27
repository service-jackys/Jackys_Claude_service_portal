import type { PoolClient } from 'pg';
import { STOCK_NON_PRODUCT_GROUPS } from './stock-master.js';

// Delivery & installation category mapping (see migrations/057_dandi_masters.sql):
// an item group is installable or not, and an installable group names the
// pricing category (a category of the D+I pricing master) its rates come from.
// A group with no row is "unmapped"; the D&I entry screen asks the admin to link
// it instead of guessing.
/** Appliance classes the D+I pricing master (D+I Admin Entry) holds rates for. */
export const PRICING_CATEGORIES = [
  'Freestanding Refrigerator',
  'Freestanding Washing Machine',
  'Freestanding Cooker',
] as const;

export type CategoryMappingRecord = {
  id: string;
  groupName: string;
  installable: boolean;
  pricingCategory: string | null;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const columns = `
  category_mappings.id,
  category_mappings.group_name AS "groupName",
  category_mappings.installable,
  category_mappings.pricing_category AS "pricingCategory",
  category_mappings.active,
  category_mappings.notes,
  category_mappings.created_at AS "createdAt",
  category_mappings.updated_at AS "updatedAt"
`;

export type CategoryMappingInput = {
  groupName: string;
  installable: boolean;
  pricingCategory?: string | null;
  active?: boolean;
  notes?: string | null;
};

export async function listCategoryMappings(client: PoolClient): Promise<CategoryMappingRecord[]> {
  const result = await client.query<CategoryMappingRecord>(
    `SELECT ${columns} FROM category_mappings ORDER BY lower(category_mappings.group_name) ASC`,
  );
  return result.rows;
}

export async function insertCategoryMapping(
  client: PoolClient,
  input: CategoryMappingInput,
): Promise<CategoryMappingRecord> {
  const result = await client.query<CategoryMappingRecord>(
    `INSERT INTO category_mappings (group_name, installable, pricing_category, active, notes)
     VALUES ($1, $2, $3, COALESCE($4, true), $5)
     RETURNING ${columns}`,
    [
      input.groupName,
      input.installable,
      input.installable ? (input.pricingCategory ?? null) : null,
      input.active ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0];
}

export async function updateCategoryMapping(
  client: PoolClient,
  id: string,
  input: CategoryMappingInput,
): Promise<CategoryMappingRecord | null> {
  const result = await client.query<CategoryMappingRecord>(
    `UPDATE category_mappings
     SET group_name = $2, installable = $3, pricing_category = $4,
         active = COALESCE($5, active), notes = $6, updated_at = now()
     WHERE id = $1
     RETURNING ${columns}`,
    [
      id,
      input.groupName,
      input.installable,
      input.installable ? (input.pricingCategory ?? null) : null,
      input.active ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export type UnmappedGroup = { groupName: string; mainGroup: string | null; itemCount: number };

/**
 * Item groups present in the stock master that have no active mapping yet, with
 * how many items each holds, so the admin can see what still needs linking.
 */
export async function listUnmappedGroups(client: PoolClient): Promise<UnmappedGroup[]> {
  const result = await client.query<UnmappedGroup>(
    `SELECT stock_items.group_name AS "groupName",
            min(stock_items.main_group) AS "mainGroup",
            count(*)::int AS "itemCount"
     FROM stock_items
     WHERE stock_items.group_name IS NOT NULL AND length(trim(stock_items.group_name)) > 0
       AND COALESCE(stock_items.main_group, '') <> ALL($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM category_mappings
         WHERE lower(trim(category_mappings.group_name)) = lower(trim(stock_items.group_name))
       )
     GROUP BY stock_items.group_name
     ORDER BY count(*) DESC, stock_items.group_name ASC
     LIMIT 300`,
    [[...STOCK_NON_PRODUCT_GROUPS]],
  );
  return result.rows;
}
