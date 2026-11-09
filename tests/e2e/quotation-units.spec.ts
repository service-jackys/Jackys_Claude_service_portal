import { expect, test } from '@playwright/test';

type Json = Record<string, unknown>;

const legacyQuotation = {
  id: '814',
  quotationReference: 'QO-2026-00014',
  legacyReference: 'QO-014',
  customerName: 'GEMS Wellington',
  contactNumber: '0500000000',
  projectName: 'GEMS Wellington',
  quotationDate: '2026-10-14',
  // Old shape: units carry a price, labour is one amount for the whole quote.
  products: [
    {
      partNo: 'ABC1',
      description: 'Washing machine',
      qty: 1,
      unitPrice: 200,
    },
  ],
  parts: [],
  labourAmount: 100,
  vatRate: 0.05,
  subtotalAmount: 300,
  vatAmount: 15,
  grandTotal: 315,
  customerType: 'B2B',
  b2bBranchSchool: 'GEMS Wellington',
  quotationStatus: 'Pending',
  erpStatus: 'Pending invoice',
  updatedAt: '2026-10-14T08:00:00.000Z',
};

type MockOptions = {
  permissions?: string[];
  quotations?: Json[];
  // Answers a request first; return true when it did.
  handle?: (
    url: URL,
    request: import('@playwright/test').Request,
    json: (body: unknown, status?: number) => Promise<void>,
  ) => Promise<boolean>;
};

async function mockPortal(
  page: import('@playwright/test').Page,
  calls: { create?: Json },
  options: MockOptions = {},
) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (options.handle && (await options.handle(url, request, json))) return;
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Sales',
          email: 'sales@jackys.com',
          role: 'staff',
          permissions: [
            'service_job_card.read',
            'quotation.read',
            'quotation.write',
            'inspection.read',
            'inspection.write',
            ...(options.permissions ?? []),
          ],
        },
      });
    }
    if (url.pathname === '/api/quotations' && request.method() === 'GET') {
      return json({ quotations: options.quotations ?? [legacyQuotation] });
    }
    if (url.pathname === '/api/quotations' && request.method() === 'POST') {
      calls.create = request.postDataJSON() as Json;
      return json(
        { quotation: { ...legacyQuotation, id: '815', quotationReference: 'QO-2026-00015' } },
        201,
      );
    }
    if (url.pathname === '/api/quotations/814') return json({ quotation: legacyQuotation });
    if (url.pathname === '/api/quotations/815') return json({ quotation: legacyQuotation });
    if (url.pathname === '/api/b2b-branches') {
      return json({ branches: [{ branchName: 'GEMS Wellington', custCode: 'C100' }] });
    }
    if (url.pathname === '/api/quotations/814/job-card') return json({ jobCard: null });
    if (url.pathname === '/api/stock/items') {
      return json({
        items: [{ itemCode: 'VG352CSDX', itemDesc: 'VENUS GAS COOKER 3 BURNER', brand: 'VENUS' }],
      });
    }
    // Anything else the workspace loads in the background: empty, not an error that signs out.
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('sales@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  const records = page.getByRole('button', { name: 'Records', exact: true });
  await expect(records).toBeVisible();
  if ((await records.getAttribute('aria-expanded')) !== 'true') await records.click();
  await page.getByRole('button', { name: 'Quotations', exact: true }).click();
}

