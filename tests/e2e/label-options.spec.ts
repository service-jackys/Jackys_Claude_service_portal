import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Label settings options A to D, tick-and-print from the service job card list, and the
// Delivery + Installation Unit stickers box (modification #320).
const card = (id: string, n: number) => ({
  id,
  jobCardReference: 'JBC-2026-' + String(n).padStart(5, '0'),
  appointmentId: 'a' + id,
  appointmentReference: 'APT-2026-0000' + id,
  jobCardDate: '2026-11-25',
  serialNo: 'SN-H00' + id,
  modelNo: 'VENUS VWD5FS',
  customerName: 'JUMEIRAH COLLEGE (2)',
  customerContact: '0501234567',
  customerType: 'B2B',
  jobFinalStatus: 'Repair Completed',
  status: 'Completed',
  visitReference: 'WI-2026-00112',
  parts: [],
});

async function signIn(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { id: '1', name: 'Tester', email: 't@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/job-cards')
      return json({
        jobCards: [card('1', 301), card('2', 302), card('3', 303)],
        pagination: { page: 1, pageSize: 50, total: 3, totalPages: 1 },
      });
    const detail = /^\/api\/job-cards\/(\d+)$/.exec(url.pathname);
    if (detail) return json({ jobCard: card(detail[1], 300 + Number(detail[1])) });
    return json({});
  });
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('t@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

const settings = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('jdLabelSettings') || '{}'));

test.describe('Label settings options A to D', () => {
  test('choose option C or D, the settings are saved and shown as a badge', async ({ page }) => {
    await signIn(page);
    await page.locator('#jobCardsNav').dispatchEvent('click');
    await page.locator('#jobCardsLabelSettingsButton').click();
    const dialog = page.locator('dialog.ls-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-ls-opt]')).toHaveCount(4);
    await expect(dialog.locator('[data-ls-opt="A"]')).toHaveClass(/is-on/);

    await dialog.locator('[data-ls-opt="C"]').click();
    await expect(dialog.locator('[data-ls-extra="C"]')).toBeVisible();
    await expect(dialog.locator('[data-ls-extra="D"]')).toBeHidden();
    await dialog.locator('[data-ls-seg="perLabel"] button[data-v="8"]').click();
    await expect(dialog.locator('[data-ls-visit]')).toBeDisabled();
    await dialog.locator('[data-ls-save]').click();
    expect(await settings(page)).toMatchObject({ layout: 'C', perLabel: 8 });
    await expect(page.locator('#jobCardsLabelSettingsButton .ls-badge')).toHaveText('C');
    await expect(page.locator('#printUnitStickerButton')).toHaveText('Print barcode');

    await page.locator('#jobCardsLabelSettingsButton').click();
    await dialog.locator('[data-ls-opt="D"]').click();
    await expect(dialog.locator('[data-ls-extra="D"]')).toBeVisible();
    await dialog.locator('[data-ls-seg="sheetCells"] button[data-v="6"]').click();
    await dialog.locator('[data-ls-cell="3"]').click();
    await dialog.locator('[data-ls-save]').click();
    expect(await settings(page)).toMatchObject({ layout: 'D', sheetCells: 6, startCell: 3 });
  });

  test('tick job cards and print a barcode label (C), then a sheet from the start cell (D)', async ({
    page,
  }) => {
    await signIn(page);
    await page.evaluate(() =>
      localStorage.setItem(
        'jdLabelSettings',
        JSON.stringify({ layout: 'C', perLabel: 6, visitBarcode: true }),
      ),
    );
    await page.reload();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.locator('#jobCardsNav').dispatchEvent('click');
    await expect(page.locator('#jobCardsBody [data-jc-select]')).toHaveCount(3);

    await page.locator('#jobCardSelectAll').check();
    await expect(page.locator('#jobCardSelText')).toContainText('3 selected');
    await expect(page.locator('#jobCardSelPrint')).toHaveText('Print barcode label');
    await page.locator('#jobCardSelPrint').click();
    const confirm = page.locator('dialog.ls-confirm');
    await expect(confirm).toContainText('3 jobs');
    await expect(confirm.locator('.ls-job')).toHaveCount(3);
    const popupPromise = page.waitForEvent('popup');
    await confirm.locator('[data-ls-print]').click();
    const popup = await popupPromise;
    await expect.poll(() => popup.content()).toContain('bc-cell');
    const html = await popup.content();
    expect((html.match(/class="bc-cell"/g) || []).length).toBe(3);
    expect(html).toContain('JBC-2026-00301');
    await popup.close();

    // Option D: choose the start cell in the pop-up; the next print continues after it.
    await page.evaluate(() =>
      localStorage.setItem('jdLabelSettings', JSON.stringify({ layout: 'D', sheetCells: 8 })),
    );
    await page.reload();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.locator('#jobCardsNav').dispatchEvent('click');
    await expect(page.locator('#jobCardsBody [data-jc-select]')).toHaveCount(3);
    await page.locator('#jobCardSelectAll').check();
    await expect(page.locator('#jobCardSelPrint')).toHaveText('Print barcode stickers');
    await page.locator('#jobCardSelPrint').click();
    await expect(confirm).toContainText('A4');
    await confirm.locator('[data-ls-cell="4"]').click();
    await expect(confirm.locator('[data-ls-fill]')).toContainText('cells 4 to 6');
    const popup2Promise = page.waitForEvent('popup');
    await confirm.locator('[data-ls-print]').click();
    const popup2 = await popup2Promise;
    await expect.poll(() => popup2.content()).toContain('sh-cell');
    expect(await settings(page)).toMatchObject({ layout: 'D', startCell: 7 });
  });
});
