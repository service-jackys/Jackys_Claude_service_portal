import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// A small, fixed price list so the expected totals can be worked out by hand.
const pricing = {
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
  ],
  smallJob: { callOutFee: 50, minimumCharge: 250 },
  addons: {
    'Project Management Fee': { rate: 0.05, hours: 0, note: '' },
    'Site Survey': { rate: 150, hours: 2, note: '' },
    'Testing & Commissioning': { rate: 25, hours: 0.25, note: '' },
    'Training (End User)': { rate: 750, hours: 3, note: '' },
  },
};

async function openCalculator(page: Page, saved: unknown[]) {
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
          role: 'admin',
          permissions: ['*'],
        },
      });
    }
    if (url.pathname === '/api/pricing-config/thomson_pricing') return json({ payload: pricing });
    if (url.pathname === '/api/thomson-sales' && request.method() === 'POST') {
      saved.push(request.postDataJSON());
      return json(
        { thomsonSale: { id: '9', thomsonSaleReference: 'TH-2026-00009', lineItems: [] } },
        201,
      );
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#thomsonCalcNav').click();
  await expect(page.locator('[data-tcc-add]')).toBeVisible();
}

test.describe('Thomson Quote Calculator', () => {
  test('a project quote keeps the workbook maths and shows a tier hint', async ({ page }) => {
    const saved: unknown[] = [];
    await openCalculator(page, saved);
    await expect(page.getByRole('tab', { name: 'New quote' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Issued quotes' })).toBeVisible();

    await page.locator('[data-tcc-qty]').fill('3');
    await expect(page.locator('[data-tq-tier-hint]')).toContainText('Add 47 more units');
    await page.locator('[data-tcc-add]').click();
    // 3 x 100 = 300 equipment. Services: PM 5% = 15, 1 visit = 150, testing 3 x 25 = 75 -> 240.
    await expect(page.locator('[data-tq-total]')).toContainText('540.00');
    await expect(page.locator('[data-tcc-table] tfoot')).toContainText('540.00');

    // Cost and margin are tucked away until asked for.
    await expect(page.locator('[data-tq-internal-body]')).toBeHidden();
    await page.locator('[data-tq-internal] summary').click();
    await expect(page.locator('[data-tq-internal-body]')).toBeVisible();

    // Leaving a service out lowers the price: no Site Survey -> 540 - 150 = 390.
    await page.locator('[data-tcc-addon-on="1"]').uncheck();
    await expect(page.locator('[data-tq-total]')).toContainText('390.00');
  });

  test('a single-unit quote uses the base rate, a call-out charge and the minimum', async ({
    page,
  }) => {
    const saved: unknown[] = [];
    await openCalculator(page, saved);
    await page.getByRole('radio', { name: /Single unit/ }).click();
    // Project-only inputs and the services step are gone; the call-out step shows.
    await expect(page.locator('[data-tcc-visits]')).toBeHidden();
    await expect(page.locator('[data-tcc-addons]')).toBeHidden();
    await expect(page.locator('[data-tq-callout]')).toBeVisible();

    await page.locator('[data-ths-client]').fill('Test Customer');
    await page.locator('[data-tcc-add]').click();
    // 1 x 100 + 50 call-out = 150, below the 250 minimum -> raised to 250.
    await expect(page.locator('[data-tq-total]')).toContainText('250.00');
    await expect(page.locator('[data-tq-note]')).toContainText('minimum charge');

    // Without the call-out the minimum still applies.
    await page.locator('[data-tq-callout]').uncheck();
    await expect(page.locator('[data-tq-total]')).toContainText('250.00');

    // 4 units: 400 + 50 call-out = 450, above the minimum.
    await page.locator('[data-tq-callout]').check();
    await page.locator('[data-tcc-clear]').click();
    await page.locator('[data-tcc-qty]').fill('4');
    await page.locator('[data-tcc-add]').click();
    await expect(page.locator('[data-tq-total]')).toContainText('450.00');

    await page.getByRole('button', { name: 'Save quotation' }).click();
    await expect(page.locator('[data-ths-message]')).toContainText('TH-2026-00009');
    const body = saved[0] as {
      clientName: string;
      transportSharePercent: number;
      totalPrice: number;
      lineItems: { quoteMode: string; unitRate: number }[];
    };
    expect(body.clientName).toBe('Test Customer');
    expect(body.totalPrice).toBe(450);
    expect(body.transportSharePercent).toBe(0);
    expect(body.lineItems[0]).toMatchObject({ quoteMode: 'single', unitRate: 100 });
  });

  test('switching type asks before clearing the items', async ({ page }) => {
    await openCalculator(page, []);
    await page.locator('[data-tcc-add]').click();
    let asked = false;
    page.once('dialog', (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await page.getByRole('radio', { name: /Single unit/ }).click();
    expect(asked).toBe(true);
    await expect(page.locator('[data-tq-facts]')).toContainText('Project');
  });
});
