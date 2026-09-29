import type { PoolClient } from 'pg';

// Small admin-managed master list (see modification.md #8). Same shape and
// pattern as sales-channels.ts -- kept as a separate module/table because
// salesmen and sales channels are independent lists with independent
// permissions (sales_channels write is super-admin-only).
export type SalesmanRecord = {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const columns = `
  salesmen.id,
  salesmen.name,
  salesmen.active,
  salesmen.created_at AS "createdAt",
  salesmen.updated_at AS "updatedAt"
`;

export async function insertSalesman(
  client: PoolClient,
  input: { name: string; active?: boolean },
): Promise<SalesmanRecord> {
  const result = await client.query<SalesmanRecord>(
    `INSERT INTO salesmen (name, active) VALUES ($1, COALESCE($2, true)) RETURNING ${columns}`,
    [input.name, input.active ?? null],
  );
  return result.rows[0];
}

export async function updateSalesman(
  client: PoolClient,
  id: string,
  input: { name: string; active?: boolean },
): Promise<SalesmanRecord | null> {
  const result = await client.query<SalesmanRecord>(
    `UPDATE salesmen
     SET name = $2, active = COALESCE($3, active), updated_at = now()
     WHERE id = $1 RETURNING ${columns}`,
    [id, input.name, input.active ?? null],
  );
  return result.rows[0] ?? null;
}

export async function listSalesmen(
  client: PoolClient,
  query: { active?: 'true' | 'false'; search?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.active) filters.push(`salesmen.active = ${add(query.active === 'true')}`);
  if (query.search) filters.push(`salesmen.name ILIKE ${add(`%${query.search}%`)}`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM salesmen ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<SalesmanRecord>(
    `SELECT ${columns} FROM salesmen ${where} ORDER BY salesmen.name ASC, salesmen.id ASC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
