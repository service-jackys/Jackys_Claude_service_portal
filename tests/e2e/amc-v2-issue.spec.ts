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
  ],
};

type Json = Record<string, unknown>;

async function open(page: Page, saved: { posts: Json[]; listUrls: string[]; list: Json[] }) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions: ['*'] },
      });
    }
    if (url.pathname === '/api/pricing-config/amc_pricing_v2')
      return json({ payload: amcPricingV2Default });
    if (url.pathname === '/api/pricing-config/amc_pricing')
      return json({ payload: amcPricingDefault });
    if (url.pathname === '/api/pricing-config/appliance_master') return json({ payload: master });
    if (url.pathname === '/api/amc-contracts' && method === 'POST') {
      const body = route.request().postDataJSON() as Json;
      saved.posts.push(body);
      const record = {
        id: '9',
        amcContractReference: 'AC-2026-00009',
        ...body,
        totalCount: String(body.totalCount),
        totalValue: String(body.totalValue),
        revision: 1,
        status: 'Quote',
        createdAt: '2026-11-05T08:00:00Z',
        updatedAt: '2026-11-05T08:00:00Z',
      };
      saved.list = [record];
      return json({ amcContract: record });
    }
    if (url.pathname === '/api/amc-contracts/9' && method === 'GET')
      return json({ amcContract: saved.list[0] });
    if (url.pathname === '/api/amc-contracts' && method === 'GET') {
      saved.listUrls.push(url.search);
      return json({ amcContracts: saved.list, pagination: {} });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#amcCalcV2Nav').click();
}

test.describe('AMC Quote Calculator (New): save, list and print', () => {
  test('saves a v2 quote with unit rates, lists it under AMC Issued (New) and prints it', async ({
    page,
  }) => {
    const saved = { posts: [] as Json[], listUrls: [] as string[], list: [] as Json[] };
    await open(page, saved);
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    await expect(page.locator('[data-v2-output]')).toContainText('Standard PMC');
    await page.locator('[data-as-client]').fill('Acme Hotel');
    await page.locator('[data-as-save]').click();
    await expect(page.locator('[data-as-message]')).toContainText('AC-2026-00009');

    expect(saved.posts).toHaveLength(1);
    const body = saved.posts[0] as {
      pricingModel: string;
      plans: {
        planKey: string;
        annualVisits: number;
        unitLines: { unitRate: number }[];
        callOutText: string;
        ageBand: string;
      }[];
    };
    expect(body.pricingModel).toBe('v2');
    expect(body.plans.map((p) => p.planKey)).toEqual(['basic-rm', 'standard-pmc', 'premium-pmc']);
    // planned visits per appliance, not the contract total (which would exceed the 1,000 limit)
    expect(body.plans.map((p) => p.annualVisits)).toEqual([0, 1, 2]);
    expect(body.plans[0]!.unitLines[0]!.unitRate).toBe(15);
    expect(body.plans[0]!.callOutText).toContain('AED 87.50 per call');
    expect(body.plans[1]!.callOutText).toContain('Major spare parts are extra');
    expect(body.plans[2]!.ageBand).toBe('Year 4');

    // The new list only asks for new-calculator quotes.
    await page.locator('[data-v2-tab="issued"]').click();
    await expect(page.locator('[data-v2-issued]')).toContainText('AC-2026-00009');
    expect(saved.listUrls.at(-1)).toContain('pricingModel=v2');

    // Printing shows the rate per appliance, the volume terms and the call-out terms.
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-ac-reprint]').click();
    const popup = await popupPromise;
    await expect(popup.locator('body')).toContainText('Contract pricing (per year)');
    await expect(popup.locator('body')).toContainText('Call-out and repair terms');
    await expect(popup.locator('body')).toContainText('Appliance age: Year 4');
  });

  test('the original calculator lists only original quotes', async ({ page }) => {
    const saved = { posts: [] as Json[], listUrls: [] as string[], list: [] as Json[] };
    await open(page, saved);
    await page.locator('#amcCalcNav').click();
    await page.locator('[data-ac-tab="issued"]').click();
    await expect.poll(() => saved.listUrls.length).toBeGreaterThan(0);
    expect(saved.listUrls.at(-1)).toContain('pricingModel=v1');
  });
});