test.describe('quotation units, charges and VAT', () => {
  test('a multi-unit school quote keeps each unit location, complaint, charges and VAT', async ({
    page,
  }) => {
    const calls: { create?: Json } = {};
    await mockPortal(page, calls);
    await page.getByRole('tab', { name: 'New quotation' }).click();
    await page.locator('#qtcErpStatus').selectOption('Pending invoice');
    await page.locator('#qtcCustomerType').selectOption('B2B');
    await page.locator('#qtcB2bBranchSchool').fill('GEMS');
    await expect(page.locator('#qtcBranchList option')).toHaveCount(1);
    await page.locator('#qtcB2bBranchSchool').fill('GEMS Wellington');
    await page.locator('#qtcB2bBranchSchool').dispatchEvent('change');
    await expect(page.locator('#qtcCustomerName')).toHaveValue('GEMS Wellington');
    await expect(page.locator('#qtcProjectName')).toHaveValue('GEMS Wellington');

    // Unit 1: stock lookup fills description and brand, then two charges with labour on its own row.
    await page.locator('#qtcAddUnitButton').click();
    const unit1 = page.locator('#qtcUnits .q-unit').nth(0);
    await unit1.locator('[data-ufield="partNo"]').fill('VG352');
    await expect(page.locator('#qUnitCodes option')).toHaveCount(1);
    await unit1.locator('[data-ufield="partNo"]').fill('VG352CSDX');
    await expect(unit1.locator('[data-ufield="description"]')).toHaveValue(
      'VENUS GAS COOKER 3 BURNER',
    );
    await expect(unit1.locator('[data-ufield="brand"]')).toHaveValue('VENUS');
    await expect(unit1.locator('[data-ufield="partNo"]')).toHaveClass(/master-filled/);
    await unit1.locator('[data-ufield="location"]').fill('Villa 12');
    await unit1.locator('[data-ufield="complaint"]').fill('Burner 2 does not light');
    await unit1.locator('[data-cfield="type"]').first().selectOption('Part');
    await unit1.locator('[data-cfield="unitPrice"]').first().fill('100');
    await expect(unit1.locator('[data-cell="vat"]').first()).toHaveText('5.00');
    await expect(unit1.locator('[data-cell="total"]').first()).toHaveText('105.00');
    await unit1.locator('[data-add-charge]').click();
    await unit1.locator('[data-cfield="type"]').nth(1).selectOption('Labour');
    await unit1.locator('[data-cfield="unitPrice"]').nth(1).fill('50');

    // Unit 2 has its own location, complaint and a single priced line.
    await page.locator('#qtcAddUnitButton').click();
    const unit2 = page.locator('#qtcUnits .q-unit').nth(1);
    await unit2.locator('[data-ufield="location"]').fill('Apartment 3');
    await unit2.locator('[data-ufield="complaint"]').fill('No cooling');
    await unit2.locator('[data-cfield="unitPrice"]').first().fill('200');

    await expect(unit1.locator('[data-unit-sub]')).toContainText('150.00');
    await expect(unit1.locator('[data-unit-sub]')).toContainText('157.50');
    await expect(page.locator('#qtcTotals')).toContainText('350.00');
    await expect(page.locator('#qtcTotals')).toContainText('17.50');
    await expect(page.locator('#qtcTotals .q-grand')).toContainText('367.50');

    await page
      .locator('#quotationCreatePanel')
      .getByRole('button', { name: 'Save quotation' })
      .click();
    // The status popup appears on save; Approved is what allows a job card later.
    await expect(page.locator('.q-status-dialog')).toBeVisible();
    await page.locator('#qStatusSelect').selectOption('Approved');
    await page.locator('#qStatusOk').click();
    await expect.poll(() => calls.create).toBeTruthy();
    const body = calls.create as {
      vatRate: number;
      products: Array<{ unitKey: string; location: string; complaint: string; brand: string }>;
      parts: Array<{ unitKey: string; type: string; unitPrice: number }>;
    };
    expect(body.vatRate).toBe(0.05);
    expect(body).toMatchObject({
      customerType: 'B2B',
      b2bBranchSchool: 'GEMS Wellington',
      quotationStatus: 'Approved',
    });
    expect(body.products.map((u) => [u.unitKey, u.location, u.complaint])).toEqual([
      ['u1', 'Villa 12', 'Burner 2 does not light'],
      ['u2', 'Apartment 3', 'No cooling'],
    ]);
    expect(body.products[0].brand).toBe('VENUS');
    expect(body.parts.map((c) => [c.unitKey, c.type, c.unitPrice])).toEqual([
      ['u1', 'Part', 100],
      ['u1', 'Labour', 50],
      ['u2', 'Service', 200],
    ]);
  });

  test('turning VAT off removes it from the lines and the total', async ({ page }) => {
    await mockPortal(page, {});
    await page.getByRole('tab', { name: 'New quotation' }).click();
    await page.locator('#qtcAddUnitButton').click();
    const unit = page.locator('#qtcUnits .q-unit').first();
    await unit.locator('[data-cfield="unitPrice"]').first().fill('100');
    await expect(page.locator('#qtcTotals .q-grand')).toContainText('105.00');
    await page.locator('#qtcApplyVat').uncheck();
    await expect(page.locator('#qtcTotals .q-grand')).toContainText('100.00');
    await expect(unit.locator('[data-cell="vat"]').first()).toHaveText('0.00');
  });

  test('an old-format quotation opens with its labour amount and the same total', async ({
    page,
  }) => {
    await mockPortal(page, {});
    await page.getByRole('button', { name: 'QO-2026-00014' }).click();
    await expect(page.locator('#qteUnits .q-unit')).toHaveCount(1);
    // The price typed on the unit became a visible charge line; labour stays separate.
    await expect(page.locator('#qteUnits [data-charge]')).toHaveCount(1);
    await expect(page.locator('#qteLabourAmount')).toHaveValue('100');
    await expect(page.locator('#qteTotals .q-grand')).toContainText('315.00');
  });
});

