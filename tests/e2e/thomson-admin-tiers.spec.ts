import { expect, test } from '@playwright/test';

const pricing = {
  techCount: 2,
  hoursDay: 8,
  techRate: 40,
  costPerKm: 1.5,
  regions: [{ name: 'Dubai', km: 20, roundTripCost: 60, active: true }],
  appliances: [
    {
      name: 'Built-in Oven',
      rates: { Base: 100, '50+': 95, '150+': 90, '300+': 88, '500+': 85 },
      avgMin: 30,
      active: true,
    },
  ],
  addons: {
    'Project Management Fee': { rate: 0.05, hours: 0, note: '' },
    'Site Survey': { rate: 150, hours: 2, note: '' },
    'Testing & Commissioning': { rate: 25, hours: 0.25, note: '' },
    'Training (End User)': { rate: 750, hours: 3, note: '' },
  },
};

test('Thomson Pricing Admin shows and edits the volume tier rates next to Regions', async ({
  page,
}) => {
  const saves: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          id: '1',
          name: 'Admin',
          email: 'admin@jackys.com',
          role: 'staff',
          permissions: ['pricing_config.read', 'pricing_config.write'],
        },
      });
    }
    if (url.pathname === '/api/pricing-config/thomson_pricing') {
      if (request.method() === 'PUT') {
        saves.push(request.postDataJSON());
        return json({ payload: request.postDataJSON() });
      }
      return json({ payload: pricing });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#navGroup-management').click();
  await page.locator('#pricingMastersNav').click();
  await page.getByRole('button', { name: 'Thomson Pricing Admin' }).click();

  const card = page.locator('.pc-tiers-card');
  await expect(card).toBeVisible();
  const input = (col: string) => card.locator('input[data-pc-col="' + col + '"]');
  await expect(input('rates.300+')).toHaveValue('88');

  // Editing a tier is kept.
  await input('rates.300+').fill('86');
  await input('rates.300+').dispatchEvent('change');

  // Changing Base in Appliance Rates re-derives the tiers shown here.
  const base = page
    .locator('.detail-action-card', { hasText: 'Appliance Rates' })
    .locator('input[data-pc-col="rates.Base"]');
  await base.fill('200');
  await base.dispatchEvent('change');
  await expect(input('rates.500+')).toHaveValue('170');
  await expect(input('rates.300+')).toHaveValue('176');
});
