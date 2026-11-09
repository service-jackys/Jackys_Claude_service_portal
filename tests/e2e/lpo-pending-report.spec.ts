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
        raisedCount: 1,
        raisedTotal: 345.5,
        carriedCount: 2,
        carriedTotal: 12000,
        oldestDays: 41,
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
  await expect(card.locator('.rd-lpo')).toContainText(
    '1 raised this month, 2 carried forward (\u20C3 12,000, oldest 41 days)',
  );
  await expect(card.locator('.rd-lpo')).toContainText('not in revenue');
  expect(lpoQuery).toContain('year=2026');
  // The other cards carry no LPO section.
  await expect(page.locator('.rd-lpo')).toHaveCount(1);
  await card.screenshot({ path: process.env.LPO_SHOT || 'test-results/lpo-card.png' });
});

// Reports > Invoice check lists quotations marked Invoiced whose invoice number is not (yet) in
// the master workbook, with the days since they were marked and the 7-day grace.
test('Invoice check shows quotations marked Invoiced that are missing from the master workbook', async ({
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
          name: 'Finance',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: ['revenue_dashboard.read', 'revenue_dashboard.tab_reports'],
        },
      });
    }
    if (url.pathname === '/api/revenue-dashboard/summary') {
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-01T08:00:00Z' },
        summary: {
          totals: { jobs: 1, qty: 1, revenue: 100 },
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
    if (url.pathname === '/api/revenue-dashboard/invoice-check') {
      return json({
        graceDays: 7,
        hasBatch: true,
        legacyCount: 12,
        counts: { checked: 5, matched: 2, waiting: 1, missing: 1, amountMismatch: 1 },
        rows: [
          {
            id: '1',
            reference: 'QO-2026-00101',
            customer: 'GEMS Wellington',
            invoiceNo: 'INV-9001',
            subtotal: 400,
            invoicedAt: '2026-10-28',
            markedByName: 'Sales User',
            daysSince: 12,
            state: 'missing',
            masterRevenue: null,
            difference: null,
            amountMismatch: false,
          },
          {
            id: '2',
            reference: 'QO-2026-00102',
            customer: 'Emaar',
            invoiceNo: 'INV-9002',
            subtotal: 300,
            invoicedAt: '2026-11-05',
            markedByName: 'Sales User',
            daysSince: 4,
            state: 'matched',
            masterRevenue: 250,
            difference: -50,
            amountMismatch: true,
          },
        ],
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
  // Hovering the pill explains the check in plain words.
  await expect(page.getByRole('button', { name: 'Invoice check' })).toHaveAttribute(
    'title',
    /master workbook.*7 days/,
  );
  await page.getByRole('button', { name: 'Invoice check' }).click();
  const section = page.locator('[data-rd-report-body]');
  await expect(section).toContainText('5 checked');
  await expect(section).toContainText('1 not in master after 7 days');
  await expect(section).toContainText('12 older quotations not checked');
  await expect(section.locator('tbody tr')).toHaveCount(2);
  await expect(section.locator('tbody tr').first()).toContainText('INV-9001');
  await expect(section.locator('tbody tr').first()).toContainText('Not in master');
  await expect(section.locator('tbody tr').nth(1)).toContainText('Amount differs by');
});

// The Formatted email preview shows amounts with the Dirham sign; the email itself keeps "AED".
test('the Formatted email preview shows the Dirham sign', async ({ page }) => {
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
          permissions: ['revenue_dashboard.read', 'revenue_dashboard.tab_reports'],
        },
      });
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
    if (url.pathname === '/api/revenue-dashboard/exceptions') {
      return json({ data: { exceptions: [], totals: { revenue: 4321, jobs: 5 } } });
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
  await page.getByRole('button', { name: 'Formatted email' }).click();
  const frame = page.frameLocator('[data-rd-html-frame]');
  await expect(frame.locator('span[style*="Dirham"]').first()).toBeVisible();
  await expect(frame.locator('body')).not.toContainText('AED 4,321');
});