test.describe('quotation customer type, status and job card', () => {
  test('customer type is required before the status popup appears', async ({ page }) => {
    await mockPortal(page, {});
    await page.getByRole('tab', { name: 'New quotation' }).click();
    await page
      .locator('#quotationCreatePanel')
      .getByRole('button', { name: 'Save quotation' })
      .click();
    // ERP / ORION status is asked first, and is red until chosen.
    await expect(page.locator('#workspaceMessage')).toContainText('ERP / ORION status');
    await expect(page.locator('#qtcErpStatus')).toHaveClass(/erp-unset/);
    await expect(page.locator('.q-status-dialog')).toHaveCount(0);
    await page.locator('#qtcErpStatus').selectOption('Invoiced');
    await expect(page.locator('#qtcErpStatus')).toHaveClass(/erp-invoiced/);
    // An Invoiced quotation also needs the ERP / ORION invoice number.
    await expect(page.locator('#qtcErpInvoiceNo')).toBeVisible();
    await page
      .locator('#quotationCreatePanel')
      .getByRole('button', { name: 'Save quotation' })
      .click();
    await expect(page.locator('#workspaceMessage')).toContainText('invoice number');
    await page.locator('#qtcErpInvoiceNo').fill('INV-1001');
    await page
      .locator('#quotationCreatePanel')
      .getByRole('button', { name: 'Save quotation' })
      .click();
    await expect(page.locator('#workspaceMessage')).toContainText('Select a customer type');
    await expect(page.locator('.q-status-dialog')).toHaveCount(0);
    // A B2C quotation has no branch to look up.
    await page.locator('#qtcCustomerType').selectOption('B2C');
    await expect(page.locator('#qtcB2bBranchSchool')).toBeDisabled();
  });

  test('B2B hides the quote-level complaint and diagnosis, B2C shows them', async ({ page }) => {
    await mockPortal(page, {});
    await page.getByRole('tab', { name: 'New quotation' }).click();
    await page.locator('#qtcCustomerType').selectOption('B2C');
    await expect(page.locator('#qtcCustomerComplaint')).toBeVisible();
    await expect(page.locator('#qtcTechnicalDiagnosis')).toBeVisible();
    await page.locator('#qtcCustomerType').selectOption('B2B');
    await expect(page.locator('#qtcCustomerComplaint')).toBeHidden();
    await expect(page.locator('#qtcTechnicalDiagnosis')).toBeHidden();
    // The units section stays, and each unit keeps its own complaint.
    await expect(page.locator('#qtcUnits')).toBeVisible();
    await page.locator('#qtcCustomerType').selectOption('B2C');
    await expect(page.locator('#qtcCustomerComplaint')).toBeVisible();
  });

  test('the list shows type, total and status, and a Pending quote cannot start a job card', async ({
    page,
  }) => {
    await mockPortal(page, {});
    const row = page.locator('#quotationsBody tr').first();
    await expect(row).toContainText('B2B');
    await expect(row).toContainText('315.00');
    await expect(row).toContainText('Pending');
    await page.getByRole('button', { name: 'QO-2026-00014' }).click();
    await expect(page.locator('#createJobCardFromQuotationButton')).toBeHidden();
    await expect(page.locator('#quotationJobCardStatus')).toContainText('Approved');
  });
});

