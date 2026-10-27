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
        channel: 'JDI',
        fileName: 'jdi.xlsx',
        rowCount: 10,
        itemCount: 8,
        newItems: 8,
        changedItems: 0,
        report: {},
        uploadedBy: '1',
        uploadedByName: 'Admin',
        uploadedAt: '2026-10-20T08:00:00Z',
        hasFile: false,
      };
      return json({
        channels: [
          { channel: 'JDI', lastUpload: upload, itemCount: 8, notSeenCount: 0, positionRows: 10 },
          { channel: 'JMS', lastUpload: null, itemCount: 0, notSeenCount: 0, positionRows: 0 },
          { channel: 'TGE', lastUpload: null, itemCount: 0, notSeenCount: 0, positionRows: 0 },
        ],
        totalItems: 8,
        searchableItems: 6,
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

test('stock master offers a download per uploaded channel and for the item list', async ({
  page,
}) => {
  const calls: string[] = [];
  await mockApi(
    page,
    ['stock.read', 'stock.write'],
    [
      {
        url: '/api/stock/download?channel=JDI',
        source: 'rebuilt',
        fileName: 'Stock_JDI_rebuilt_2026-10-27.xlsx',
      },
      {
        url: '/api/stock/download?channel=items',
        source: 'rebuilt',
        fileName: 'Stock_item_master_2026-10-27.xlsx',
      },
    ],
    calls,
  );
  await signIn(page);
  await page.locator('#stockMasterNav').dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Download JDI Excel' })).toBeVisible();
  // channels with no upload offer no per-channel download
  await expect(page.getByRole('button', { name: 'Download JMS Excel' })).toHaveCount(0);

  const [channelDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JDI Excel' }).click(),
  ]);
  expect(channelDownload.suggestedFilename()).toBe('Stock_JDI_rebuilt_2026-10-27.xlsx');
  await expect(page.locator('[data-sm-dl-msg]')).toContainText(
    'rebuilt from the data the portal stored',
  );

  const [itemsDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download item list (all channels)' }).click(),
  ]);
  expect(itemsDownload.suggestedFilename()).toBe('Stock_item_master_2026-10-27.xlsx');
  expect(calls).toEqual(['/api/stock/download?channel=JDI', '/api/stock/download?channel=items']);
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
