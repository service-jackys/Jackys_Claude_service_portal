import type { PoolClient } from 'pg';

// Small, admin-managed master list (see modification.md #8). Same shape and
// pattern as salesmen.ts -- kept as a separate module/table because salesmen
// and sales channels are independent lists with independent permissions
// (sales_channels write is super-admin-only).
export type SalesChannelRecord = {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const columns = `
  sales_channels.id,
  sales_channels.name,
  sales_channels.active,
  sales_channels.created_at AS "createdAt",
  sales_channels.updated_at AS "updatedAt"
`;

export async function insertSalesChannel(
  client: PoolClient,
  input: { name: string; active?: boolean },
): Promise<SalesChannelRecord> {
  const result = await client.query<SalesChannelRecord>(
    `INSERT INTO sales_channels (name, active) VALUES ($1, COALESCE($2, true)) RETURNING ${columns}`,
    [input.name, input.active ?? null],
  );
  return result.rows[0];
}

export async function listSalesChannels(
  client: PoolClient,
  query: { active?: 'true' | 'false'; search?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.active) filters.push(`sales_channels.active = ${add(query.active === 'true')}`);
  if (query.search) filters.push(`sales_channels.name ILIKE ${add(`%${query.search}%`)}`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM sales_channels ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<SalesChannelRecord>(
    `SELECT ${columns} FROM sales_channels ${where} ORDER BY sales_channels.name ASC, sales_channels.id ASC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
