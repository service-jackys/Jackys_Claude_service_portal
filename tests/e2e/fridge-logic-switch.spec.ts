import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const logicFixture = JSON.parse(
  readFileSync(new URL('./fixtures/revenue-logic.json', import.meta.url), 'utf8'),
);

// Modification #306: Rate card shows the Fridge pricing card; an admin saves the new / old logic switch.
const catsFor = (market: number) => ({
  categories: [
    { category: 'Freestanding Refrigerator', batchRate: 60, standardRate: market, minimumRate: 35 },
    { category: 'Default', batchRate: 60, standardRate: 60, minimumRate: 35 },
  ],
  discounts: [0, 0.05],
});
const cats = catsFor(100);
const rates = {
  jobRates: { CSIJW: 100, CSIJO: 119, CSIDO: 80, RWR: 60 },
  transport: { Dubai: 60, Sharjah: 90 },
  deliveryInstall: cats,
  install: cats,
};
const card = (enabled: boolean, portal: number) => ({
  batch: { id: '1', fileName: 'master.xlsm', uploadedAt: '2026-11-24T08:00:00.000Z' },
  workbook: rates,
  masters: rates,
  custom: null,
  active: false,
  mastersDiffer: false,
  workbookDiffersFromMasters: false,
  impact: null,
  discountLabels: { deliveryInstall: ['1 unit', '2-5 units'], install: ['1 unit', '2-5 units'] },
  fridgeLogic: {
    enabled,
    smallBase: 30,
    smallOver10: 20,
    smallMinimum: 20,
    optionB: true,
    plugAmount: 15,
    installTierBasis: 'invoice',
  },
  tierEffect: { lines: 40, differing: 20, workbook: 8995, invoice: 8060.75, line: 8561.75 },
  figures: { workbook: 93617, portal },
});

test('Rate card shows the fridge pricing card and saves the switch', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
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
            'revenue_dashboard.rate_card_edit',
          ],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/fridge-logic') {
      saves.push(route.request().postDataJSON());
      return json(card(false, 92777));
    }
    if (url.pathname === '/api/revenue-dashboard/logic') return json(logicFixture);
    if (url.pathname === '/api/revenue-dashboard/rate-card') return json(card(true, 92335.75));
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
  await page.locator('.rd-subtab-btn', { hasText: 'Rate card' }).click();
  await expect(page.getByText('New logic in force')).toBeVisible();
  await expect(page.getByText('92,335.75')).toBeVisible();
  await expect(page.getByText('93,617')).toBeVisible();
  await page.getByLabel('Old logic').check();
  await page.getByRole('button', { name: 'Save & recalculate' }).click();
  await expect(page.getByText('Old logic in force')).toBeVisible();
  expect(saves[0]).toMatchObject({ enabled: false, smallBase: 30, plugAmount: 15 });
});

test('Logic applied notes read every rate from the Rate card', async ({ page }) => {
  const market = 120;
  const body = {
    ...card(true, 92335.75),
    workbook: { ...rates, deliveryInstall: catsFor(market) },
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: {
          name: 'U',
          email: 'u@jackys.com',
          role: 'admin',
          permissions: ['revenue_dashboard.read', 'revenue_dashboard.tab_logic'],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/logic') return json(logicFixture);
    if (url.pathname === '/api/revenue-dashboard/rate-card') return json(body);
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
  await page.locator('.rd-subtab-btn', { hasText: 'Logic applied' }).click();
  await expect(page.getByText('How fridges are priced')).toBeVisible();
  await expect(page.getByText('Worked examples')).toBeVisible();
  // 1 fridge pays the market rate of the Rate card (120), 12 fridges = 10 x 30 + 2 x 20 = 340.
  await expect(page.locator('.rl-rate', { hasText: '120' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '340.00' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '120.00' }).first()).toBeVisible();
});

test('Rate card saves the installation-only tier basis and keeps the fridge settings', async ({
  page,
}) => {
  const saves: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
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
            'revenue_dashboard.rate_card_edit',
          ],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/fridge-logic') {
      const body = route.request().postDataJSON();
      saves.push(body);
      return json({
        ...card(true, 92777),
        fridgeLogic: { ...card(true, 1).fridgeLogic, installTierBasis: body.installTierBasis },
      });
    }
    if (url.pathname === '/api/revenue-dashboard/logic') return json(logicFixture);
    if (url.pathname === '/api/revenue-dashboard/rate-card') return json(card(true, 92335.75));
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
  await page.locator('.rd-subtab-btn', { hasText: 'Rate card' }).click();
  await expect(page.getByText('Installation-only (CSIII) discount tiers')).toBeVisible();
  await expect(page.getByLabel(/Whole invoice \(portal rule\)/)).toBeChecked();
  await expect(page.getByText('8,060.75')).toBeVisible();
  await page.getByLabel(/Each line on its own/).check();
  await page.getByRole('button', { name: 'Update tier basis' }).click();
  await expect(page.getByText(/Installation-only tier basis saved \(each line\)/)).toBeVisible();
  expect(saves[0]).toMatchObject({
    installTierBasis: 'line',
    smallBase: 30,
    plugAmount: 15,
    enabled: true,
  });
});

test('Logic applied shows the portal figure, capacity and the workbook figure beside each line', async ({
  page,
}) => {
  const fixture = JSON.parse(JSON.stringify(logicFixture));
  fixture.data.example = {
    invoice: '16101431',
    customer: 'GEMS FOUNDERS SCHOOLS INTERNATIONAL (L.L.C)',
    date: '2026-10-12',
    refDocNo: null,
    custCode: null,
    lines: [
      {
        jobType: 'CSIDI',
        item: 'Freestanding Refrigerator - VG352CS',
        qty: 2,
        revenue: 60,
        how: '2 x AED 30 \u2014 400 L and under, 2 units: base rate, no discount tiers',
        capacity: '350 L (400 L and under)',
        workbook: 114,
        workbookHow: '2 x AED 57 (batch rate AED 60 less 5% volume discount)',
      },
    ],
    total: 60,
    workbookTotal: 114,
    notes: [],
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: {
          name: 'U',
          email: 'u@jackys.com',
          role: 'admin',
          permissions: ['revenue_dashboard.read', 'revenue_dashboard.tab_logic'],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/logic') return json(fixture);
    if (url.pathname === '/api/revenue-dashboard/rate-card') return json(card(true, 92335.75));
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
  await page.locator('.rd-subtab-btn', { hasText: 'Logic applied' }).click();
  const ex = page.locator('.rl-example').first();
  await expect(ex.getByRole('columnheader', { name: /Capacity/ })).toBeVisible();
  await expect(ex.getByRole('columnheader', { name: /Workbook shows/ })).toBeVisible();
  await expect(ex.getByText('350 L (400 L and under)')).toBeVisible();
  await expect(
    ex.getByText('2 x AED 57 (batch rate AED 60 less 5% volume discount)'),
  ).toBeVisible();
  await expect(ex.getByRole('cell', { name: '114.00' }).first()).toBeVisible();
  await expect(ex.getByRole('cell', { name: '60.00' }).first()).toBeVisible();
});
