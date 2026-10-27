import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function mockApi(
  page: Page,
  permissions: string[],
  downloads: { url: string; source: 'original' | 'rebuilt'; fileName: string }[],
  calls: string[],
) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { name: 'Master Tester', email: 'md@jackys.com', role: 'admin', permissions },
      });
    }
    const hit = downloads.find((entry) => url.pathname + url.search === entry.url);
    if (hit) {
      calls.push(hit.url);
      return route.fulfill({
        status: 200,
        contentType: XLSX,
        headers: {
          'content-disposition': `attachment; filename="${hit.fileName}"`,
          'x-download-source': hit.source,
        },
        body: 'xlsx-bytes',
      });
    }
    if (url.pathname === '/api/stock/status') {
      const upload = {
        id: '1',
        fileName: 'ItemListing.xlsx',
        rowCount: 121617,
        itemCount: 88850,
        newItems: 88850,
        changedItems: 0,
        report: {},
        uploadedBy: '1',
        uploadedByName: 'Admin',
        uploadedAt: '2026-10-20T08:00:00Z',
        hasFile: true,
      };
      return json({
        lastUpload: upload,
        totalItems: 88852,
        searchableItems: 15284,
        notInFileCount: 2,
        recentUploads: [upload],
      });
    }
    if (url.pathname === '/api/b2b-master/status') {
      const upload = {
        id: '3',
        fileName: 'customers.xlsx',
        rowCount: 612,
        customerCount: 610,
        newCustomers: 3,
        changedCustomers: 1,
        report: {
          warnings: ['Salesman "X" (2 customers) is not in Salesmen & channels.'],
          warningCount: 1,
        },
        uploadedBy: '1',
        uploadedByName: 'Admin',
        uploadedAt: '2026-10-27T08:00:00Z',
        hasFile: true,
      };
      return json({
        lastUpload: upload,
        totalCustomers: 610,
        withoutSalesman: 0,
        withoutChannel: 4,
        notInFileCount: 5,
        recentUploads: [upload],
      });
    }
    if (url.pathname === '/api/b2b-branches') {
      const term = url.searchParams.get('query') ?? '';
      calls.push('search:' + term);
      return json({
        branches: [
          {
            custCode: '191065',
            branchName: 'GEMS Wellington International School',
            salesman: 'Raneesh Jose',
            salesChannel: 'JDI',
            lastSalesOrderNumber: 'SO-77',
          },
        ],
      });
    }
    if (url.pathname === '/api/revenue-dashboard/summary') {
      return json({
        batch: {
          id: '42',
          kind: 'revenue',
          fileName: 'Master.xlsm',
          rowCount: 120,
          totalAmount: '98765',
          uploadedAt: '2026-10-19T08:00:00Z',
          hasFile: true,
        },
      });
    }
    return json({}, 200);
  });
}

async function signIn(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('md@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test('stock master offers one download of the uploaded item listing', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(
    page,
    ['stock.read', 'stock.write'],
    [
      {
        url: '/api/stock/download',
        source: 'original',
        fileName: 'ItemListing.xlsx',
      },
    ],
    calls,
  );
  await signIn(page);
  await page.locator('#mastersNav').dispatchEvent('click');
  await expect(page.locator('.rcv-banner')).toContainText('88,852 items');
  await expect(page.getByText('2 item(s) not in the latest file (kept)')).toBeVisible();
  // one master: no channel cards, no channel picker
  await expect(page.locator('[data-sm-channel]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Excel' })).toHaveCount(1);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Excel' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ItemListing.xlsx');
  await expect(page.locator('[data-sm-dl-msg]')).toContainText('exactly as uploaded');
  expect(calls).toEqual(['/api/stock/download']);
});

test('Admin > Masters has Stock master and Customers tabs; customers download and look up by code', async ({
  page,
}) => {
  const calls: string[] = [];
  await mockApi(
    page,
    ['stock.read', 'stock.write', 'b2b_master.write'],
    [
      {
        url: '/api/b2b-master/download',
        source: 'rebuilt',
        fileName: 'B2B_customers_2026-10-27.xlsx',
      },
    ],
    calls,
  );
  await signIn(page);
  await page.locator('#mastersNav').dispatchEvent('click');
  await expect(page.getByRole('tab', { name: 'Stock master' })).toBeVisible();
  await expect(page.locator('.rcv-banner')).toContainText('88,852 items');
  await page.getByRole('tab', { name: 'Customers' }).click();
  await expect(page.locator('.rcv-banner')).toContainText('610 customers');
  await expect(page.getByText('5 customer(s) not in the latest file (kept)')).toBeVisible();
  await expect(page.getByText('Salesman "X" (2 customers)')).toBeAttached();

  // The lookup finds a customer by its code.
  await page.locator('#b2bMasterSearch').fill('191065');
  await expect(page.locator('[data-b2b-hits]')).toContainText(
    'GEMS Wellington International School',
  );
  await expect.poll(() => calls.includes('search:191065')).toBe(true);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download customer master' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('B2B_customers_2026-10-27.xlsx');
  await expect(page.locator('[data-b2b-dl-msg]')).toContainText('every customer in the master');
});

test('Masters shows only the tabs the user may use', async ({ page }) => {
  await mockApi(page, ['stock.read', 'stock.write'], [], []);
  await signIn(page);
  await page.locator('#mastersNav').dispatchEvent('click');
  await expect(page.getByRole('tab', { name: 'Stock master' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Customers' })).toHaveCount(0);
});

test('revenue dashboard banner offers the uploaded workbook to admins only', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(
    page,
    ['revenue_dashboard.read', 'revenue_dashboard.write'],
    [
      {
        url: '/api/revenue-dashboard/import/42/download',
        source: 'original',
        fileName: 'Master.xlsm',
      },
    ],
    calls,
  );
  await signIn(page);
  await page.locator('#revenueDashNav').dispatchEvent('click');
  const button = page.getByRole('button', { name: 'Download Excel' });
  await expect(button).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('Master.xlsm');
  await expect(page.locator('[data-rd-dl-msg]')).toContainText('exactly as uploaded');
});

test('revenue dashboard banner hides the download without the upload permission', async ({
  page,
}) => {
  await mockApi(page, ['revenue_dashboard.read'], [], []);
  await signIn(page);
  await page.locator('#revenueDashNav').dispatchEvent('click');
  await expect(page.locator('.rd-banner').first()).toContainText('Master.xlsm');
  await expect(page.getByRole('button', { name: 'Download Excel' })).toHaveCount(0);
});
