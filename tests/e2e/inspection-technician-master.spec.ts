import { expect, test } from '@playwright/test';

// Inspections: the Technician is picked from the Technicians master, not typed.
async function setup(page: import('@playwright/test').Page, permissions: string[]) {
  const state: { createBody: Record<string, unknown> | null } = { createBody: null };
  const inspection = {
    id: '901',
    inspectionReference: 'INS-2026-00001',
    customerName: 'Old Customer',
    technicianName: 'Retired Tech',
    products: [],
    faultyParts: [],
    updatedAt: '2026-09-26T08:00:00.000Z',
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({ user: { name: 'I', email: 'i@jackys.com', role: 'staff', permissions } });
    if (url.pathname === '/api/technicians')
      return json({
        technicians: [
          { id: '1', name: 'Siva' },
          { id: '2', name: 'Ravi' },
        ],
      });
    if (url.pathname === '/api/inspections' && method === 'GET')
      return json({ inspections: [inspection] });
    if (url.pathname === '/api/inspections' && method === 'POST') {
      state.createBody = route.request().postDataJSON();
      return json({ inspection }, 201);
    }
    if (url.pathname === '/api/inspections/901') return json({ inspection });
    return route.continue();
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('i@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await expect(page.locator('#inspectionsNav')).not.toHaveAttribute('hidden', /.*/);
  if (!(await page.locator('#inspectionsNav').isVisible()))
    await page.getByRole('button', { name: 'Records', exact: true }).click();
  await page.locator('#inspectionsNav').click();
  return state;
}

test('technician is a dropdown from the master and saves the chosen name', async ({ page }) => {
  const state = await setup(page, ['inspection.read', 'inspection.write', 'technicians.read']);
  await page.getByRole('tab', { name: 'New inspection' }).click();
  const select = page.locator('#iqcTechnicianName');
  await expect(select).toHaveJSProperty('tagName', 'SELECT');
  await expect(select.locator('option')).toHaveText(['Select technician', 'Siva', 'Ravi']);
  await select.selectOption('Ravi');
  await page.locator('#iqcCustomerType').selectOption('B2C');
  await page.locator('#iqcCustomerName').fill('Customer');
  await page.locator('#submitInspectionCreateButton').click();
  await expect.poll(() => state.createBody?.technicianName).toBe('Ravi');
});

test('without technicians.read the dropdown is disabled instead of free text', async ({ page }) => {
  await setup(page, ['inspection.read', 'inspection.write']);
  await page.getByRole('tab', { name: 'New inspection' }).click();
  await expect(page.locator('#iqcTechnicianName')).toBeDisabled();
});
