import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  amcPricingDefault,
  amcPricingV2Default,
  vasPriceBandsDefault,
  vasPricingParamsDefault,
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

const asked: any[] = [];

async function signIn(page: Page, permissions: string[], aiOn = true) {
  asked.length = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions },
      });
    if (url.pathname === '/api/ai-settings/status') return json({ available: aiOn });
    if (url.pathname === '/api/ai-ask') {
      asked.push(request.postDataJSON());
      return json({ text: 'Standard has the best margin.\n- Basic is capped.' });
    }
    if (url.pathname === '/api/pricing-config/amc_pricing_v2')
      return json({ payload: amcPricingV2Default });
    if (url.pathname === '/api/pricing-config/amc_pricing')
      return json({ payload: amcPricingDefault });
    if (url.pathname === '/api/pricing-config/appliance_master') return json({ payload: master });
    if (url.pathname === '/api/pricing-config/vas_price_bands')
      return json({ payload: vasPriceBandsDefault });
    if (url.pathname === '/api/pricing-config/vas_pricing_params')
      return json({ payload: vasPricingParamsDefault });
    if (url.pathname === '/api/amc-contracts' && request.method() === 'GET')
      return json({
        amcContracts: [
          {
            id: '7',
            amcContractReference: 'AC-2026-00007',
            clientName: 'Secret LLC',
            contactNumber: '0501234567',
            status: 'Quote',
            revision: 2,
            totalCount: 40,
            plans: [{ planKey: 'standard', planLabel: 'Standard PMC', priceInclVat: 1234.5 }],
          },
        ],
      });
    if (url.pathname === '/api/vas-sales' && request.method() === 'GET')
      return json({
        vasSales: [
          {
            id: '3',
            vasSaleReference: 'VAS-2026-00003',
            createdAt: '2026-11-09T08:00:00Z',
            customerName: 'Secret Person',
            vasProduct: 'Extended Protection',
            sellingPrice: 2000,
            planFee: 150,
          },
        ],
      });
    if (url.pathname === '/api/pricing-config/rate_card')
      return json({ payload: { sections: [{ name: 'Delivery', rate: 40 }] } });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test.describe('Ask AI across the portal', () => {
  test('the AMC calculator can be asked about its quote, with figures only', async ({ page }) => {
    await signIn(page, ['*']);
    await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
    await page.locator('#amcCalcV2Nav').click();
    // Nothing to read yet: the button is offered and says so when asked.
    await expect(page.locator('[data-ai-launch]')).toBeVisible();
    await page.locator('[data-v2-add]').click();
    await page.locator('[data-v2-qty="0"]').fill('10');
    await expect(page.locator('[data-v2-output]')).toContainText('6500.00');

    await page.locator('[data-ai-launch]').click();
    await expect(page.locator('[data-ai-panel]')).toBeVisible();
    await expect(page.locator('[data-ai-wb-row]')).toBeHidden();
    await page.locator('[data-ai-input]').fill('Which plan is best?');
    await page.locator('[data-ai-send]').click();
    await expect(page.locator('[data-ai-body]')).toContainText('Standard has the best margin.');
    expect(asked).toHaveLength(1);
    expect(asked[0].section).toBe('amc');
    expect(asked[0].messages.at(-1)).toEqual({ role: 'user', content: 'Which plan is best?' });
    expect(asked[0].context.appliances[0]).toMatchObject({ name: 'Built-in Oven', qty: 10 });
    expect(asked[0].context.quote.totalValue).toBe(6500);
  });

  test('an admin pricing page sends the settings it shows', async ({ page }) => {
    await signIn(page, ['*']);
    await page.locator('#rateCardAdminNav').dispatchEvent('click');
    await expect(page.locator('[data-ai-launch]')).toBeVisible();
    await page.locator('[data-ai-launch]').click();
    await page.locator('[data-ai-ask]').first().click();
    await expect(page.locator('[data-ai-body]')).toContainText('Standard has the best margin.');
    expect(asked[0].section).toBe('pricing_admin');
    expect(asked[0].context.settings.rate_card.sections[0]).toEqual({ name: 'Delivery', rate: 40 });
  });

  test('a saved AMC quote can be asked about, without the client details', async ({ page }) => {
    await signIn(page, ['*']);
    await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
    await page.locator('#amcCalcV2Nav').click();
    await page.locator('[data-v2-tab="issued"]').click();
    await page.locator('[data-ai-about="7"]').click();
    await expect(page.locator('[data-ai-subject]')).toContainText('AMC contract AC-2026-00007');
    await page.locator('[data-ai-ask]').first().click();
    await expect(page.locator('[data-ai-body]')).toContainText('Standard has the best margin.');
    const sent = JSON.stringify(asked[0]);
    expect(asked[0].section).toBe('amc');
    expect(sent).toContain('AC-2026-00007');
    expect(sent).toContain('Standard PMC');
    expect(sent).not.toContain('Secret LLC');
    expect(sent).not.toContain('0501234567');
    // Back to the page itself.
    await page.locator('[data-ai-subject-clear]').click();
    await expect(page.locator('[data-ai-subject]')).not.toContainText('AC-2026-00007');
  });

  test('the VAS calculator and its issued sales can be asked about', async ({ page }) => {
    await signIn(page, ['*']);
    await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
    await page.locator('#vasCalcNav').click();
    await page.locator('[data-vc-order-value]').fill('2000');
    await page.locator('[data-ai-launch]').click();
    await page.locator('[data-ai-ask]').first().click();
    await expect(page.locator('[data-ai-body]')).toContainText('Standard has the best margin.');
    expect(asked[0].section).toBe('vas');
    expect(asked[0].context.sellingPrice).toBe(2000);
    expect(asked[0].context.plans.length).toBeGreaterThan(1);

    await page.locator('[data-ai-close]').click();
    await page.locator('[data-vc-tab="issued"]').click();
    await page.locator('[data-ai-about="3"]').click();
    await page.locator('[data-ai-ask]').first().click();
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1].title).toBe('VAS sale VAS-2026-00003');
    expect(JSON.stringify(asked[1])).not.toContain('Secret Person');
    expect(asked[1].context.planFee).toBe(150);
  });

  test('the Complaints page can be asked about, with the counts tick box', async ({ page }) => {
    await signIn(page, ['*']);
    await page.locator('#complaintsNav').dispatchEvent('click');
    await expect(page.locator('[data-ai-launch]')).toBeVisible();
    await page.locator('[data-ai-launch]').click();
    await expect(page.locator('[data-ai-wb-row]')).toBeVisible();
    await expect(page.locator('[data-ai-wb-row]')).toContainText('complaint counts');
    await page.locator('[data-ai-ask]').first().click();
    await expect(page.locator('[data-ai-body]')).toContainText('Standard has the best margin.');
    expect(asked[0].section).toBe('complaints');
    expect(asked[0].includePortalData).toBe(true);
    expect(asked[0].includeWorkbook).toBe(false);
  });

  test('the button follows the permission and the AI being set up', async ({ page }) => {
    // A role that can use the calculators but was not given Ask AI for AMC.
    await signIn(page, ['quote_calculators.use', 'pricing_config.read']);
    await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
    await page.locator('#amcCalcV2Nav').click();
    await expect(page.locator('[data-v2-add]')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-ai-launch]')).toHaveCount(0);
  });

  test('the button is hidden when the AI is not set up', async ({ page }) => {
    await signIn(page, ['*'], false);
    await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
    await page.locator('#amcCalcV2Nav').click();
    await expect(page.locator('[data-v2-add]')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-ai-launch]')).toBeHidden();
  });
});
