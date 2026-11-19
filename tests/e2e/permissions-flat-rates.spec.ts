import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dandiPricingDefault } from '../../packages/db/src/pricing-config-defaults.js';

type Handler = (url: URL, method: string, body: unknown) => unknown | undefined;

async function mockApi(page: Page, permissions: string[], handler: Handler = () => undefined) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { name: 'Access Tester', email: 'access@jackys.com', role: 'staff', permissions },
      });
    }
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const result = handler(url, request.method(), body);
    return json(result === undefined ? {} : result);
  });
}

async function signIn(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('access@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test.describe('Invoices, Billing and Quote Calculators permissions', () => {
  test('Invoices shows with invoices.read while Billing stays hidden', async ({ page }) => {
    await mockApi(page, ['service_job_card.read', 'invoices.read']);
    await signIn(page);
    await expect(page.locator('#invoicesNav')).toBeAttached();
    await expect(page.locator('#invoicesNav')).not.toHaveAttribute('hidden', /.*/);
    await expect(page.locator('#billingNav')).toHaveAttribute('hidden', /.*/);
  });

  test('Billing alone shows Billing but not Invoices', async ({ page }) => {
    await mockApi(page, ['billing.read']);
    await signIn(page);
    await expect(page.locator('#billingNav')).not.toHaveAttribute('hidden', /.*/);
    await expect(page.locator('#invoicesNav')).toHaveAttribute('hidden', /.*/);
  });

  test('The job card permission no longer opens Invoices or Billing', async ({ page }) => {
    await mockApi(page, ['service_job_card.read', 'service_job_card.write']);
    await signIn(page);
    await expect(page.locator('#invoicesNav')).toHaveAttribute('hidden', /.*/);
    await expect(page.locator('#billingNav')).toHaveAttribute('hidden', /.*/);
  });

  test('Quote calculators need only quote_calculators.use, not Pricing Masters', async ({
    page,
  }) => {
    await mockApi(page, ['quote_calculators.use']);
    await signIn(page);
    for (const id of ['#vasCalcNav', '#amcCalcV2Nav', '#thomsonCalcNav'])
      await expect(page.locator(id)).not.toHaveAttribute('hidden', /.*/);
    for (const id of ['#dandiAdminNav', '#vasAdminNav', '#pricingMastersNav'])
      await expect(page.locator(id)).toHaveAttribute('hidden', /.*/);
  });

  test('Pricing Masters access alone no longer shows the calculators', async ({ page }) => {
    await mockApi(page, ['pricing_config.read']);
    await signIn(page);
    await expect(page.locator('#vasCalcNav')).toHaveAttribute('hidden', /.*/);
    await expect(page.locator('#dandiAdminNav')).not.toHaveAttribute('hidden', /.*/);
  });
});

test('D+I Admin Entry edits the flat job-type rates and saves them with the entry', async ({
  page,
}) => {
  const captured: { saved: { flatRates?: Record<string, number> } | null } = { saved: null };
  await mockApi(page, ['pricing_config.read', 'pricing_config.write'], (url, method, body) => {
    if (url.pathname === '/api/pricing-config/dandi_pricing') {
      if (method === 'PUT' || method === 'POST') {
        captured.saved = body as typeof captured.saved;
        return { domain: 'dandi_pricing', payload: body, isOverride: true };
      }
      return { domain: 'dandi_pricing', payload: dandiPricingDefault, isOverride: false };
    }
    if (url.pathname.startsWith('/api/pricing-config/') && url.pathname.endsWith('/history'))
      return { history: [] };
    return undefined;
  });
  await signIn(page);
  await page.locator('#dandiAdminNav').dispatchEvent('click');
  const csijo = page.locator('[data-pc-path="flatRates.CSIJO"]');
  await expect(csijo).toBeVisible();
  await expect(csijo).toHaveValue('125');
  await expect(page.locator('[data-pc-path="flatRates.CSIJW"]')).toHaveValue('100');
  await expect(page.locator('[data-pc-path="flatRates.CSIDO"]')).toHaveValue('100');
  await expect(page.locator('[data-pc-path="flatRates.RWR"]')).toHaveValue('60');
  await csijo.fill('119');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect.poll(() => captured.saved?.flatRates?.CSIJO).toBe(119);
  expect(captured.saved?.flatRates).toMatchObject({ CSIJW: 100, CSIDO: 100, RWR: 60 });
});

test('D+I Admin Entry: a bigger maximum adds discount ranges and keeps the saved percentages', async ({
  page,
}) => {
  const captured: { saved: { maxUnits?: number; modes?: any } | null } = { saved: null };
  await mockApi(page, ['pricing_config.read', 'pricing_config.write'], (url, method, body) => {
    if (url.pathname === '/api/pricing-config/dandi_pricing') {
      if (method === 'PUT' || method === 'POST') {
        captured.saved = body as typeof captured.saved;
        return { domain: 'dandi_pricing', payload: body, isOverride: true };
      }
      return { domain: 'dandi_pricing', payload: dandiPricingDefault, isOverride: false };
    }
    if (url.pathname.startsWith('/api/pricing-config/') && url.pathname.endsWith('/history'))
      return { history: [] };
    return undefined;
  });
  await signIn(page);
  await page.locator('#dandiAdminNav').dispatchEvent('click');
  const maxUnits = page.locator('[data-pc-maxunits]');
  await expect(maxUnits).toBeVisible();
  const dandiNote = page.locator('[data-dandi-tier-note="dandi"]');
  await maxUnits.selectOption('100');
  await expect(dandiNote).toContainText('5 ranges were added from 51 units');
  await expect(dandiNote).toContainText('stops at 41%');
  await expect(page.locator('[data-dandi-tier-note="install"]')).toContainText('stops at 36%');
  // 10 + 5 new rows in each of the two discount tables: 7 + 5 = 12 rows each.
  const dandiCard = page.locator('.detail-action-card', { hasText: 'D+I Rates' }).last();
  await expect(dandiCard.locator('input[value="91–100 units"]')).toHaveCount(1);
  // 22% on the last range of 41-50 rises 2 points a range: 24, 26, 28, 30, 32.
  const lastRow = dandiCard.locator('tr', {
    has: page.locator('input[value="91\u2013100 units"]'),
  });
  await expect(lastRow.locator('input').last()).toHaveValue('32');
  // Going back to 50 drops them again.
  await maxUnits.selectOption('50');
  await expect(dandiNote).toContainText('Ranges now end at the maximum of 50 units');
  await expect(dandiCard.locator('input[value="91–100 units"]')).toHaveCount(0);
});
