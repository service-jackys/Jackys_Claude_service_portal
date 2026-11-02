import { expect, test } from '@playwright/test';

type Json = Record<string, unknown>;

const quotation = (id: string, ref: string, date: string, customer: string, total: number) => ({
  id,
  quotationReference: ref,
  quotationDate: date,
  customerName: customer,
  contactNumber: '050',
  projectName: customer,
  customerType: 'B2C',
  unitCount: 1,
  jobCardCount: 0,
  grandTotal: total,
  quotationStatus: 'Pending',
  erpStatus: 'Pending invoice',
  products: [],
  parts: [],
  updatedAt: '2026-10-14T08:00:00.000Z',
});

async function signIn(page: import('@playwright/test').Page, permissions: string[]) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('finance@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  void permissions;
}

test('clicking a column heading sorts the Created quotations list, dates and numbers correctly', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Sales',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: ['quotation.read', 'quotation.write'],
        },
      });
    }
    if (url.pathname === '/api/quotations') {
      return json({
        quotations: [
          quotation('1', 'QO-2026-00010', '2026-09-29', 'Beta', 900),
          quotation('2', 'QO-2026-00002', '2026-10-21', 'Alpha', 1250.5),
          quotation('3', 'QO-2026-00011', '2026-07-28', 'Gamma', 75),
        ],
      });
    }
    return json({}, 404);
  });
  await signIn(page, []);
  const records = page.getByRole('button', { name: 'Records', exact: true });
  if ((await records.getAttribute('aria-expanded')) !== 'true') await records.click();
  await page.getByRole('button', { name: 'Quotations', exact: true }).click();
  const refs = () => page.locator('#quotationsBody tr td:first-child').allInnerTexts();
  const head = (name: string) => page.locator('th.sort-th', { hasText: name });

  await head('Quotation date').click();
  expect(await refs()).toEqual(['QO-2026-00011', 'QO-2026-00010', 'QO-2026-00002']);
  await head('Quotation date').click();
  expect(await refs()).toEqual(['QO-2026-00002', 'QO-2026-00010', 'QO-2026-00011']);
  // Numbers sort as numbers (75 < 900 < 1,250.50), not as text.
  await head('Total').click();
  expect(await refs()).toEqual(['QO-2026-00011', 'QO-2026-00010', 'QO-2026-00002']);
  // Reference sorts naturally: 2 before 10 before 11.
  await head('Reference').click();
  expect(await refs()).toEqual(['QO-2026-00002', 'QO-2026-00010', 'QO-2026-00011']);
  await expect(head('Reference')).toHaveAttribute('aria-sort', 'ascending');
  await expect(head('Total')).toHaveAttribute('aria-sort', 'none');
});

test('Budget vs Actual marks the months that have LPO pending, as information only', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Finance',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: [
            'revenue_dashboard.read',
            'revenue_dashboard.budget_actual',
            'quotation.read',
          ],
        },
      });
    }
    if (url.pathname === '/api/revenue-dashboard/budget') {
      const periods = ['2026-08', '2026-09', '2026-10', '2026-11'];
      const budget: Json[] = [];
      for (const [i, period] of periods.entries()) {
        budget.push({ period, section: 'revenue', lineItem: 'Revenue', amount: 40000 + i * 1000 });
        budget.push({ period, section: 'volume', lineItem: 'Volume', amount: 100 });
      }
      return json({
        budgetBatch: { fileName: 'budget.xlsx', uploadedAt: '2026-11-01T08:00:00Z' },
        revenueBatch: { fileName: 'master.xlsm', uploadedAt: '2026-11-01T08:00:00Z' },
        budget,
        actual: [
          { period: '2026-08', revenue: 30600, qty: 90 },
          { period: '2026-09', revenue: 20200, qty: 80 },
          { period: '2026-10', revenue: 27340, qty: 378 },
        ],
      });
    }
    if (url.pathname === '/api/revenue-dashboard/lpo-pending-by-month') {
      return json({
        months: [
          { period: '2026-09', count: 1, total: 4200 },
          { period: '2026-10', count: 3, total: 12345.5 },
        ],
      });
    }
    return json({}, 404);
  });
  await signIn(page, []);
  const management = page.getByRole('button', { name: 'Management', exact: true });
  if ((await management.getAttribute('aria-expanded')) !== 'true') await management.click();
  await page.locator('#financeNav').click();
  await page.getByRole('button', { name: 'Budget vs Actual' }).first().click();
  const canvas = page.locator('#rdc-budget');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(800);
  const sets = await page.evaluate(() => {
    const chart = (
      window as unknown as { Chart: { getChart: (id: string) => unknown } }
    ).Chart.getChart('rdc-budget') as {
      data: { datasets: { label: string; data: (number | null)[] }[] };
    };
    return chart.data.datasets.map((d) => [d.label, d.data]);
  });
  expect(sets[2][0]).toContain('LPO pending');
  // Only September and October have LPO pending; the Actual dataset is unchanged.
  expect(sets[2][1]).toEqual([null, 4200, 12345.5, null]);
  expect(sets[1][1]).toEqual([30600, 20200, 27340, 0]);
  await canvas.screenshot({ path: process.env.CHART_SHOT || 'test-results/lpo-chart.png' });
});
