import { expect, test } from '@playwright/test';

const master = {
  appliances: [
    {
      name: 'Built-in Ovn',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 650,
      active: true,
    },
    {
      name: 'Built-in Hob',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 1100,
      active: true,
    },
  ],
};

test('a saved appliance can be renamed and the save carries renamedFrom', async ({ page }) => {
  const saves: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
          permissions: ['pricing_config.read', 'pricing_config.write'],
        },
      });
    }
    if (url.pathname === '/api/pricing-config/appliance_master') {
      if (request.method() === 'PUT') {
        saves.push(request.postDataJSON());
        return json({ payload: master, isOverride: true });
      }
      return json({ payload: master, isOverride: false });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.evaluate(() => (document.querySelector('#pricingMastersNav') as HTMLElement).click());
  await page.evaluate(() => (document.querySelector('#applianceMasterNav') as HTMLElement).click());

  const name = page.locator('#applianceMasterWorkspace [data-pc-col="name"]').first();
  await expect(name).toBeEnabled();
  await name.fill('Built-in Oven');
  await page.locator('#applianceMasterWorkspace [data-pc-save]').click();
  await expect.poll(() => saves.length).toBe(1);
  const sent = saves[0] as { appliances: { name: string; renamedFrom?: string }[] };
  expect(sent.appliances[0]).toMatchObject({ name: 'Built-in Oven', renamedFrom: 'Built-in Ovn' });
  expect(sent.appliances[1]!.renamedFrom).toBeUndefined();
});
