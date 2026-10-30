import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Role = {
  code: string;
  displayName: string;
  builtin: boolean;
  userCount: number;
};

async function mockApi(page: Page, roles: Role[], calls: string[]) {
  const grants: Record<string, string[]> = {
    user: ['dashboard.read'],
    sales: ['dashboard.read', 'quotation.read'],
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          id: 'admin-1',
          name: 'Admin',
          email: 'admin@jackys.com',
          role: 'admin',
          permissions: ['*'],
        },
      });
    }
    let body: { name?: string; copyFrom?: string } | null = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const method = request.method();
    if (url.pathname === '/api/role-matrix' && method === 'GET') {
      return json({
        roles,
        permissions: [
          { code: 'dashboard.read', description: 'Open the dashboard' },
          { code: 'quotation.read', description: 'View quotations' },
        ],
        grants: Object.fromEntries(roles.map((role) => [role.code, grants[role.code] ?? []])),
      });
    }
    if (url.pathname === '/api/role-matrix' && method === 'POST') {
      calls.push(`POST ${JSON.stringify(body)}`);
      const code = body!.name!.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      roles.push({ code, displayName: body!.name!, builtin: false, userCount: 0 });
      grants[code] = body!.copyFrom ? [...(grants[body!.copyFrom] ?? [])] : [];
      return json({ code, displayName: body!.name, permissions: grants[code] }, 201);
    }
    if (url.pathname.startsWith('/api/role-matrix/') && method === 'PATCH') {
      const code = decodeURIComponent(url.pathname.split('/').pop()!);
      calls.push(`PATCH ${code} ${JSON.stringify(body)}`);
      roles.find((role) => role.code === code)!.displayName = body!.name!;
      return json({ code, displayName: body!.name });
    }
    if (url.pathname.startsWith('/api/role-matrix/') && method === 'DELETE') {
      const code = decodeURIComponent(url.pathname.split('/').pop()!);
      calls.push(`DELETE ${code}`);
      roles.splice(
        roles.findIndex((role) => role.code === code),
        1,
      );
      return json({ code });
    }
    if (url.pathname === '/api/auth/users') {
      return json({
        users: [
          { id: 'u-2', name: 'Fatima', email: 'fatima@jackys.com', role: 'finance', active: true },
        ],
      });
    }
    return json({});
  });
}

async function openRoles(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.locator('#rolesNav').click();
  await expect(page.locator('#rolesWorkspace')).toBeVisible();
}

const builtIns = (): Role[] => [
  { code: 'user', displayName: 'User', builtin: true, userCount: 0 },
  { code: 'sales', displayName: 'Sales', builtin: true, userCount: 0 },
  { code: 'management', displayName: 'Management', builtin: true, userCount: 0 },
  { code: 'admin', displayName: 'Administrator', builtin: true, userCount: 1 },
];

test.describe('Custom roles', () => {
  test('an administrator creates a role by copying Sales, renames it, and deletes it', async ({
    page,
  }) => {
    const calls: string[] = [];
    await mockApi(page, builtIns(), calls);
    await openRoles(page);
    const workspace = page.locator('#rolesWorkspace');

    // A built-in role is selected first: no Rename/Delete, and Administrator
    // and Management stay on screen as reference columns beside it.
    await expect(workspace.locator('#rmRoleSelect')).toHaveValue('sales');
    await expect(workspace.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(workspace.locator('.rm-table th.rm-col')).toHaveText([
      /Administrator\s*Reference/,
      /Management\s*Reference/,
      /Sales\s*Editing/,
    ]);

    await workspace.getByRole('button', { name: '+ New role' }).click();
    await page.locator('#rmRoleName').fill('Service Coordinator');
    await page.locator('#rmRoleCopy').selectOption('sales');
    await page.getByRole('button', { name: 'Create role' }).click();
    // The new role becomes the one being edited, with the copied permissions ticked.
    await expect(workspace.locator('#rmRoleSelect')).toHaveValue('service_coordinator');
    expect(calls[0]).toBe('POST {"name":"Service Coordinator","copyFrom":"sales"}');
    await expect(
      page.locator('input[data-role="service_coordinator"][data-perm="quotation.read"]'),
    ).toBeChecked();
    await expect(workspace.locator('.rm-table th.rm-col-edit')).toContainText(
      'Service Coordinator',
    );

    await workspace.getByRole('button', { name: 'Rename' }).click();
    await page.locator('#rmRoleName').fill('Coordinator');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(workspace.locator('.rm-table th.rm-col-edit')).toContainText('Coordinator');
    expect(calls[1]).toBe('PATCH service_coordinator {"name":"Coordinator"}');

    page.once('dialog', (dialog) => dialog.accept());
    await workspace.getByRole('button', { name: 'Delete' }).click();
    await expect(workspace.locator('#rmRoleSelect option', { hasText: 'Coordinator' })).toHaveCount(
      0,
    );
    expect(calls[2]).toBe('DELETE service_coordinator');
  });

  test('switching roles keeps unsaved ticks and shows Management as a reference', async ({
    page,
  }) => {
    await mockApi(page, builtIns(), []);
    await openRoles(page);
    const workspace = page.locator('#rolesWorkspace');
    const box = page.locator('input[data-role="sales"][data-perm="dashboard.read"]');
    await box.uncheck();
    await expect(workspace.locator('[data-rm-status]')).toContainText('1 role has unsaved changes');
    await workspace.locator('#rmRoleSelect').selectOption('user');
    await expect(workspace.locator('#rmRoleSelect option[value="sales"]')).toHaveText(
      'Sales (unsaved)',
    );
    await workspace.locator('#rmRoleSelect').selectOption('sales');
    await expect(box).not.toBeChecked();
    // Management is the role being edited: it is not repeated as a reference.
    await workspace.locator('#rmRoleSelect').selectOption('management');
    await expect(workspace.locator('.rm-table th.rm-col')).toHaveText([
      /Administrator\s*Reference/,
      /Management\s*Editing/,
    ]);
  });

  test('a role that users still hold cannot be deleted from the screen', async ({ page }) => {
    const calls: string[] = [];
    const roles = builtIns();
    roles.push({ code: 'finance', displayName: 'Finance', builtin: false, userCount: 2 });
    await mockApi(page, roles, calls);
    await openRoles(page);
    await page.locator('#rmRoleSelect').selectOption('finance');
    await page.locator('#rolesWorkspace').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#workspaceMessage')).toContainText(
      '2 users still have the role "Finance"',
    );
    expect(calls).toEqual([]);
  });

  test('the Users page offers custom roles for new logins and existing ones', async ({ page }) => {
    const roles = builtIns();
    roles.push({ code: 'finance', displayName: 'Finance', builtin: false, userCount: 1 });
    await mockApi(page, roles, []);
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.locator('#teamAccountsNav').click();
    await expect(page.locator('#teamAccountRole option')).toHaveText([
      'User',
      'Sales',
      'Management',
      'Administrator',
      'Finance',
    ]);
    await expect(page.locator('select.team-account-role-select[data-user-id="u-2"]')).toHaveValue(
      'finance',
    );
  });
});
