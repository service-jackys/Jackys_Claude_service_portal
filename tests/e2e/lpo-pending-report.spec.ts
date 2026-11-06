import { expect, test } from '@playwright/test';

// The Service Revenue Dashboard > Reports > Total revenue card shows the LPO pending value in
// a coloured section: quotations still Pending / Approved with no job card. It is not revenue.
test('the Total revenue card shows LPO pending beside, not inside, the revenue figure', async ({
  page,
}) => {
  let lpoQuery = '';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Finance',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: [
            'revenue_dashboard.read',
            'revenue_dashboard.tab_reports',
            'quotation.read',
          ],
        },
      });
    }
    if (url.pathname === '/api/revenue-dashboard/summary') {
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-01T08:00:00Z' },
        summary: {
          totals: { jobs: 282, qty: 378, revenue: 27340 },
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
    }
    if (url.pathname === '/api/revenue-dashboard/lpo-pending') {
      lpoQuery = url.search;
      return json({
        count: 3,
        total: 12345.5,
        byStatus: {
          Pending: { count: 1, total: 345.5 },
          Approved: { count: 2, total: 12000 },
        },
      });
    }
    if (url.pathname.startsWith('/api/revenue-dashboard/')) return json({ data: { rows: [] } });
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('finance@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  const management = page.getByRole('button', { name: 'Management', exact: true });
  if ((await management.getAttribute('aria-expanded')) !== 'true') await management.click();
  await page.locator('#financeNav').click();
  await page.getByRole('button', { name: 'Service Revenue Dashboard' }).first().click();
  await page.getByRole('tab', { name: 'Reports' }).click();
  const card = page.locator('.rd-kpi-card', { hasText: 'Total revenue' });
  await expect(card.locator('.val')).toHaveText('\u20C3 27,340');
  await expect(card.locator('.rd-lpo')).toContainText('LPO pending');
  await expect(card.locator('.rd-lpo')).toContainText('\u20C3 12,346');
  await expect(card.locator('.rd-lpo')).toContainText('3 quotations (2 approved, 1 pending)');
  await expect(card.locator('.rd-lpo')).toContainText('not in revenue');
  expect(lpoQuery).toContain('year=2026');
  // The other cards carry no LPO section.
  await expect(page.locator('.rd-lpo')).toHaveCount(1);
  await card.screenshot({ path: process.env.LPO_SHOT || 'test-results/lpo-card.png' });
});
