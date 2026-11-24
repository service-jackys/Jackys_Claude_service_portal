import { expect, test } from '@playwright/test';

// Modification #304: Scenario test tab on the Service Revenue Dashboard.
const result = {
  batch: { id: '1', fileName: 'master.xlsm', uploadedAt: '2026-11-24T08:00:00.000Z' },
  current: 121175.25,
  scenario: 117480,
  change: -3695.25,
  changePct: -3.05,
  byCategory: [
    {
      key: 'fridge-small',
      label: 'Refrigerator, 400 L and under',
      jobs: 87,
      units: 138,
      current: 10313.5,
      scenario: 6618.25,
      change: -3695.25,
    },
    {
      key: 'other',
      label: 'Other job types (not changed)',
      jobs: 10,
      units: 0,
      current: 110861.75,
      scenario: 110861.75,
      change: 0,
    },
  ],
  byJobType: [
    {
      key: 'CSIDI',
      label: 'CSIDI',
      jobs: 87,
      units: 138,
      current: 10313.5,
      scenario: 6618.25,
      change: -3695.25,
    },
  ],
  bySalesperson: [
    { key: 'SHIVA', label: 'SHIVA', jobs: 5, units: 20, current: 900, scenario: 500, change: -400 },
  ],
  invoiceCount: 1,
  invoices: [
    {
      invoice: '16101157',
      date: '2026-08-05',
      salesPerson: 'SHIVA',
      customer: 'CAMBRIDGE',
      jobType: 'CSIII',
      category: 'Refrigerator, 400 L and under',
      units: 8,
      litres: 400,
      litresSource: 'default',
      defaultLitres: true,
      rule: '400 L and under, 8 units: base rate, no discount tiers',
      current: 396,
      scenario: 240,
      change: -156,
    },
  ],
  fridges: {
    lines: 172,
    units: 252,
    defaultLines: 1,
    defaultUnits: 8,
    modelsNotInMaster: ['C782HQCL'],
  },
};
const cats = (b: number, s: number, m: number) => ({
  categories: [
    { category: 'Freestanding Refrigerator', batchRate: b, standardRate: s, minimumRate: m },
    { category: 'Default', batchRate: 60, standardRate: 60, minimumRate: 35 },
  ],
  discounts: [0, 0.05],
});

test('Scenario test tab runs the scenario with edited rates and shows the comparison', async ({
  page,
}) => {
  const runs: { scenario: { fridge: Record<string, unknown> } }[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: {
          name: 'U',
          email: 'u@jackys.com',
          role: 'admin',
          permissions: [
            'revenue_dashboard.read',
            'revenue_dashboard.tab_logic',
            'revenue_dashboard.export',
          ],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/scenario')
      return json({
        batch: result.batch,
        live: {
          jobRates: { CSIJW: 100, CSIJO: 119, CSIDO: 80, RWR: 60 },
          transport: { Dubai: 60, Sharjah: 90 },
          deliveryInstall: cats(60, 100, 35),
          install: cats(55, 60, 35),
        },
        customLocked: false,
        fridge: { smallBase: 30, smallOver10: 20, smallMinimum: 20, optionB: true, plugAmount: 15 },
        fridgeCategory: 'Freestanding Refrigerator',
        discountLabels: {
          deliveryInstall: ['1 unit', '2-5 units'],
          install: ['1 unit', '2-5 units'],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/scenario/run') {
      runs.push(route.request().postDataJSON());
      return json(result);
    }
    if (url.pathname === '/api/revenue-dashboard/rate-card/status') return json({ active: false });
    if (url.pathname === '/api/revenue-dashboard/summary')
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-24T08:00:00Z' },
        summary: {
          totals: { jobs: 5, qty: 7, revenue: 4321 },
          options: {
            years: [2026],
            months: [10],
            weeks: [],
            jobTypes: [],
            channels: [],
            costStatuses: [],
          },
          monthly: [],
        },
      });
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('u@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.evaluate(() => document.getElementById('revenueDashNav')?.click());
  await page.locator('.rd-subtab-btn', { hasText: 'Scenario test' }).click();
  await expect(
    page.getByText('nothing here changes your dashboard', { exact: false }),
  ).toBeVisible();
  // It ran once on open with the defaults.
  await expect(page.getByText('121,175.25').first()).toBeVisible();
  await expect(page.getByText('117,480.00').first()).toBeVisible();
  await expect(page.getByText('Default litres').first()).toBeVisible();
  expect(runs[0]!.scenario.fridge).toMatchObject({ smallBase: 30, smallOver10: 20, optionB: true });
  // Edit the base rate and switch to Option A, run again.
  await page.locator('[data-sc="fridge.smallBase"]').fill('28');
  await page.locator('[data-sc="fridge.optionB"]').selectOption('0');
  await page.locator('[data-sc-run]').click();
  await expect.poll(() => runs.length).toBe(2);
  expect(runs[1]!.scenario.fridge).toMatchObject({ smallBase: 28, optionB: false });
});
