import type { PoolClient } from 'pg';

// Role matrix (modification.md #55): which permission each role carries.
// Effective permissions are read from these tables on every request
// (application-auth.ts), so a change here applies immediately.
export type RoleMatrix = {
  roles: { code: string; displayName: string; builtin: boolean; userCount: number }[];
  permissions: { code: string; description: string }[];
  grants: Record<string, string[]>;
};

export async function readRoleMatrix(client: PoolClient): Promise<RoleMatrix> {
  const [roles, permissions, grants] = await Promise.all([
    client.query<{ code: string; displayName: string; builtin: boolean; userCount: number }>(
      // Built-in roles first in their usual order, then custom roles by name.
      // userCount = logins that hold the role (Team logins + profile roles), so
      // the screen can say why a role cannot be deleted yet.
      `SELECT roles.code, roles.display_name AS "displayName", roles.is_builtin AS builtin,
              (SELECT count(*)::int FROM (
                 SELECT lower(profiles.email) AS email FROM profile_roles
                   JOIN profiles ON profiles.id = profile_roles.profile_id
                   WHERE profile_roles.role_id = roles.id
                 UNION
                 SELECT lower(local_auth_users.email) FROM local_auth_users
                   WHERE local_auth_users.role = roles.code
               ) holders) AS "userCount"
       FROM roles
       ORDER BY roles.is_builtin DESC,
                array_position(ARRAY['user','sales','management','admin'], roles.code),
                lower(roles.display_name)`,
    ),
    client.query<{ code: string; description: string }>(
      'SELECT code, description FROM permissions ORDER BY code',
    ),
    client.query<{ role: string; permission: string }>(
      `SELECT roles.code AS role, permissions.code AS permission
       FROM role_permissions
       JOIN roles ON roles.id = role_permissions.role_id
       JOIN permissions ON permissions.id = role_permissions.permission_id
       ORDER BY permissions.code`,
    ),
  ]);
  const byRole: Record<string, string[]> = {};
  for (const role of roles.rows) byRole[role.code] = [];
  for (const grant of grants.rows) byRole[grant.role]?.push(grant.permission);
  return { roles: roles.rows, permissions: permissions.rows, grants: byRole };
}

export async function replaceRolePermissions(
  client: PoolClient,
  roleCode: string,
  permissionCodes: string[],
  assignedBy: string | null,
): Promise<{ roleId: string; added: string[]; removed: string[] } | { unknown: string[] } | null> {
  const role = await client.query<{ id: string }>(
    'SELECT id::text AS id FROM roles WHERE code = $1 FOR UPDATE',
    [roleCode],
  );
  if (!role.rows[0]) return null;
  const roleId = role.rows[0].id;
  const wanted = [...new Set(permissionCodes)];
  const known = await client.query<{ code: string }>(
    'SELECT code FROM permissions WHERE code = ANY($1::text[])',
    [wanted],
  );
  const knownCodes = new Set(known.rows.map((row) => row.code));
  const unknown = wanted.filter((code) => !knownCodes.has(code));
  if (unknown.length) return { unknown };

  const current = await client.query<{ code: string }>(
    `SELECT permissions.code FROM role_permissions
     JOIN permissions ON permissions.id = role_permissions.permission_id
     WHERE role_permissions.role_id = $1`,
    [roleId],
  );
  const currentCodes = new Set(current.rows.map((row) => row.code));
  const added = wanted.filter((code) => !currentCodes.has(code));
  const removed = [...currentCodes].filter((code) => !knownCodes.has(code));
  if (removed.length) {
    await client.query(
      `DELETE FROM role_permissions
       WHERE role_id = $1
         AND permission_id IN (SELECT id FROM permissions WHERE code = ANY($2::text[]))`,
      [roleId, removed],
    );
  }
  if (added.length) {
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id, assigned_by)
       SELECT $1, id, $3 FROM permissions WHERE code = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [roleId, added, assignedBy],
    );
  }
  return { roleId, added: added.sort(), removed: removed.sort() };
}

// ---- custom roles (modification.md #176) --------------------------------

export function roleCodeFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export type RoleRow = { id: string; code: string; displayName: string; builtin: boolean };

export async function findRole(client: PoolClient, code: string): Promise<RoleRow | null> {
  const result = await client.query<RoleRow>(
    `SELECT id::text AS id, code, display_name AS "displayName", is_builtin AS builtin
     FROM roles WHERE code = $1 FOR UPDATE`,
    [code],
  );
  return result.rows[0] ?? null;
}

export async function roleNameTaken(
  client: PoolClient,
  displayName: string,
  exceptCode?: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM roles WHERE lower(display_name) = lower($1) AND code <> COALESCE($2, '')`,
    [displayName, exceptCode ?? null],
  );
  return result.rowCount !== 0;
}

export async function insertCustomRole(
  client: PoolClient,
  input: {
    code: string;
    displayName: string;
    copyFromCode: string | null;
    createdBy: string | null;
  },
): Promise<{ id: string; copied: string[] }> {
  const created = await client.query<{ id: string }>(
    `INSERT INTO roles (code, display_name, is_builtin, created_by)
     VALUES ($1, $2, false, $3) RETURNING id::text AS id`,
    [input.code, input.displayName, input.createdBy],
  );
  const id = created.rows[0].id;
  let copied: string[] = [];
  if (input.copyFromCode) {
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id, assigned_by)
       SELECT $1, role_permissions.permission_id, $3
       FROM role_permissions JOIN roles source ON source.id = role_permissions.role_id
       WHERE source.code = $2`,
      [id, input.copyFromCode, input.createdBy],
    );
    const result = await client.query<{ code: string }>(
      `SELECT permissions.code FROM role_permissions
       JOIN permissions ON permissions.id = role_permissions.permission_id
       WHERE role_permissions.role_id = $1 ORDER BY permissions.code`,
      [id],
    );
    copied = result.rows.map((row) => row.code);
  }
  return { id, copied };
}

export async function renameRole(
  client: PoolClient,
  roleId: string,
  displayName: string,
): Promise<void> {
  await client.query('UPDATE roles SET display_name = $2 WHERE id = $1', [roleId, displayName]);
}

export async function countRoleUsers(client: PoolClient, code: string): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM (
       SELECT lower(profiles.email) AS email FROM profile_roles
         JOIN roles ON roles.id = profile_roles.role_id
         JOIN profiles ON profiles.id = profile_roles.profile_id
         WHERE roles.code = $1
       UNION
       SELECT lower(email) FROM local_auth_users WHERE role = $1
     ) holders`,
    [code],
  );
  return result.rows[0]?.total ?? 0;
}

export async function deleteRole(client: PoolClient, roleId: string): Promise<void> {
  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
}

export async function roleExists(client: PoolClient, code: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM roles WHERE code = $1', [code]);
  return result.rowCount !== 0;
}
