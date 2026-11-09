import { expect, test } from '@playwright/test';

// Send ROI > Management Summary ends with the LPO pending block: quotations waiting to be invoiced,
// by the month they were created, the oldest to follow up, and the invoice check.
test('Send ROI preview shows the LPO pending block under the Management Summary', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Vysakh Raju',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: ['revenue_dashboard.read', 'revenue_dashboard.tab_reports', 'tasks.use'],
        },
      });
    }
    if (url.pathname === '/api/roi/tasks') return json({ tasks: [], owners: [] });
    if (url.pathname === '/api/roi/settings') {
      return json({ settings: { toEmails: [], ccEmails: [], signature: 'Vysakh Raju' } });
    }
    if (url.pathname === '/api/revenue-dashboard/summary') {
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-01T08:00:00Z' },
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
    }
    if (url.pathname === '/api/revenue-dashboard/group') {
      return json({
        batch: { fileName: 'master.xlsm' },
        data: {
          totals: { jobs: 5, qty: 7, revenue: 4321 },
          rows: [{ key: 'CSIJO', jobs: 5, qty: 7, revenue: 4321 }],
        },
      });
    }
    if (url.pathname === '/api/revenue-dashboard/lpo-pending-detail') {
      return json({
        count: 5,
        total: 4990,
        byStatus: { Pending: { count: 3, total: 2740 }, Approved: { count: 2, total: 2250 } },
        raisedCount: 2,
        raisedTotal: 1550,
        carriedCount: 3,
        carriedTotal: 3440,
        oldestDays: 56,
        asAt: '2026-11-09',
        byMonth: [
          { period: '2026-09', count: 1, approved: 0, total: 650, oldestDays: 56 },
          { period: '2026-10', count: 3, approved: 2, total: 2790, oldestDays: 20 },
          { period: '2026-11', count: 1, approved: 0, total: 1550, oldestDays: 5 },
        ],
        items: [
          {
            reference: 'QO-2026-00004',
            customer: 'GEMS Wellington International',
            date: '2026-09-14',
            status: 'Pending',
            days: 56,
            subtotal: 650,
          },
        ],
        moreCount: 4,
      });
    }
    if (url.pathname === '/api/revenue-dashboard/invoice-check') {
      return json({
        graceDays: 7,
        hasBatch: true,
        legacyCount: 0,
        counts: { checked: 1, matched: 0, waiting: 0, missing: 1, amountMismatch: 0 },
        rows: [{ id: '1', state: 'missing', subtotal: 400 }],
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
  await page.getByRole('button', { name: 'Send ROI' }).click();
  const frame = page.frameLocator('[data-c-frame]');
  await expect(frame.locator('body')).toContainText('Quotations awaiting invoice (LPO pending)');
  await expect(frame.locator('body')).toContainText('September 2026');
  await expect(frame.locator('body')).toContainText('November 2026');
  await expect(frame.locator('body')).toContainText('QO-2026-00004');
  await expect(frame.locator('body')).toContainText('+ 4 more quotations');
  await expect(frame.locator('body')).toContainText('1 quotation marked Invoiced is not found');
  // The preview shows the Dirham sign; the email text keeps AED.
  await expect(frame.locator('span[style*="Dirham"]').first()).toBeVisible();
});