test('inspection form has customer type and B2B lookup, without a status popup', async ({
  page,
}) => {
  let created: Json | undefined;
  await mockPortal(page, {});
  await page.route('**/api/inspections', async (route) => {
    if (route.request().method() === 'POST') {
      created = route.request().postDataJSON() as Json;
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ inspections: [] }),
    });
  });
  await page.getByRole('button', { name: 'Inspections', exact: true }).click();
  await page.getByRole('tab', { name: /New inspection/ }).click();
  await expect(page.locator('#iqcCustomerType')).toBeVisible();
  await expect(page.locator('#iqcB2bBranchSchool')).toBeVisible();
  await page
    .locator('#inspectionCreatePanel')
    .getByRole('button', { name: /Save inspection/ })
    .click();
  await expect(page.locator('#workspaceMessage')).toContainText('Select a customer type');
  await page.locator('#iqcCustomerType').selectOption('B2C');
  await page
    .locator('#inspectionCreatePanel')
    .getByRole('button', { name: /Save inspection/ })
    .click();
  await expect.poll(() => created).toBeTruthy();
  expect(created).toMatchObject({ customerType: 'B2C' });
  await expect(page.locator('.q-status-dialog')).toHaveCount(0);
});

test('a school quote shows its units and job cards, and each unit gets its own job card page', async ({
  page,
}) => {
  const school = {
    ...legacyQuotation,
    id: '900',
    quotationReference: 'QO-2026-00900',
    quotationStatus: 'Approved',
    customerComplaint: null,
    products: [1, 2, 3].map((n) => ({
      unitKey: `u${n}`,
      partNo: '',
      description: 'Split AC',
      brand: 'LG',
      serialNo: '',
      warranty: '',
      location: `Room ${n}`,
      complaint: `Not cooling ${n}`,
      diagnosis: '',
      qty: 1,
      unitPrice: 0,
    })),
    unitCount: 3,
    jobCardCount: 1,
  };
  const prefillUrls: string[] = [];
  await mockPortal(
    page,
    {},
    {
      permissions: ['service_job_card.write'],
      quotations: [school],
      handle: async (url, request, json) => {
        if (url.pathname === '/api/quotations/900') {
          await json({ quotation: school });
          return true;
        }
        if (url.pathname === '/api/quotations/900/job-card' && request.method() === 'GET') {
          await json({
            jobCard: { id: '71', jobCardReference: 'JC-1' },
            jobCards: [{ id: '71', jobCardReference: 'JC-1', quotationUnitKey: 'u1' }],
            perUnit: true,
            unitCount: 3,
            jobCardCount: 1,
            units: [
              {
                unitKey: 'u1',
                label: 'Room 1 - Split AC',
                jobCard: { id: '71', jobCardReference: 'JC-1' },
              },
              {
                unitKey: 'u2',
                label: 'Room 2 - Split AC',
                partNo: 'AC200',
                brand: 'LG',
                location: 'Room 2',
                jobCard: null,
              },
              {
                unitKey: 'u3',
                label: 'Room 3 - Split AC',
                partNo: 'AC300',
                brand: 'LG',
                location: 'Room 3',
                jobCard: null,
              },
            ],
          });
          return true;
        }
        if (url.pathname === '/api/quotations/900/job-card/prefill') {
          prefillUrls.push(url.search);
          await json({
            content: { customerName: 'GEMS Wellington', complaint: 'Not cooling 2' },
            initialJobFinalStatus: 'Customer approval pending',
          });
          return true;
        }
        return false;
      },
    },
  );
  // The list shows the unit count and how many job cards exist.
  const row = page.locator('#quotationsBody tr', { hasText: 'QO-2026-00900' });
  await expect(row).toContainText('1 of 3 created');
  await expect(row.locator('td.num').first()).toHaveText('3');
  // Opening a quotation brings the edit page into view with its job-card progress.
  await row.getByRole('button', { name: 'QO-2026-00900' }).click();
  await expect(page.locator('#quotationJobUnits')).toContainText('1 of 3 created');
  await expect(page.locator('#quotationJobUnits')).toContainText('AC200');
  await expect(page.locator('#quotationJobUnits')).not.toContainText('Split AC');
  await expect(page.locator('#quotationDetailMeta')).toContainText('3 units');
  await expect(page.locator('#quotationDetailHeading')).toBeFocused();
  // Creating a job card for unit 2 opens the Service job cards page, not the quotation page.
  await page.locator('[data-create-unit="u2"]').click();
  await expect.poll(() => prefillUrls).toEqual(['?unit=u2']);
  await expect(page.locator('#jobCardWorkspace')).toBeVisible();
  await expect(page.locator('#quotationWorkspace')).toBeHidden();
  const panel = page.locator('#jobCardWorkspace #quotationJobCardCreatePanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('unit 2 of 3');
});

test.describe('quotation list date', () => {
  test('the Created quotations table shows the quotation date and no repeated project line', async ({
    page,
  }) => {
    await mockPortal(page, {});
    const row = page.locator('#quotationsBody tr').first();
    await expect(
      page.locator('#quotationsBody').locator('xpath=ancestor::table//th').nth(1),
    ).toHaveText('Quotation date');
    await expect(row.locator('td').nth(1)).toHaveText('14 Oct 2026');
    // Project name equals the customer, so it is not repeated under the customer.
    await expect(row.locator('td').nth(2)).not.toContainText('GEMS Wellington\nGEMS Wellington');
    await expect(page.getByRole('columnheader', { name: 'Project / site' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'ERP / ORION' })).toBeVisible();
    await expect(row.locator('.erp-chip-pending')).toHaveText('Pending invoice');
  });

  test('the list shows the total of the matching quotations and updates when the ERP / ORION choice changes', async ({
    page,
  }) => {
    const queries: string[] = [];
    await mockPortal(
      page,
      {},
      {
        handle: async (url, request, json) => {
          if (url.pathname !== '/api/quotations' || request.method() !== 'GET') return false;
          queries.push(url.searchParams.get('erpStatus') ?? '');
          const invoiced = url.searchParams.get('erpStatus') === 'Invoiced';
          const pending = url.searchParams.get('erpStatus') === 'Pending invoice';
          const amount = invoiced ? 3465 : pending ? 105 : 3570;
          const count = invoiced ? 5 : pending ? 1 : 6;
          await json({
            quotations: [legacyQuotation],
            totals: { amount, subtotal: amount / 1.05 },
            pagination: { page: 1, pageSize: 50, total: count, totalPages: 1 },
          });
          return true;
        },
      },
    );
    const total = page.locator('#quotationTotalLabel');
    await expect(total).toContainText('3570.00');
    await expect(total).toContainText('Quotations6');
    await page.locator('#quotationErpFilter').selectOption('Invoiced');
    await expect(total).toContainText('3465.00');
    await expect(total).toContainText('Quotations5');
    await page.locator('#quotationErpFilter').selectOption('Pending invoice');
    await expect(total).toContainText('105.00');
    await expect(total).toContainText('Quotations1');
    await page
      .locator('#quotationTotalBar')
      .screenshot({ path: process.env.TOTAL_SHOT || 'test-results/quotation-total-bar.png' });
    expect(queries).toEqual(['', 'Invoiced', 'Pending invoice']);
  });
});
