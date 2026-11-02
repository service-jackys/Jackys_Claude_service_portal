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
  updatedAt: '2026-10-14T08:00:00.000Z',
};

async function mockPortal(page: import('@playwright/test').Page, calls: { create?: Json }) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Sales',
          email: 'sales@jackys.com',
          role: 'staff',
          permissions: ['service_job_card.read', 'quotation.read', 'quotation.write'],
        },
      });
    }
    if (url.pathname === '/api/quotations' && request.method() === 'GET') {
      return json({ quotations: [legacyQuotation] });
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
    await page.locator('#qtcCustomerName').fill('GEMS Wellington');

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
    await expect.poll(() => calls.create).toBeTruthy();
    const body = calls.create as {
      vatRate: number;
      products: Array<{ unitKey: string; location: string; complaint: string; brand: string }>;
      parts: Array<{ unitKey: string; type: string; unitPrice: number }>;
    };
    expect(body.vatRate).toBe(0.05);
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
