import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { readRoleMatrix, replaceRolePermissions } from '../../../../packages/db/src/roles.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export const rolePermissionsSchema = z
  .object({ permissions: z.array(z.string().trim().min(1).max(80)).max(200) })
  .strict();

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

  return { matrix, setPermissions };
}

export type RoleService = ReturnType<typeof createRoleService>;
