import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

// The D+I Quote Calculator: a separate page under Quote Calculators, priced from
// D+I Admin Entry. The API is mocked so the numbers are the default rates.
async function open(page: Page, permissions: string[]) {
  const seen: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { id: '1', name: 'User', email: 'a@jackys.com', role: 'sales', permissions },
      });
    }
    if (url.pathname === '/api/pricing-config/dandi_pricing') {
      seen.push(url.pathname);
      return json({ payload: dandiPricingDefault });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#dandiCalcNav').click();
  await expect(page.locator('#dandiCalcWorkspace [data-dc-panel]')).toBeVisible();
  return seen;
}

test('D+I Quote Calculator prices a batch, blocks short trips and prints per unit', async ({
  page,
}) => {
  await open(page, ['quote_calculators.use']);
  const root = page.locator('#dandiCalcWorkspace');
  await expect(root.locator('[data-dc-status]')).toHaveText('Not ready');
  await expect(root.locator('[data-dc-blocked]')).toHaveText('Enter appliance quantities.');

  // 10 fridges, same customer / same site, Dubai: batch 60 less 10% = 54 each + 1 trip (60).
  await root.locator('[data-dc-qty="fridge"]').fill('10');
  await expect(root.locator('[data-dc-status]')).toHaveText('Ready to quote');
  await expect(root.locator('[data-dc-total]')).toContainText('600.00');
  await expect(root.locator('[data-dc-review]')).toContainText('54.00');
  await expect(root.locator('[data-dc-facts]')).toContainText('10%');

  // 18 units need 2 trips for Delivery + Installation.
  await root.locator('[data-dc-qty="washer"]').fill('8');
  await expect(root.locator('[data-dc-status]')).toHaveText('Not ready');
  await expect(root.locator('[data-dc-blocked]')).toContainText('Required trips: 2');
  await root.locator('[data-dc-trips]').fill('2');
  await expect(root.locator('[data-dc-status]')).toHaveText('Ready to quote');

  // Installation Only has its own rates and a Yes/No transport choice.
  await root.locator('[data-dc-mode-btn="install"]').click();
  await expect(root.locator('[data-dc-transport-wrap]')).toBeVisible();

  // The proposal prints one price per unit (and a client name typed on the page).
  await root.locator('[data-dc-client]').fill('Acme Hotel');
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    root.locator('[data-dc-print]').click({ noWaitAfter: true }),
  ]);
  await expect(popup.locator('body')).toContainText('Acme Hotel');
  await expect(popup.locator('body')).toContainText('Unit price');
  await expect(popup.locator('body')).toContainText('Refrigerator');
  await expect(popup.locator('body')).toContainText('Quotation lines');
});

test('D+I Quote Calculator hides the cost view without pricing_config.read', async ({ page }) => {
  await open(page, ['quote_calculators.use']);
  await expect(page.locator('#dandiCalcWorkspace [data-dc-internal]')).toHaveCount(0);
});

test('D+I Quote Calculator shows the internal cost view to a pricing admin', async ({ page }) => {
  await open(page, ['quote_calculators.use', 'pricing_config.read']);
  const root = page.locator('#dandiCalcWorkspace');
  await root.locator('[data-dc-qty="fridge"]').fill('10');
  await root.locator('[data-dc-internal] summary').click();
  await expect(root.locator('[data-dc-internal-body]')).toContainText('Margin');
});

test('D+I Quote Calculator hides the special discount from non-admins', async ({ page }) => {
  await open(page, ['quote_calculators.use', 'pricing_config.read']);
  await expect(page.locator('#dandiCalcWorkspace [data-dc-admin]')).toHaveCount(0);
});

test('D+I Quote Calculator gives an admin an extra discount that stops at the minimum charge', async ({
  page,
}) => {
  await open(page, ['quote_calculators.use', 'pricing_config.write']);
  const root = page.locator('#dandiCalcWorkspace');
  await root.locator('[data-dc-qty="fridge"]').fill('10');
  // 10 fridges at 54 = 540 + 60 transport = 600; room under the 35 minimum = 190.
  await expect(root.locator('[data-dc-xcheck]')).toContainText('Maximum allowed');
  await expect(root.locator('[data-dc-xcheck]')).toContainText('190.00');

  await root.locator('[data-dc-xvalue]').fill('10');
  await expect(root.locator('[data-dc-xcheck]')).toContainText('Discount OK');
  await expect(root.locator('[data-dc-total]')).toContainText('546.00');
  await expect(root.locator('[data-dc-review]')).toContainText('Special discount');

  await root.locator('[data-dc-xvalue]').fill('50');
  await expect(root.locator('[data-dc-xcheck]')).toContainText('Limited to the minimum charge');
  await expect(root.locator('[data-dc-total]')).toContainText('410.00');
  await expect(root.locator('[data-dc-unit="fridge"]')).toContainText('35.00');

  await root.locator('[data-dc-xclear]').click();
  await expect(root.locator('[data-dc-total]')).toContainText('600.00');
  await root.locator('[data-dc-xmax]').click();
  await expect(root.locator('[data-dc-total]')).toContainText('410.00');

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    root.locator('[data-dc-print]').click(),
  ]);
  await expect(popup.locator('body')).toContainText('Special discount');
});
