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
