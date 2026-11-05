import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  amcPricingDefault,
  amcPricingV2Default,
} from '../../packages/db/src/pricing-config-defaults.js';

const master = {
  appliances: [
    {
      name: 'Built-in Oven',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 650,
      active: true,
    },
    {
      name: 'Thomson Only Hob',
      amcEnabled: false,
      thomsonEnabled: true,
      amcRefValue: 0,
      active: true,
    },
  ],
};

async function signIn(page: Page, v2: unknown) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          id: '1',
          name: 'Admin',
          email: 'admin@jackys.com',
          role: 'admin',
          permissions: ['*'],
        },
      });
    }
    if (url.pathname === '/api/pricing-config/amc_pricing_v2') return json({ payload: v2 });
    if (url.pathname === '/api/pricing-config/amc_pricing')
      return json({ payload: amcPricingDefault });
    if (url.pathname === '/api/pricing-config/appliance_master') return json({ payload: master });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
}

test.describe('AMC Quote Calculator (New)', () => {
  test('prices per appliance, applies the cap and compares with the original', async ({ page }) => {
    await signIn(page, amcPricingV2Default);
    await page.locator('#amcCalcV2Nav').click();
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    const out = page.locator('[data-v2-output]');
    await expect(out).toContainText('Total equipment value');
    await expect(out).toContainText('6500.00');
    // Basic = 10 x AED 15 retainer, under its 4% cap.
    await expect(out).toContainText('150.00');
    // Standard cap 8% x 6500 = 520 wins over the calculated 668.25.
    await expect(out).toContainText('520.00');
    await expect(out).toContainText('(applied)');
    // Call-out terms: 125 less 30% = 87.50, handling 80.
    await expect(out).toContainText('87.50');
    await expect(out).toContainText('80.00');
    await expect(page.locator('[data-v2-compare]')).toContainText('Original (excl. VAT)');
    // Only AMC-ticked appliances are offered.
    expect(await page.locator('[data-v2-select] option').allTextContents()).toEqual([
      'Built-in Oven',
    ]);
  });

  test('shows a red below-minimum-margin warning when the cap prices under cost', async ({
    page,
  }) => {
    const tight = JSON.parse(JSON.stringify(amcPricingV2Default));
    tight.plans.standard.capPct = 0.01; // 1% of value is far below cost
    await signIn(page, tight);
    await page.locator('#amcCalcV2Nav').click();
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    await expect(page.locator('[data-v2-output]')).toContainText('Below minimum margin');
    await expect(page.locator('[data-v2-output]')).toContainText('shortfall');
  });

  test('Refresh rates keeps the appliances and picks up new admin values', async ({ page }) => {
    await signIn(page, amcPricingV2Default);
    await page.locator('#amcCalcV2Nav').click();
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    await expect(page.locator('[data-v2-output]')).toContainText('Standard PMC');
    await page.locator('[data-calc-refresh]').click();
    await expect(page.locator('[data-calc-rates-note]')).toContainText('up to date');
    await expect(page.locator('[data-v2-qty="0"]')).toHaveValue('10');
  });
});

test.describe('AMC Admin Rates (New)', () => {
  test('every field has a tooltip and the page shows a calculated rate preview', async ({
    page,
  }) => {
    await signIn(page, amcPricingV2Default);
    await page.locator('#amcAdminV2Nav').dispatchEvent('click');
    const card = page.locator('[data-pc-domain="amc_pricing_v2"]');
    await expect(card).toBeVisible();
    const fields = card.locator('.field');
    const count = await fields.count();
    expect(count).toBeGreaterThan(15);
    for (let i = 0; i < count; i++) {
      const field = fields.nth(i);
      if ((await field.locator('select').count()) > 0) continue; // the preview's age picker
      await expect(field.locator('.tooltip-bubble')).toHaveCount(1);
    }
    await expect(card).toContainText('Built-in Oven');
    await expect(card).toContainText('Calculated yearly rate per appliance');
  });
});
