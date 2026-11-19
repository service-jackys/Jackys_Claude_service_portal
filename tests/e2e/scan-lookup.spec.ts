import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function mockApi(page: Page, permissions: string[]) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { name: 'Scan Tester', email: 'scan@jackys.com', role: 'staff', permissions },
      });
    }
    const card = (id: string, ref: string, date: string, extra: object = {}) => ({
      id,
      jobCardReference: ref,
      jobCardDate: date,
      serialNo: 'SN 8841-2207-0093',
      modelNo: 'Inverter AC',
      customerName: 'Sample Customer',
      jobFinalStatus: 'Repair Completed',
      status: 'Completed',
      serviceRendered: 'Replaced fan motor',
      parts: [],
      ...extra,
    });
    if (url.pathname === '/api/job-cards') {
      const search = url.searchParams.get('search') || '';
      if (search === 'JBC-2026-00412') return json({ jobCards: [card('2', search, '2026-11-12')] });
      return json({
        jobCards: [
          card('1', 'JBC-2026-00311', '2026-09-14'),
          card('2', 'JBC-2026-00412', '2026-11-12'),
          card('3', 'JBC-2025-00001', '2025-01-10'),
          card('4', 'JBC-2026-00400', '2026-11-01', { serialNo: 'OTHER' }),
        ],
      });
    }
    if (url.pathname === '/api/job-cards/2') {
      return json({ jobCard: card('2', 'JBC-2026-00412', '2026-11-12') });
    }
    if (url.pathname === '/api/di-jobs') {
      return json({
        jobs: [
          { id: '9', status: 'Completed', deliveryNoteRef: '16101023' },
          { id: '8', status: 'Cancelled', deliveryNoteRef: '16101023' },
        ],
      });
    }
    if (url.pathname === '/api/di-jobs/9') {
      return json({
        job: {
          id: '9',
          deliveryNoteRef: '16101023',
          customerName: 'Test School',
          serviceDate: '2026-03-18',
          technicianName: 'Tech One',
          lines: [
            { itemCode: 'AC-1', itemDesc: 'Split AC', brand: 'VENUS', qty: 2, type: 'CSIDI' },
            { itemCode: 'KT-1', itemDesc: 'Kettle', brand: 'VENUS', qty: 1, type: 'CSIDO' },
          ],
        },
      });
    }
    return json({});
  });
}

async function signIn(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('scan@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test.describe('scan a unit', () => {
  test('a job card number shows the unit and warns about a repeat repair on the same serial', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read', 'di_jobs.read']);
    await signIn(page);
    await page.locator('#scanLookupButton').dispatchEvent('click');
    await page.locator('#scanInput').fill('jbc-2026-00412');
    await page.locator('#scanInput').press('Enter');
    const result = page.locator('[data-scan-result]');
    await expect(result).toContainText('JBC-2026-00412');
    await expect(result).toContainText('SN 8841-2207-0093');
    await expect(result).toContainText('Repeat repair');
    await expect(result).toContainText('job 2 on this serial');
    await expect(result).toContainText('JBC-2026-00311');
    // The 2025 job and the other serial are not counted.
    await expect(result).not.toContainText('JBC-2025-00001');
  });

  test('a delivery note unit code shows brand, model, install date and warranty start', async ({
    page,
  }) => {
    await mockApi(page, ['di_jobs.read']);
    await signIn(page);
    await page.locator('#scanLookupButton').dispatchEvent('click');
    await page.locator('#scanInput').fill('16101023-3');
    await page.locator('#scanInput').press('Enter');
    const result = page.locator('[data-scan-result]');
    await expect(result).toContainText('DN 16101023 · unit 3');
    await expect(result).toContainText('DELIVERED');
    await expect(result).toContainText('Kettle');
    await page.locator('#scanInput').fill('16101023-1');
    await page.locator('#scanInput').press('Enter');
    await expect(result).toContainText('DELIVERED + INSTALLED');
    await expect(result).toContainText('Warranty starts');
    await expect(result).toContainText('2026-03-18');
    await page.locator('#scanInput').fill('16101023-9');
    await page.locator('#scanInput').press('Enter');
    await expect(result).toContainText('Nothing found');
  });

  test('the scan button is hidden without access', async ({ page }) => {
    await mockApi(page, ['complaints.read']);
    await signIn(page);
    await expect(page.locator('#scanLookupButton')).toBeHidden();
  });
});
