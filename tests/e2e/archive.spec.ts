import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  amcPricingDefault,
  amcPricingV2Default,
} from '../../packages/db/src/pricing-config-defaults.js';

async function signIn(page: Page, permissions: string[]) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions },
      });
    if (url.pathname === '/api/pricing-config/amc_pricing')
      return json({ payload: amcPricingDefault });
    if (url.pathname === '/api/pricing-config/amc_pricing_v2')
      return json({ payload: amcPricingV2Default });
    if (url.pathname === '/api/pricing-config/appliance_master')
      return json({
        payload: {
          appliances: [
            {
              name: 'Built-in Oven',
              amcEnabled: true,
              thomsonEnabled: true,
              amcRefValue: 650,
              active: true,
            },
          ],
        },
      });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test.describe('Admin Archive', () => {
  test('the original AMC pages leave the menu and open from the Archive', async ({ page }) => {
    await signIn(page, ['*']);
    await expect(page.locator('#amcCalcNav')).toBeHidden();
    await expect(page.locator('#amcAdminNav')).toBeHidden();
    await expect(page.locator('#amcCalcV2Nav')).toBeAttached();

    await page.locator('#archiveNav').dispatchEvent('click');
    const root = page.locator('[data-calc-root="archive"]');
    await expect(root).toContainText('AMC Quote Calculator (original)');
    await expect(root).toContainText('AMC Admin Rate Section (original)');

    await root.locator('[data-archive-open="amc-calc"]').click();
    await expect(page.locator('[data-ac-add]')).toBeVisible();
    await expect(page.locator('#workspaceDescription')).toContainText('Archived page');

    await page.locator('#archiveNav').dispatchEvent('click');
    await root.locator('[data-archive-open="amc-admin"]').click();
    await expect(page.locator('#amcAdminWorkspace')).toBeVisible();
  });

  test('a role without archive.view never sees the Archive', async ({ page }) => {
    await signIn(page, ['quote_calculators.use', 'pricing_config.read']);
    await expect(page.locator('#archiveNav')).toBeHidden();
    await expect(page.locator('#amcCalcNav')).toBeHidden();
  });
});
