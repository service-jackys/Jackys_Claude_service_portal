import { expect, test } from '@playwright/test';

// Modification #332: the Overview shows the Excel figure, the portal figure and the difference with where it comes from.
test('Overview sets the Excel figure beside the portal figure and explains the difference', async ({
  page,
}) => {
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
            'revenue_dashboard.tab_overview',
            'revenue_dashboard.rate_card_edit',
          ],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/summary')
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-27T08:00:00Z' },
        summary: {
          totals: { jobs: 1185, qty: 1671, revenue: 118226.75, workbookRevenue: 124482.75 },
          options: {
            years: [2026],
            months: [],
            weeks: [],
            jobTypes: [],
            channels: [],
            costStatuses: [],
          },
          monthly: [],
          rates: [],
        },
      });
    if (url.pathname === '/api/revenue-dashboard/rate-card')
      return json({
        fridgeLogic: { repriceOlder: true },
        repriceEffect: {
          lines: 107,
          units: 212,
          change: -2265.75,
          rows: [
            {
              month: 202607,
              category: 'Freestanding Cooker',
              lines: 107,
              units: 212,
              asBooked: 0,
              current: 0,
              change: -2265.75,
            },
          ],
          detail: [],
          detailTruncated: false,
        },
      });
    if (url.pathname.startsWith('/api/revenue-dashboard/'))
      return json({ data: { rows: [], cells: [], columns: [] } });
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('u@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.evaluate(() => document.getElementById('revenueDashNav')?.click());
  const hero = page.locator('.rd-hero');
  await expect(hero).toBeVisible();
  await expect(hero.getByText('Portal figure · after portal rules')).toBeVisible();
  await expect(hero.getByText('124,482.75').first()).toBeVisible();
  await expect(hero.getByText('118,226.75').first()).toBeVisible();
  await expect(hero.getByText('−6,256.00').first()).toBeVisible();
  await expect(hero.getByText('Older rows at current rates')).toBeVisible();
  await expect(hero.getByText('−2,265.75')).toBeVisible();
  await expect(hero.getByText('−3,990.25')).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-excel-vs-portal.png', fullPage: true });
});
