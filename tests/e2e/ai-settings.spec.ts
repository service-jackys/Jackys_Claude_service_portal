import { expect, test, type Page } from '@playwright/test';

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

type Calls = { method: string; path: string; body: any }[];

async function signIn(page: Page, calls: Calls, ai: { available: boolean }) {
  let settings: any = {
    provider: 'anthropic',
    baseUrl: null,
    model: '',
    enabled: false,
    hasKey: false,
    keyHint: null,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestMessage: null,
    secretConfigured: true,
  };
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
    if (url.pathname === '/api/ai-settings/status') return json({ available: ai.available });
    if (url.pathname === '/api/ai-settings/test') {
      calls.push({ method: 'POST', path: url.pathname, body: null });
      settings = {
        ...settings,
        lastTestedAt: '2026-11-09T09:00:00Z',
        lastTestOk: true,
        lastTestMessage: 'Connected.',
      };
      return json({ ok: true, message: 'Connected.' });
    }
    if (url.pathname === '/api/ai-settings') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        calls.push({ method: 'PUT', path: url.pathname, body });
        settings = {
          ...settings,
          provider: body.provider,
          model: body.model,
          baseUrl: body.baseUrl ?? null,
          enabled: body.enabled,
          hasKey: body.apiKey === '' ? false : body.apiKey ? true : settings.hasKey,
          keyHint: body.apiKey ? '••••' + body.apiKey.slice(-4) : settings.keyHint,
        };
        return json({ aiSettings: settings });
      }
      return json({ aiSettings: settings });
    }
    if (url.pathname === '/api/thomson-advice') {
      calls.push({ method: 'POST', path: url.pathname, body: request.postDataJSON() });
      return json({ text: 'Adding a third technician finishes about four days sooner.' });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('admin@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test('Admin > AI settings saves a provider and key, tests it and never shows the key again', async ({
  page,
}) => {
  const calls: Calls = [];
  await signIn(page, calls, { available: false });
  await page.locator('#navGroup-management').click();
  await page.locator('#mastersNav').dispatchEvent('click');
  await page.getByRole('tab', { name: 'AI settings' }).click();
  const admin = page.locator('[data-ai-admin]');
  await expect(admin).toContainText('No key saved');

  await admin.locator('[data-ai-provider]').selectOption('openrouter');
  await expect(admin.locator('[data-ai-model]')).toHaveValue('anthropic/claude-haiku-4.5');
  await expect(admin.locator('[data-ai-note]')).toContainText('OpenRouter');
  await admin.locator('[data-ai-key]').fill('sk-or-abcdef123456');
  await admin.locator('[data-ai-enabled]').check({ force: true });
  await admin.locator('[data-ai-test]').click();
  await expect(admin).toContainText('Connected.');
  await expect(admin).toContainText('Key saved (••••3456)');
  await expect(admin.locator('[data-ai-key]')).toHaveValue('');
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(put.body).toMatchObject({
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5',
    enabled: true,
    apiKey: 'sk-or-abcdef123456',
  });
  expect(calls.some((c) => c.path === '/api/ai-settings/test')).toBe(true);

  // Saving again without typing a key keeps the stored one (no apiKey is sent).
  await admin.locator('[data-ai-save]').click();
  await expect.poll(() => calls.filter((c) => c.method === 'PUT').length).toBe(2);
  expect(calls.filter((c) => c.method === 'PUT')[1].body.apiKey).toBeUndefined();
});

test('the Thomson Smart advice offers AI wording only when AI is set up', async ({ page }) => {
  const calls: Calls = [];
  await signIn(page, calls, { available: true });
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#thomsonCalcNav').click();
  await page.locator('[data-tcc-visits]').fill('0');
  await page.locator('[data-tcc-qty]').fill('400');
  await page.locator('[data-tcc-add]').click();
  await page.locator('[data-tq-s3tab="timeline"]').click();
  // 400 ovens = 200 h at 16 h a day -> 13 days: above the 10-day guide.
  await expect(page.locator('.tl-advice')).toContainText('Deploy 3 technicians');
  await expect(page.locator('.tl-ai-text')).toHaveCount(0);
  await page.locator('.tl-switch').click();
  await expect(page.locator('.tl-ai-text')).toContainText('third technician');
  await expect(page.locator('.tl-ai-text')).toContainText('AI-worded');
  const sent = calls.find((c) => c.path === '/api/thomson-advice')!.body;
  expect(sent).toMatchObject({ projectDays: 13, thresholdDays: 10, workMode: 'continuous' });
  expect(sent.options[0]).toMatchObject({
    title: 'Deploy 3 technicians (now 2)',
    days: 9,
    withinGuard: true,
  });
  // The computed options are still shown underneath.
  await expect(page.locator('.tl-options')).toContainText('Deploy 3 technicians');
});

test('with no AI set up the Smart advice has no AI toggle', async ({ page }) => {
  await signIn(page, [], { available: false });
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#thomsonCalcNav').click();
  await page.locator('[data-tcc-visits]').fill('0');
  await page.locator('[data-tcc-qty]').fill('400');
  await page.locator('[data-tcc-add]').click();
  await page.locator('[data-tq-s3tab="timeline"]').click();
  await expect(page.locator('.tl-advice')).toContainText('Deploy 3 technicians');
  await expect(page.locator('.tl-switch')).toHaveCount(0);
});
