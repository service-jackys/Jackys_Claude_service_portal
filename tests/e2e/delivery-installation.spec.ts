import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Handler = (url: URL, method: string, body: unknown) => unknown | undefined;

async function mockApi(page: Page, permissions: string[], handler: Handler) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { name: 'D&I Tester', email: 'di@jackys.com', role: 'staff', permissions },
      });
    }
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const result = handler(url, request.method(), body);
    if (result !== undefined) return json(result);
    return json({}, 200);
  });
}

async function signIn(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('di@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

const fridge = {
  itemCode: 'FR-100',
  itemDesc: 'Fridge 400L',
  brand: 'VENUS',
  mainGroup: 'MDA',
  groupName: 'FRIDGE',
  subGroup: null,
  installable: true,
  pricingCategory: 'Freestanding Refrigerator',
};
const kettle = {
  itemCode: 'KT-200',
  itemDesc: 'Electric kettle',
  brand: 'VENUS',
  mainGroup: '3PL-NON ELECTRONICS',
  groupName: 'KETTLES',
  subGroup: null,
  installable: false,
  pricingCategory: null,
};

const savedJob = (status: string) => ({
  id: '5',
  reference: 'DIJ-2026-00005',
  serviceDate: '2026-10-20',
  status,
  custCode: 'C100',
  customerName: 'Test School',
  salesman: 'Raneesh Jose',
  salesChannel: 'JDI',
  region: 'Dubai',
  deliveryNoteRef: 'DN-1',
  erpInvNo: null,
  csoscNo: null,
  notes: null,
  totalCsidi: 57,
  totalCsido: 60,
  totalCsiii: 0,
  totalRevenue: 117,
  completedAt: status === 'Completed' ? '2026-10-21T08:00:00Z' : null,
  lines: [
    {
      ...fridge,
      qty: 1,
      type: 'CSIDI',
      salesChannel: 'JDI',
      netRate: 57,
      revenue: 57,
      rateNote: '',
    },
    {
      ...kettle,
      qty: 3,
      type: 'CSIDO',
      salesChannel: 'JDI',
      netRate: null,
      revenue: 60,
      rateNote: '',
    },
  ],
});

test.describe('delivery and installation', () => {
  test('enter a B2B job with a live price, warnings and completion', async ({ page }) => {
    const calls: string[] = [];
    let created: Record<string, unknown> | null = null;
    await mockApi(page, ['di_jobs.read', 'di_jobs.write'], (url, method, body) => {
      calls.push(method + ' ' + url.pathname);
      if (url.pathname === '/api/di-jobs/options') {
        return {
          regions: ['Dubai', 'Sharjah'],
          salesmen: [
            { name: 'Raneesh Jose', salesChannel: 'JDI' },
            { name: 'No Channel Sam', salesChannel: null },
          ],
          erpInvMandatory: false,
        };
      }
      if (url.pathname === '/api/di-jobs/customers') {
        return {
          customers: [{ custCode: 'C100', branchName: 'Test School', salesman: 'RANEESH JOSE' }],
        };
      }
      if (url.pathname === '/api/di-jobs/items') {
        return { items: url.searchParams.get('query')?.startsWith('ket') ? [kettle] : [fridge] };
      }
      if (url.pathname === '/api/di-jobs/price') {
        const lines = (body as { lines: { type: string; qty: number }[] }).lines;
        const revenue = lines.map((l) => (l.type === 'CSIDI' ? 57 * l.qty : 60));
        return {
          region: 'Dubai',
          ok: true,
          lines: lines.map((l, i) => ({
            type: l.type,
            qty: l.qty,
            blocked: false,
            netRate: l.type === 'CSIDI' ? 57 : null,
            revenue: revenue[i],
            note: 'rate note',
          })),
          totals: {
            CSIDI: lines.filter((l) => l.type === 'CSIDI').reduce((a, l) => a + 57 * l.qty, 0),
            CSIDO: lines.some((l) => l.type === 'CSIDO') ? 60 : 0,
            CSIII: 0,
            total: revenue.reduce((a, b) => a + b, 0),
          },
          issues: [],
        };
      }
      if (url.pathname === '/api/di-jobs' && method === 'POST') {
        created = body as Record<string, unknown>;
        return {
          job: savedJob('Draft'),
          duplicates: [
            {
              id: '4',
              reference: 'DIJ-2026-00004',
              status: 'Completed',
              serviceDate: '2026-10-19',
            },
          ],
        };
      }
      if (url.pathname === '/api/di-jobs/5' && method === 'PATCH') {
        created = body as Record<string, unknown>;
        return { job: savedJob('Draft'), duplicates: [] };
      }
      if (url.pathname === '/api/di-jobs/5/complete') {
        return { job: savedJob('Completed'), duplicates: [], warnings: [] };
      }
      return undefined;
    });
    await signIn(page);
    await expect(page.locator('#deliveryInstallNav')).toBeVisible();
    await page.locator('#deliveryInstallNav').click();
    await expect(page.getByRole('tab', { name: 'New job' })).toBeVisible();

    // Customer: picking it fills the salesman and shows the channel read-only.
    await page.locator('#diCustLookup').fill('Test');
    await page.locator('#diCustResults button').first().click();
    await expect(page.locator('[data-di-customer]')).toHaveText('Test School (C100)');
    await expect(page.locator('#diSalesman')).toHaveValue('Raneesh Jose');
    await expect(page.locator('[data-di-channel]')).toHaveText('JDI');

    // A non-installable item can only be Delivery only.
    await page.locator('#diItemSearch').fill('ket');
    await page.locator('#diItemResults button').first().click();
    const kettleType = page.locator('[data-di-type="0"]');
    await expect(kettleType.locator('option')).toHaveCount(1);
    await expect(kettleType).toHaveValue('CSIDO');

    // An installable item offers all three; Delivery only warns but is allowed.
    await page.locator('#diItemSearch').fill('fri');
    await page.locator('#diItemResults button').first().click();
    const fridgeType = page.locator('[data-di-type="1"]');
    await expect(fridgeType.locator('option')).toHaveCount(3);
    await fridgeType.selectOption('CSIDO');
    await expect(page.locator('dialog.pw-dialog[open]')).toContainText(
      'Delivery only for an installable item',
    );
    await page.locator('[data-nd-ok]').click();
    await fridgeType.selectOption('CSIDI');

    // The live price follows the lines.
    await expect(page.locator('[data-di-price]')).toContainText('Live price');
    await expect(page.locator('[data-di-price]')).toContainText('117.00');
    await page.locator('[data-di-qty="1"]').fill('2');
    await expect(page.locator('[data-di-price]')).toContainText('174.00');

    // Completing without the delivery note is stopped on screen.
    await page.locator('[data-di-complete]').click();
    await expect(page.locator('[data-error-for="diDeliveryNote"]')).toHaveText(
      'Enter the ERP delivery note.',
    );
    expect(calls).not.toContain('POST /api/di-jobs');

    // With the note it saves, completes, and shows the frozen price.
    await page.locator('#diDeliveryNote').fill('DN-1');
    await page.locator('[data-di-complete]').click();
    await expect(page.locator('[data-di-price]')).toContainText('Frozen price');
    await expect(page.getByRole('tab', { name: 'DIJ-2026-00005' })).toBeVisible();
    expect(created).toMatchObject({
      custCode: 'C100',
      salesman: 'Raneesh Jose',
      region: 'Dubai',
      deliveryNoteRef: 'DN-1',
    });
    expect(calls).toContain('POST /api/di-jobs/5/complete');
    await expect(page.locator('[data-di-complete]')).toHaveCount(0);
  });

  test('a salesman with no channel shows the contact-admin pop-up', async ({ page }) => {
    await mockApi(page, ['di_jobs.read', 'di_jobs.write'], (url) => {
      if (url.pathname === '/api/di-jobs/options') {
        return {
          regions: ['Dubai', 'Sharjah'],
          salesmen: [{ name: 'No Channel Sam', salesChannel: null }],
          erpInvMandatory: true,
        };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#deliveryInstallNav').click();
    await page.locator('#diSalesman').selectOption('No Channel Sam');
    await expect(page.locator('dialog.pw-dialog[open]')).toContainText('no sales channel');
    await page.locator('[data-nd-ok]').click();
    await expect(page.locator('[data-di-channel]')).toContainText('contact the admin');
    // The ERP Inv No is marked required when the admin switch is on.
    await expect(page.locator('label[for="diErpInv"] .required')).toBeVisible();
  });

  test('the page is hidden without the permission', async ({ page }) => {
    await mockApi(page, ['service_job_card.read'], () => undefined);
    await signIn(page);
    await expect(page.locator('#deliveryInstallNav')).toBeHidden();
  });
});
