import type { PoolClient } from 'pg';

// Persistent storage for Team logins (see modification.md #20 and
// migrations/015_local_auth_users.sql) -- backs apps/api/src/auth/local-auth.ts,
// which is the only caller of these. Kept schema-agnostic about which role
// strings are valid; local-auth.ts owns that (createUserSchema/updateUserSchema)
// and the DB CHECK constraint is the last line of defense.
export type LocalAuthUserRecord = {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const columns = `
  id,
  email,
  name,
  role,
  password_hash AS "passwordHash",
  active,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export async function countLocalAuthUsers(client: PoolClient): Promise<number> {
  const result = await client.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM local_auth_users',
  );
  return Number(result.rows[0].total);
}

export async function findLocalAuthUserByEmail(
  client: PoolClient,
  email: string,
): Promise<LocalAuthUserRecord | null> {
  const result = await client.query<LocalAuthUserRecord>(
    `SELECT ${columns} FROM local_auth_users WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findLocalAuthUserById(
  client: PoolClient,
  id: string,
): Promise<LocalAuthUserRecord | null> {
  const result = await client.query<LocalAuthUserRecord>(
    `SELECT ${columns} FROM local_auth_users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listLocalAuthUsers(client: PoolClient): Promise<LocalAuthUserRecord[]> {
  const result = await client.query<LocalAuthUserRecord>(
    `SELECT ${columns} FROM local_auth_users ORDER BY created_at ASC, id ASC`,
  );
  return result.rows;
}

export async function insertLocalAuthUser(
  client: PoolClient,
  input: { email: string; name: string; role: string; passwordHash: string },
): Promise<LocalAuthUserRecord> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO local_auth_users (email, name, role, password_hash)
     VALUES (lower($1), $2, $3, $4)
     RETURNING id`,
    [input.email, input.name, input.role, input.passwordHash],
  );
  const user = await findLocalAuthUserById(client, result.rows[0].id);
  if (!user) throw new Error('The created team login could not be loaded.');
  return user;
}

export async function updateLocalAuthUser(
  client: PoolClient,
  id: string,
  input: { role?: string; active?: boolean },
): Promise<LocalAuthUserRecord | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE local_auth_users
     SET role = COALESCE($2, role),
         active = COALESCE($3, active),
         updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, input.role ?? null, input.active ?? null],
  );
  if (!result.rows[0]) return null;
  return findLocalAuthUserById(client, result.rows[0].id);
}
