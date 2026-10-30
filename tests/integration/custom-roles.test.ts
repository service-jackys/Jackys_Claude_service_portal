import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLocalAuth } from '../../apps/api/src/auth/local-auth.js';
import { RoleServiceError, createRoleService } from '../../apps/api/src/roles/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { roleCodeFromName } from '../../packages/db/src/roles.js';

const databaseUrl = process.env.DATABASE_URL;

test('roleCodeFromName makes a lower-case code from the typed name', () => {
  assert.equal(roleCodeFromName('Service Coordinator'), 'service_coordinator');
  assert.equal(roleCodeFromName('  Sales / Co-ordinator! '), 'sales_co_ordinator');
  assert.equal(roleCodeFromName('Récéption'), 'reception');
  assert.equal(roleCodeFromName('123'), '123');
});

async function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RoleServiceError, String(error));
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test(
  'custom roles: create, copy permissions, assign, rename, delete rules',
  { skip: !databaseUrl },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    const service = createRoleService(pool);
    const suffix = randomUUID().slice(0, 6);
    const name = `Test Coordinator ${suffix}`;
    const code = roleCodeFromName(name);
    const email = `role-test-${suffix}@example.com`;
    const localAuth = createLocalAuth({}, pool);

    try {
      // Create, copying the Sales role's saved permissions.
      const before = await service.matrix();
      const sales = before.grants.sales;
      assert.ok(sales.length > 0);
      const created = await service.create({ name, copyFrom: 'sales' }, null);
      assert.equal(created.code, code);
      assert.deepEqual(created.permissions, [...sales].sort());

      // Shows up in the matrix after the built-ins, flagged custom, with the copied grants.
      const matrix = await service.matrix();
      const codes = matrix.roles.map((role) => role.code);
      assert.deepEqual(codes.slice(0, 4), ['user', 'sales', 'management', 'admin']);
      const mine = matrix.roles.find((role) => role.code === code)!;
      assert.equal(mine.builtin, false);
      assert.equal(mine.userCount, 0);
      assert.deepEqual(matrix.grants[code], [...sales].sort());
      assert.ok(matrix.roles.filter((role) => role.builtin).length === 4);

      // Name rules: duplicates (any case) are refused, built-in names are taken.
      await rejectsWith(service.create({ name: name.toUpperCase() }, null), 409, 'name-taken');
      await rejectsWith(service.create({ name: 'Sales' }, null), 409, 'name-taken');
      await rejectsWith(service.create({ name: '!!' }, null), 400, 'invalid-name');
      await rejectsWith(
        service.create({ name: 'Fine Name', copyFrom: 'nope' }, null),
        404,
        'not-found',
      );

      // Its permissions are editable like any other role.
      const edited = await service.setPermissions(code, { permissions: ['dashboard.read'] }, null);
      assert.equal(edited.role, code);
      assert.deepEqual((await service.matrix()).grants[code], ['dashboard.read']);

      // A login can hold it; the matrix counts that user; delete is blocked.
      const result = await localAuth.createUser({
        email,
        name: 'Role Tester',
        password: 'Abcdefghi1!',
        role: code,
      });
      assert.equal(result.kind, 'created');
      assert.equal((await service.matrix()).roles.find((role) => role.code === code)!.userCount, 1);
      await rejectsWith(service.remove(code, null), 409, 'role-in-use');

      // An unknown role cannot be given to a login.
      const unknown = await localAuth.createUser({
        email: `other-${suffix}@example.com`,
        name: 'Nobody',
        password: 'Abcdefghi1!',
        role: 'no_such_role',
      });
      assert.equal(unknown.kind, 'unknown-role');

      // Rename changes the label, not the code; duplicates are refused.
      const renamed = await service.rename(code, { name: `Renamed ${suffix}` }, null);
      assert.deepEqual(renamed, { code, displayName: `Renamed ${suffix}` });
      await rejectsWith(service.rename(code, { name: 'Management' }, null), 409, 'name-taken');

      // Built-in roles are protected.
      for (const builtin of ['user', 'sales', 'management', 'admin']) {
        await rejectsWith(
          service.rename(builtin, { name: `X ${builtin} ${suffix}` }, null),
          409,
          'role-builtin',
        );
        await rejectsWith(service.remove(builtin, null), 409, 'role-builtin');
      }
      await rejectsWith(service.remove('no_such_role', null), 404, 'not-found');

      // Once the login moves to another role, the custom role can be deleted.
      if (result.kind !== 'created') throw new Error('unreachable');
      const moved = await localAuth.updateUser(result.user.id, { role: 'user' });
      assert.equal(moved.kind, 'updated');
      const bad = await localAuth.updateUser(result.user.id, { role: 'no_such_role' });
      assert.equal(bad.kind, 'unknown-role');
      assert.deepEqual(await service.remove(code, null), { code });
      assert.ok(!(await service.matrix()).roles.some((role) => role.code === code));
      const left = await pool.query(
        'SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1',
        [code],
      );
      assert.equal(left.rowCount, 0);
    } finally {
      await pool.query('DELETE FROM local_auth_users WHERE email LIKE $1', [
        `%${suffix}@example.com`,
      ]);
      await pool.query(
        'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = $1)',
        [code],
      );
      await pool.query('DELETE FROM roles WHERE code = $1 AND NOT is_builtin', [code]);
      await pool.end();
    }
  },
);
