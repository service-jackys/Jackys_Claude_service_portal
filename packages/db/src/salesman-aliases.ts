import type { PoolClient } from 'pg';
import { findSalesmanByName, type SalesmanRecord } from './salesmen.js';

// Other spellings of a salesman's name (migration 059). The salesmen master is
// the one true spelling; an alias only helps to recognise a name written
// differently in the B2B customer list or the master workbook.
export type SalesmanAliasRecord = {
  id: string;
  alias: string;
  salesmanId: string;
  salesmanName: string;
  createdAt: Date;
};

const columns = `
  salesman_aliases.id,
  salesman_aliases.alias,
  salesman_aliases.salesman_id AS "salesmanId",
  salesmen.name AS "salesmanName",
  salesman_aliases.created_at AS "createdAt"
`;

export async function listSalesmanAliases(client: PoolClient): Promise<SalesmanAliasRecord[]> {
  const result = await client.query<SalesmanAliasRecord>(
    `SELECT ${columns} FROM salesman_aliases
     JOIN salesmen ON salesmen.id = salesman_aliases.salesman_id
     ORDER BY lower(salesmen.name), lower(salesman_aliases.alias)`,
  );
  return result.rows;
}

export async function insertSalesmanAlias(
  client: PoolClient,
  input: { alias: string; salesmanId: string },
  profileId: string,
): Promise<SalesmanAliasRecord> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO salesman_aliases (alias, salesman_id, created_by)
     VALUES (btrim($1), $2, $3) RETURNING id`,
    [input.alias, input.salesmanId, profileId],
  );
  const result = await client.query<SalesmanAliasRecord>(
    `SELECT ${columns} FROM salesman_aliases
     JOIN salesmen ON salesmen.id = salesman_aliases.salesman_id
     WHERE salesman_aliases.id = $1`,
    [inserted.rows[0]!.id],
  );
  return result.rows[0]!;
}

export async function deleteSalesmanAlias(
  client: PoolClient,
  id: string,
): Promise<SalesmanAliasRecord | null> {
  const result = await client.query<SalesmanAliasRecord>(
    `WITH gone AS (DELETE FROM salesman_aliases WHERE id = $1 RETURNING *)
     SELECT gone.id, gone.alias, gone.salesman_id AS "salesmanId",
            salesmen.name AS "salesmanName", gone.created_at AS "createdAt"
     FROM gone JOIN salesmen ON salesmen.id = gone.salesman_id`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** The salesman for a name as written anywhere: the master spelling first, then an alias. */
export async function findSalesmanByNameOrAlias(
  client: PoolClient,
  name: string,
): Promise<SalesmanRecord | null> {
  const direct = await findSalesmanByName(client, name);
  if (direct) return direct;
  const result = await client.query<{ name: string }>(
    `SELECT salesmen.name FROM salesman_aliases
     JOIN salesmen ON salesmen.id = salesman_aliases.salesman_id
     WHERE lower(btrim(salesman_aliases.alias)) = lower(btrim($1)) LIMIT 1`,
    [name],
  );
  return result.rows[0] ? findSalesmanByName(client, result.rows[0].name) : null;
}

/** Lower-cased alias or master name -> master name, for comparing lists of names. */
export async function salesmanNameLookup(client: PoolClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const names = await client.query<{ name: string }>('SELECT name FROM salesmen');
  for (const row of names.rows) map.set(row.name.trim().toLowerCase(), row.name);
  const aliases = await client.query<{ alias: string; name: string }>(
    `SELECT salesman_aliases.alias, salesmen.name FROM salesman_aliases
     JOIN salesmen ON salesmen.id = salesman_aliases.salesman_id`,
  );
  for (const row of aliases.rows) map.set(row.alias.trim().toLowerCase(), row.name);
  return map;
}
