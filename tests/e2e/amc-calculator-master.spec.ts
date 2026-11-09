import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// AMC settings (appliance list now lives in the shared Appliance Master).
const amc = {
  basicPct: 0.05,
  standardPct: 0.08,
  premiumPct: 0.12,
  riskUplift: 0.25,
  overhead: 0.1,
  profitMarkup: 0.3,
  standardPartsReserve: 0.025,
  premiumPartsReserve: 0.045,
  handledPerVisit: 8,
  transportPerVisit: 100,
  salary: 4500,
  technicians: 2,
  workingDays: 26,
  hoursPerDay: 8,
  visitHours: 4,
  standardVisits: 2,
  premiumVisits: 4,
  basicVisitTiers: [[1, 4]],
};

const master = {
  appliances: [
    {
      name: 'Built-in Oven',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 650,
      active: true,
    },
    { name: 'Wine Cooler', amcEnabled: true, thomsonEnabled: true, amcRefValue: 0, active: true },
    {
      name: 'Thomson Only Hob',
      amcEnabled: false,
      thomsonEnabled: true,
      amcRefValue: 0,
      active: true,
    },
    {
      name: 'Retired Fridge',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 900,
      active: false,
    },
  ],
};

async function openCalculator(page: Page, rates: { current: typeof amc } = { current: amc }) {
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
    if (url.pathname === '/api/pricing-config/amc_pricing') return json({ payload: rates.current });
    if (url.pathname === '/api/pricing-config/appliance_master') return json({ payload: master });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#amcCalcNav').dispatchEvent('click');
  await expect(page.locator('[data-ac-add]')).toBeVisible();
}

test.describe('AMC Quote Calculator with the shared Appliance Master', () => {
  test('lists only active AMC appliances and needs no unit value', async ({ page }) => {
    await openCalculator(page);
    const options = await page.locator('[data-ac-add-select] option').allTextContents();
    expect(options).toEqual(['Built-in Oven', 'Wine Cooler']);

    await page.locator('[data-ac-add]').click();
    await expect(page.locator('th', { hasText: 'Unit value' })).toHaveCount(0);
    await page.locator('[data-ac-qty="0"]').fill('10');
    await expect(page.locator('[data-ac-output]')).toContainText('Basic RM');
    await expect(page.locator('[data-ac-output]')).toContainText('Total equipment value');
    // 10 ovens x 650 reference value
    await expect(page.locator('[data-ac-output]')).toContainText('6500.00');
  });

  test('flags an appliance with no reference value and offers an advanced override', async ({
    page,
  }) => {
    await openCalculator(page);
    await page.locator('[data-ac-add-select]').selectOption('Wine Cooler');
    await page.locator('[data-ac-add]').click();
    await expect(page.getByText('Set value')).toBeVisible();

    await page.locator('[data-ac-override]').check();
    await expect(page.getByText('Reference value (\u20C3)')).toBeVisible();
    await page.locator('[data-ac-qty="0"]').fill('4');
    await page.locator('[data-ac-price="0"]').fill('1000');
    await expect(page.locator('[data-ac-output]')).toContainText('4000.00');
  });

  test('Refresh rates reloads Admin rates without clearing the appliances', async ({ page }) => {
    const rates = { current: amc };
    await openCalculator(page, rates);
    await page.locator('[data-ac-add]').click();
    await page.locator('[data-ac-qty="0"]').fill('10');
    await expect(page.locator('[data-ac-output]')).toContainText('Basic RM');
    const before = await page.locator('[data-ac-output]').innerText();

    // Another tab saves new Admin rates (transport per visit 100 -> 500).
    rates.current = { ...amc, transportPerVisit: 500 };
    await page.locator('[data-ac-refresh]').click();
    await expect(page.locator('[data-ac-rates-note]')).toContainText('Rates updated');
    await expect(page.locator('[data-ac-qty="0"]')).toHaveValue('10');
    const after = await page.locator('[data-ac-output]').innerText();
    expect(after).not.toBe(before);

    await page.locator('[data-ac-refresh]').click();
    await expect(page.locator('[data-ac-rates-note]')).toContainText('up to date');
  });
});
