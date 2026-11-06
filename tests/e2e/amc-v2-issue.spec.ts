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
    if (url.pathname === '/api/amc-contracts/9/status' && method === 'PATCH') {
      const body = route.request().postDataJSON() as Json;
      const record = saved.list[0] as { plans: { planKey: string; planLabel: string }[] };
      const plan = record.plans.find((p) => p.planKey === body.planKey);
      saved.list = [
        {
          ...record,
          status: body.status,
          soldPlanKey: body.planKey,
          soldPlanLabel: plan?.planLabel,
          soldDate: body.soldDate,
        },
      ];
      return json({ amcContract: saved.list[0] });
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

    // A quote prints as a QUOTATION (all plans), not as the signed contract certificate.
    const quotePopup = page.waitForEvent('popup');
    await page.locator('[data-ac-quote]').click();
    const quote = await quotePopup;
    const quoteBody = quote.locator('body');
    await expect(quoteBody).toContainText('AMC Quotation');
    await expect(quoteBody).toContainText('AC-2026-00009');
    await expect(quoteBody).toContainText('Yearly price by plan');
    await expect(quoteBody).toContainText('Basic RM');
    await expect(quoteBody).toContainText('Standard PMC');
    await expect(quoteBody).toContainText('Premium PMC');
    await expect(quoteBody).toContainText('Call-out and repair terms');
    await expect(quoteBody).toContainText('AED 87.50 per call');
    await expect(quoteBody).toContainText('Client acceptance');
    await expect(quoteBody).not.toContainText('Approved service plan');
    // Nothing internal reaches the customer.
    await expect(quoteBody).not.toContainText('break-even');
    await expect(quoteBody).not.toContainText('cap');

    // A customer who wants only Basic RM and Standard: untick Premium and print again.
    await page.locator('[data-ac-quote-box="9"] input[value="premium-pmc"]').uncheck();
    const twoPopup = page.waitForEvent('popup');
    await page.locator('[data-ac-quote]').click();
    const two = await twoPopup;
    await expect(two.locator('body')).toContainText('Basic RM');
    await expect(two.locator('body')).toContainText('Standard PMC');
    await expect(two.locator('body')).not.toContainText('Premium PMC');
    await page.locator('[data-ac-quote-box="9"] input[value="premium-pmc"]').check();

    // No certificate while the quote is still a Quote.
    await expect(page.locator('[data-ac-reprint]')).toHaveCount(0);

    // Marking it Sold (customer approved) unlocks the certificate for the approved plan.
    await page.locator('[data-ac-plan-select="9"]').selectOption('standard-pmc');
    await page.locator('[data-ac-status="Sold"]').click();
    await expect(page.locator('[data-ac-reprint]')).toHaveCount(1);
    const certPopup = page.waitForEvent('popup');
    await page.locator('[data-ac-reprint]').click();
    const cert = await certPopup;
    await expect(cert.locator('body')).toContainText('Annual Maintenance Contract');
    await expect(cert.locator('body')).toContainText('Approved service plan');
    await expect(cert.locator('body')).toContainText('Contract pricing (per year)');
    await expect(cert.locator('body')).toContainText('Appliance age: Year 4');
  });

  test('right after saving, the calculator prints the quotation', async ({ page }) => {
    const saved = { posts: [] as Json[], listUrls: [] as string[], list: [] as Json[] };
    await open(page, saved);
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    await page.locator('[data-as-client]').fill('Acme Hotel');
    await expect(page.locator('[data-as-print]')).toHaveText('Print quotation');
    await expect(page.locator('[data-as-print]')).toBeDisabled();
    await page.locator('[data-as-save]').click();
    await expect(page.locator('[data-as-message]')).toContainText('AC-2026-00009');
    // All plans are ticked to start with; at least one must stay ticked.
    await expect(page.locator('[data-as-quote-plans] input:checked')).toHaveCount(3);
    for (const key of ['basic-rm', 'standard-pmc', 'premium-pmc']) {
      await page.locator('[data-as-quote-plans] input[value="' + key + '"]').uncheck();
    }
    await page.locator('[data-as-print]').click();
    await expect(page.locator('[data-as-message]')).toContainText('Tick at least one plan');
    await page.locator('[data-as-quote-plans] input[value="basic-rm"]').check();
    await page.locator('[data-as-quote-plans] input[value="premium-pmc"]').check();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-as-print]').click();
    const popup = await popupPromise;
    await expect(popup.locator('body')).toContainText('AMC Quotation');
    await expect(popup.locator('body')).toContainText('Acme Hotel');
    await expect(popup.locator('body')).toContainText('Basic RM');
    await expect(popup.locator('body')).toContainText('Premium PMC');
    // (Premium's own text mentions Standard PMC, so check Standard's column and plan section.)
    await expect(popup.locator('body')).not.toContainText('Standard coverage with minor parts');
    await expect(popup.locator('th', { hasText: 'Standard PMC' })).toHaveCount(0);
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
