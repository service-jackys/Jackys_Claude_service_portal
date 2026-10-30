import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  countRoleUsers,
  deleteRole,
  findRole,
  insertCustomRole,
  readRoleMatrix,
  renameRole,
  replaceRolePermissions,
  roleCodeFromName,
  roleNameTaken,
} from '../../../../packages/db/src/roles.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export const rolePermissionsSchema = z
  .object({ permissions: z.array(z.string().trim().min(1).max(80)).max(200) })
  .strict();

const roleNameSchema = z.string().trim().min(2).max(40);

export const createRoleSchema = z
  .object({ name: roleNameSchema, copyFrom: z.string().trim().min(1).max(40).optional() })
  .strict();

export const renameRoleSchema = z.object({ name: roleNameSchema }).strict();

export class RoleServiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Administrators always carry '*' (application-auth.ts), so their column is
// fixed; letting it be edited would suggest something that has no effect and
// is how an admin could lock everyone out by mistake.
const LOCKED_ROLE = 'admin';

export function createRoleService(pool: Pool) {
  async function matrix() {
    return withTransaction(pool, (client) => readRoleMatrix(client));
  }

  async function setPermissions(roleCode: string, input: unknown, actorProfileId: string | null) {
    if (roleCode === LOCKED_ROLE) {
      throw new RoleServiceError(
        409,
        'role-locked',
        'The administrator role always has every permission and cannot be edited.',
      );
    }
    const body = rolePermissionsSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const result = await replaceRolePermissions(
        client,
        roleCode,
        body.permissions,
        actorProfileId,
      );
      if (!result) throw new RoleServiceError(404, 'not-found', 'That role was not found.');
      if ('unknown' in result) {
        throw new RoleServiceError(
          400,
          'unknown-permission',
          `Unknown permission: ${result.unknown.join(', ')}`,
        );
      }
      if (result.added.length || result.removed.length) {
        await insertAuditEvent(client, {
          actorProfileId,
          action: 'roles.permissions_updated',
          targetType: 'role',
          targetId: result.roleId,
          metadata: { role: roleCode, added: result.added, removed: result.removed },
        });
      }
      return { role: roleCode, added: result.added, removed: result.removed };
    });
  }

  // New role (modification.md #176): the code is a lower-case slug of the name
  // and never changes afterwards, so renaming only changes the label people see.
  async function create(input: unknown, actorProfileId: string | null) {
    const body = createRoleSchema.parse(input);
    const code = roleCodeFromName(body.name);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) {
      throw new RoleServiceError(
        400,
        'invalid-name',
        'Use a name that starts with a letter, for example "Service Coordinator".',
      );
    }
    return withTransaction(pool, async (client) => {
      if (body.copyFrom && !(await findRole(client, body.copyFrom))) {
        throw new RoleServiceError(404, 'not-found', 'The role to copy from was not found.');
      }
      if (await roleNameTaken(client, body.name)) {
        throw new RoleServiceError(409, 'name-taken', 'A role with that name already exists.');
      }
      const exists = await client.query('SELECT 1 FROM roles WHERE code = $1', [code]);
      if (exists.rowCount) {
        throw new RoleServiceError(
          409,
          'name-taken',
          'A role with a very similar name already exists.',
        );
      }
      const created = await insertCustomRole(client, {
        code,
        displayName: body.name,
        copyFromCode: body.copyFrom ?? null,
        createdBy: actorProfileId,
      });
      await insertAuditEvent(client, {
        actorProfileId,
        action: 'roles.created',
        targetType: 'role',
        targetId: created.id,
        metadata: {
          role: code,
          name: body.name,
          copiedFrom: body.copyFrom ?? null,
          permissions: created.copied,
        },
      });
      return { code, displayName: body.name, permissions: created.copied };
    });
  }

  async function rename(roleCode: string, input: unknown, actorProfileId: string | null) {
    const body = renameRoleSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const role = await findRole(client, roleCode);
      if (!role) throw new RoleServiceError(404, 'not-found', 'That role was not found.');
      if (role.builtin) {
        throw new RoleServiceError(
          409,
          'role-builtin',
          'The four built-in roles cannot be renamed.',
        );
      }
      if (await roleNameTaken(client, body.name, roleCode)) {
        throw new RoleServiceError(409, 'name-taken', 'A role with that name already exists.');
      }
      if (body.name !== role.displayName) {
        await renameRole(client, role.id, body.name);
        await insertAuditEvent(client, {
          actorProfileId,
          action: 'roles.renamed',
          targetType: 'role',
          targetId: role.id,
          metadata: { role: roleCode, from: role.displayName, to: body.name },
        });
      }
      return { code: roleCode, displayName: body.name };
    });
  }

  async function remove(roleCode: string, actorProfileId: string | null) {
    return withTransaction(pool, async (client) => {
      const role = await findRole(client, roleCode);
      if (!role) throw new RoleServiceError(404, 'not-found', 'That role was not found.');
      if (role.builtin) {
        throw new RoleServiceError(
          409,
          'role-builtin',
          'The four built-in roles cannot be deleted.',
        );
      }
      const holders = await countRoleUsers(client, roleCode);
      if (holders > 0) {
        throw new RoleServiceError(
          409,
          'role-in-use',
          `${holders} ${holders === 1 ? 'user still has' : 'users still have'} this role. Move ${holders === 1 ? 'them' : 'them'} to another role in Users first.`,
        );
      }
      await deleteRole(client, role.id);
      await insertAuditEvent(client, {
        actorProfileId,
        action: 'roles.deleted',
        targetType: 'role',
        targetId: role.id,
        metadata: { role: roleCode, name: role.displayName },
      });
      return { code: roleCode };
    });
  }

  return { matrix, setPermissions, create, rename, remove };
}

export type RoleService = ReturnType<typeof createRoleService>;
