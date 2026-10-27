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
  await page.locator('#stockMasterNav').dispatchEvent('click');
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
