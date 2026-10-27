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

test.describe('delivery and installation: comparison and salesman spellings', () => {
  test('the Compare with Excel tab lists what does not match and opens the portal job', async ({
    page,
  }) => {
    let comparedMonth = '';
    await mockApi(page, ['di_jobs.read', 'di_jobs.write', 'di_jobs.compare'], (url) => {
      if (url.pathname === '/api/di-jobs/options') {
        return { regions: ['Dubai'], salesmen: [], erpInvMandatory: false };
      }
      if (url.pathname === '/api/di-jobs/compare') {
        comparedMonth = url.searchParams.get('month') ?? '';
        const zero = { qty: 0, revenue: 0 };
        const totals = (revenue: number) => ({
          CSIDI: { qty: 2, revenue },
          CSIDO: zero,
          CSIII: zero,
          total: revenue,
        });
        return {
          month: comparedMonth,
          workbook: { fileName: 'Master.xlsm', uploadedAt: '2026-10-20T08:00:00Z' },
          summary: {
            byType: {
              CSIDI: {
                excelQty: 4,
                excelRevenue: 228,
                portalQty: 2,
                portalRevenue: 114,
                difference: -114,
              },
              CSIDO: {
                excelQty: 0,
                excelRevenue: 0,
                portalQty: 0,
                portalRevenue: 0,
                difference: 0,
              },
              CSIII: {
                excelQty: 0,
                excelRevenue: 0,
                portalQty: 0,
                portalRevenue: 0,
                difference: 0,
              },
            },
            excelTotal: 228,
            portalTotal: 114,
            difference: -114,
            counts: { match: 1, differs: 0, onlyExcel: 1, onlyPortal: 0 },
          },
          rows: [
            {
              status: 'only-excel',
              key: 'N2',
              customer: 'School B',
              date: '2026-10-06',
              excel: totals(114),
              portal: null,
              difference: -114,
              jobs: [],
              notes: ['No Completed portal job carries this delivery note or ERP Inv No.'],
            },
            {
              status: 'match',
              key: 'N1',
              customer: 'School A',
              date: '2026-10-05',
              excel: totals(114),
              portal: totals(114),
              difference: 0,
              jobs: [
                {
                  id: '5',
                  reference: 'DIJ-2026-00005',
                  serviceDate: '2026-10-05',
                  matchedBy: 'Delivery note',
                },
              ],
              notes: [],
            },
          ],
        };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#deliveryInstallNav').click();
    await page.getByRole('tab', { name: 'Compare with Excel' }).click();
    await expect(page.locator('[data-di-body]')).toContainText('Master.xlsm');
    await expect(page.locator('[data-di-body]')).toContainText('1 only in Excel');
    // Only what needs attention is listed until the matches are asked for.
    // (The worked-example picker above lists every invoice, so look at the table only.)
    const table = page.locator('[data-di-body] table', { hasText: 'Portal job' });
    await expect(table).toContainText('N2');
    // Why a row differs is in the worked example, not in a Notes column.
    await expect(table).not.toContainText('Notes');
    await expect(table).not.toContainText('No Completed portal job carries');
    await expect(table).not.toContainText('School A');
    await page.locator('#diCShowMatched').check();
    await expect(table).toContainText('School A');
    expect(comparedMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  test('the Compare tab shows a worked example for any invoice, line by line', async ({ page }) => {
    const asked: string[] = [];
    await mockApi(page, ['di_jobs.read', 'di_jobs.write', 'di_jobs.compare'], (url) => {
      if (url.pathname === '/api/di-jobs/options') {
        return { regions: ['Dubai'], salesmen: [], erpInvMandatory: false };
      }
      if (url.pathname === '/api/di-jobs/compare/example') {
        asked.push(url.searchParams.get('invoice') ?? '');
        const zero = { excelQty: 0, excelRevenue: 0, portalQty: 0, portalRevenue: 0 };
        return {
          invoice: 'N1',
          workbook: { fileName: 'Master.xlsm', uploadedAt: '2026-10-20T08:00:00Z' },
          excel: {
            invoice: 'N1',
            customer: 'School A',
            date: '2026-10-05',
            lines: [
              {
                jobType: 'CSIDI',
                item: 'FRIDGE 300L',
                qty: 2,
                revenue: 114,
                how: 'Batch rate 60 less 5% = 57 each, 2 units',
              },
            ],
            total: 114,
            notes: ['Two units on the note, so the batch rate applies.'],
          },
          jobs: [
            {
              id: '5',
              reference: 'DIJ-2026-00005',
              status: 'Completed',
              counted: true,
              basis: 'frozen',
              serviceDate: '2026-10-05',
              customerName: 'School A',
              salesman: 'Raneesh Jose',
              salesChannel: 'JDI',
              region: 'Dubai',
              deliveryNoteRef: 'N1',
              erpInvNo: null,
              note: { csidiQty: 2, csiiiQty: 0, csidoLines: 0 },
              lines: [
                {
                  lineNo: 1,
                  itemCode: 'FRG-300',
                  itemDesc: 'Fridge 300L',
                  groupName: 'FRIDGE',
                  type: 'CSIDI',
                  qty: 2,
                  installable: true,
                  pricingCategory: 'Fridge',
                  rateKind: 'batch',
                  baseRate: 60,
                  discountTier: '2-4 units',
                  discountRate: 0.05,
                  netRate: 57,
                  labour: 114,
                  transport: 0,
                  charge: null,
                  revenue: 114,
                  note: 'Batch rate 60, 5% discount, net 57.',
                },
              ],
              totals: { CSIDI: 114, CSIDO: 0, CSIII: 0, total: 114 },
              messages: [],
            },
          ],
          comparison: {
            status: 'match',
            excelTotal: 114,
            portalTotal: 114,
            difference: 0,
            byType: {
              CSIDI: { excelQty: 2, excelRevenue: 114, portalQty: 2, portalRevenue: 114 },
              CSIDO: zero,
              CSIII: zero,
            },
            notes: [],
          },
        };
      }
      if (url.pathname === '/api/di-jobs/compare') {
        const zero = { qty: 0, revenue: 0 };
        const totals = { CSIDI: { qty: 2, revenue: 114 }, CSIDO: zero, CSIII: zero, total: 114 };
        const none = {
          excelQty: 0,
          excelRevenue: 0,
          portalQty: 0,
          portalRevenue: 0,
          difference: 0,
        };
        return {
          month: url.searchParams.get('month'),
          workbook: { fileName: 'Master.xlsm', uploadedAt: '2026-10-20T08:00:00Z' },
          summary: {
            byType: {
              CSIDI: {
                excelQty: 2,
                excelRevenue: 114,
                portalQty: 2,
                portalRevenue: 114,
                difference: 0,
              },
              CSIDO: none,
              CSIII: none,
            },
            excelTotal: 114,
            portalTotal: 114,
            difference: 0,
            counts: { match: 1, differs: 0, onlyExcel: 0, onlyPortal: 0 },
          },
          rows: [
            {
              status: 'match',
              key: 'N1',
              customer: 'School A',
              date: '2026-10-05',
              excel: totals,
              portal: totals,
              difference: 0,
              jobs: [
                {
                  id: '5',
                  reference: 'DIJ-2026-00005',
                  serviceDate: '2026-10-05',
                  matchedBy: 'Delivery note',
                },
              ],
              notes: [],
            },
          ],
        };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#deliveryInstallNav').click();
    await page.getByRole('tab', { name: 'Compare with Excel' }).click();
    const body = page.locator('[data-di-body]');
    await expect(body).toContainText('Worked example');
    // Any invoice of the month can be picked, even a matching one the table hides.
    await page.locator('#diExPick').selectOption('N1');
    await expect(body).toContainText('Excel — master workbook');
    await expect(body).toContainText('Batch rate 60 less 5% = 57 each');
    await expect(body).toContainText('DIJ-2026-00005');
    await expect(body).toContainText('FRG-300');
    await expect(body).toContainText('Comparison — Matches');
    await expect(body).toContainText('To check by hand');
    expect(asked).toEqual(['N1']);
  });

  test('the Compare tab is hidden without the compare permission', async ({ page }) => {
    await mockApi(page, ['di_jobs.read'], (url) =>
      url.pathname === '/api/di-jobs/options'
        ? { regions: ['Dubai'], salesmen: [], erpInvMandatory: false }
        : undefined,
    );
    await signIn(page);
    await page.locator('#deliveryInstallNav').click();
    await expect(page.getByRole('tab', { name: 'New job' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Compare with Excel' })).toHaveCount(0);
  });

  test('Salesmen & channels lists the other spellings and adds one', async ({ page }) => {
    let posted: unknown = null;
    const aliases = [
      { id: '1', alias: 'RENEESH JOSE', salesmanId: '3', salesmanName: 'Raneesh Jose' },
    ];
    await mockApi(page, ['salesmen.read', 'salesmen.write'], (url, method, body) => {
      if (url.pathname === '/api/salesman-aliases' && method === 'GET') return { aliases };
      if (url.pathname === '/api/salesman-aliases' && method === 'POST') {
        posted = body;
        return { alias: { id: '2' } };
      }
      if (url.pathname === '/api/salesmen') {
        return { salesmen: [{ id: '3', name: 'Raneesh Jose', active: true }], total: 1 };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#masterDataNav').dispatchEvent('click');
    await expect(page.locator('#salesmanAliasBody')).toContainText('RENEESH JOSE');
    await expect(page.locator('#salesmanAliasBody')).toContainText('Raneesh Jose');
    await page.locator('#salesmanAliasText').fill('Reneesh J');
    await page.locator('#salesmanAliasSalesman').selectOption('3');
    await page.getByRole('button', { name: 'Add spelling' }).click();
    await expect.poll(() => posted).toEqual({ alias: 'Reneesh J', salesmanId: '3' });
  });
});
