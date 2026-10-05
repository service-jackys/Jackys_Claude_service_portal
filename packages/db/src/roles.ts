import type { PoolClient } from 'pg';

// Role matrix (modification.md #55): which permission each role carries.
// Effective permissions are read from these tables on every request
// (application-auth.ts), so a change here applies immediately.
export type RoleMatrix = {
  roles: { code: string; displayName: string }[];
  permissions: { code: string; description: string }[];
  grants: Record<string, string[]>;
};

export async function readRoleMatrix(client: PoolClient): Promise<RoleMatrix> {
  const [roles, permissions, grants] = await Promise.all([
    client.query<{ code: string; displayName: string }>(
      `SELECT code, display_name AS "displayName" FROM roles
       ORDER BY array_position(ARRAY['user','sales','management','admin'], code)`,
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
