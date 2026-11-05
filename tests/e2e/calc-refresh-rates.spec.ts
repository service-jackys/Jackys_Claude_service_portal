import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  vasPriceBandsDefault,
  vasPricingParamsDefault,
} from '../../packages/db/src/pricing-config-defaults';

const thomson = {
  techCount: 2,
  hoursDay: 8,
  techRate: 40,
  costPerKm: 1.5,
  regions: [{ name: 'Dubai', km: 20, roundTripCost: 60, active: true }],
  appliances: [
    {
      name: 'Built-in Hob (30 cm)',
      rates: { Base: 100, '50+': 90, '150+': 80, '300+': 70, '500+': 60 },
      avgMin: 30,
      active: true,
    },
    {
      name: 'Built-in Oven',
      rates: { Base: 200, '50+': 190, '150+': 180, '300+': 170, '500+': 160 },
      avgMin: 45,
      active: true,
    },
  ],
  smallJob: { callOutFee: 50, minimumCharge: 250 },
  addons: {
    'Project Management Fee': { rate: 0.05, hours: 0, note: '' },
    'Site Survey': { rate: 150, hours: 2, note: '' },
    'Testing & Commissioning': { rate: 25, hours: 0.25, note: '' },
    'Training (End User)': { rate: 750, hours: 3, note: '' },
  },
};

async function open(page: Page, nav: string, ready: string, rates: Record<string, unknown>) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions: ['*'] },
      });
    }
    const domain = url.pathname.replace('/api/pricing-config/', '');
    if (url.pathname.startsWith('/api/pricing-config/') && domain in rates)
      return json({ payload: rates[domain] });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator(nav).click();
  await expect(page.locator(ready)).toBeVisible();
}

test.describe('Refresh rates on the other calculators', () => {
  test('VAS: new Admin rates apply without clearing the entered price', async ({ page }) => {
    const rates: Record<string, unknown> = {
      vas_price_bands: vasPriceBandsDefault,
      vas_pricing_params: vasPricingParamsDefault,
    };
    await open(page, '#vasCalcNav', '[data-vc-order-value]', rates);
    await page.locator('[data-vc-order-value]').fill('1000');
    const before = await page.locator('[data-vc-output]').innerText();

    rates.vas_pricing_params = {
      ...vasPricingParamsDefault,
      ew1Rate: Number(vasPricingParamsDefault.ew1Rate) * 2,
      ew1MinFee: Number(vasPricingParamsDefault.ew1MinFee) * 2,
    };
    await page.locator('[data-calc-refresh]').click();
    await expect(page.locator('[data-calc-rates-note]')).toContainText('Rates updated');
    await expect(page.locator('[data-vc-order-value]')).toHaveValue('1000');
    expect(await page.locator('[data-vc-output]').innerText()).not.toBe(before);

    await page.locator('[data-calc-refresh]').click();
    await expect(page.locator('[data-calc-rates-note]')).toContainText('up to date');
  });

  test('Thomson: new rates re-price the quote lines and keep them', async ({ page }) => {
    const rates: Record<string, unknown> = { thomson_pricing: thomson };
    await open(page, '#thomsonCalcNav', '[data-tcc-add]', rates);
    await page.locator('[data-tcc-appliance]').selectOption({ label: 'Built-in Oven' });
    await page.locator('[data-tcc-qty]').fill('3');
    await page.locator('[data-tcc-add]').click();
    await expect(page.locator('[data-tq-total]')).toBeVisible();
    const before = await page.locator('[data-tq-total]').innerText();

    // Oven base rate 200 -> 300, and the Hob is switched off in Admin.
    rates.thomson_pricing = {
      ...thomson,
      appliances: [
        { ...thomson.appliances[0]!, active: false },
        {
          ...thomson.appliances[1]!,
          rates: { Base: 300, '50+': 290, '150+': 280, '300+': 270, '500+': 260 },
        },
      ],
    };
    await page.locator('[data-calc-refresh]').click();
    await expect(page.locator('[data-calc-rates-note]')).toContainText('Rates updated');
    const after = await page.locator('[data-tq-total]').innerText();
    expect(after).not.toBe(before);
    await expect(page.locator('[data-tq-lines]')).toContainText('Built-in Oven');
    const options = await page.locator('[data-tcc-appliance] option').allTextContents();
    expect(options).toEqual(['Built-in Oven']);
  });
});
