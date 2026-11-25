import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Api = { visitBodies: any[]; settingsPuts: any[]; serialChecks: any[] };

async function signIn(page: Page, options: { openSerials?: string[] } = {}): Promise<Api> {
  const api: Api = { visitBodies: [], settingsPuts: [], serialChecks: [] };
  const openSerials = options.openSerials ?? [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/job-cards/walk-in/settings') {
      if (request.method() === 'PUT') {
        api.settingsPuts.push(request.postDataJSON());
        return json({
          maxUnitsPerVisit: request.postDataJSON().maxUnitsPerVisit,
          updatedAt: '2026-11-25T10:00:00Z',
          updatedByName: 'Admin',
        });
      }
      return json({ maxUnitsPerVisit: 10, updatedAt: null, updatedByName: null });
    }
    if (url.pathname === '/api/job-cards/walk-in/contact-check')
      return json({ complaints: [], appointments: [], walkIns: [] });
    if (url.pathname === '/api/job-cards/walk-in/serial-check') {
      const body = request.postDataJSON();
      api.serialChecks.push(body);
      return json({
        openJobCards: body.serials
          .filter((serial: string) => openSerials.includes(serial))
          .map((serial: string) => ({
            serial: serial.toUpperCase(),
            reference: 'JBC-2026-00201',
            status: 'WIP',
          })),
        others: [],
      });
    }
    if (url.pathname === '/api/job-cards/walk-in/visit') {
      const body = request.postDataJSON();
      api.visitBodies.push(body);
      let n = 0;
      const jobCards: any[] = [];
      for (const line of body.lines) {
        for (let i = 0; i < line.quantity; i += 1) {
          n += 1;
          const unit = line.units?.[i] ?? {};
          jobCards.push({
            id: String(900 + n),
            jobCardReference: `JBC-2026-${String(300 + n).padStart(5, '0')}`,
            visitReference: 'WI-2026-00012',
            visitUnitNo: n,
            customerName: body.customerName,
            brand: line.brand ?? null,
            modelNo: line.modelNo ?? null,
            serialNo: unit.serialNo ?? null,
            complaint: unit.complaint ?? line.complaint ?? body.complaint,
            warrantyStatus: line.warrantyStatus ?? null,
          });
        }
      }
      return json({ visitReference: 'WI-2026-00012', jobCards, replay: false }, 201);
    }
    if (url.pathname.startsWith('/api/stock'))
      return json({ items: [], brands: [], facets: { brands: [] } });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#walkInNav').dispatchEvent('click');
  await expect(page.locator('#walkInForm')).toBeVisible();
  return api;
}

async function fillB2bCustomer(page: Page) {
  await page.locator('#wiCustomerType').selectOption('B2B');
  await page.locator('#wiCustomerName').fill('JUMEIRAH COLLEGE (2)');
  await page.locator('#wiB2bBranchSchool').fill('JUMEIRAH COLLEGE');
}

test.describe('Walk-in job card: several units in one visit', () => {
  test('a single unit still works the old way', async ({ page }) => {
    const api = await signIn(page);
    await page.locator('#wiCustomerType').selectOption('B2C');
    await page.locator('#wiCustomerName').fill('Counter Customer');
    await page.locator('#wiCustomerContact').fill('0501112222');
    await page.locator('#wiModelNo').fill('VWD5FS');
    await page.locator('#wiSerialNo').fill('SN-ONE-1');
    await page.locator('#wiComplaint').fill('Not cooling');
    await expect(page.locator('#wiSubmit')).toHaveText('Open walk-in job card');
    await page.locator('#wiSubmit').click();
    await expect.poll(() => api.visitBodies.length).toBe(1);
    const body = api.visitBodies[0];
    expect(body.customerName).toBe('Counter Customer');
    expect(body.complaint).toBe('Not cooling');
    expect(body.requestKey).toBeTruthy();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ modelNo: 'VWD5FS', quantity: 1 });
    expect(body.lines[0].units[0]).toMatchObject({ serialNo: 'SN-ONE-1' });
    await expect(page.locator('[data-wi-done]')).toContainText('Walk-in job card opened');
    await expect(page.locator('[data-wi-done] .wi-ref')).toHaveText('JBC-2026-00301');
  });

  test('two models, pasted serial numbers, one card per unit and a combined receipt', async ({
    page,
  }) => {
    const api = await signIn(page);
    await fillB2bCustomer(page);
    await page.locator('#wiModelNo').fill('VWD5FS');
    await page.locator('#wiBrand').fill('VENUS');
    await page.locator('#wiComplaint').fill('Not cooling');
    const line1 = page.locator('[data-wi-line]').first();
    await line1.locator('[data-f="quantity"]').fill('3');
    await line1.locator('[data-f="quantity"]').dispatchEvent('change');
    await expect(line1.locator('[data-wi-unit]')).toHaveCount(3);
    await line1.locator('[data-wi-paste-toggle]').click();
    await line1.locator('[data-wi-paste-text]').fill('SN-A-1\nSN-A-2');
    await line1.locator('[data-wi-paste-apply]').click();
    await expect(line1.locator('[data-u="serial"]').nth(0)).toHaveValue('SN-A-1');
    await expect(line1.locator('[data-u="serial"]').nth(1)).toHaveValue('SN-A-2');
    await expect(line1.locator('[data-u="serial"]').nth(2)).toHaveValue('');
    await line1.locator('[data-f="defInvoice"]').fill('16101234');
    await line1.locator('[data-u="complaint"]').nth(2).fill('No power');

    await page.locator('[data-wi-add-line]').click();
    const line2 = page.locator('[data-wi-line]').nth(1);
    await expect(line2.locator('[data-wi-line-title]')).toHaveText('Line 2');
    await line2.locator('[data-f="model"]').fill('VWD3FS');
    await line2.locator('[data-f="quantity"]').fill('2');
    await line2.locator('[data-f="quantity"]').dispatchEvent('change');
    await expect(page.locator('[data-wi-summary]')).toContainText(
      '5 units · 2 models · 3 without S/N',
    );
    await expect(page.locator('#wiSubmit')).toHaveText('Open 5 job cards');

    await page.locator('#wiSubmit').click();
    await expect.poll(() => api.visitBodies.length).toBe(1);
    const body = api.visitBodies[0];
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ modelNo: 'VWD5FS', brand: 'VENUS', quantity: 3 });
    expect(body.lines[0].units.map((unit: any) => unit.serialNo)).toEqual([
      'SN-A-1',
      'SN-A-2',
      undefined,
    ]);
    expect(body.lines[0].units.every((unit: any) => unit.invoiceNo === '16101234')).toBe(true);
    expect(body.lines[0].units[2].complaint).toBe('No power');
    expect(body.lines[1]).toMatchObject({ modelNo: 'VWD3FS', quantity: 2 });

    const done = page.locator('[data-wi-done]');
    await expect(done).toContainText('5 walk-in job cards opened');
    await expect(done.locator('.wi-ref')).toHaveText('WI-2026-00012');
    await expect(done.locator('tbody tr')).toHaveCount(5);
    await expect(done.locator('tbody tr').nth(2)).toContainText('S/N missing');
    await expect(
      done.getByRole('button', { name: /Print one intake receipt \(5 units\)/ }),
    ).toBeVisible();

    // The combined receipt lists every unit with a write-in line for a missing S/N.
    const popupPromise = page.waitForEvent('popup');
    await done.getByRole('button', { name: /Print one intake receipt/ }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.locator('table tbody tr')).toHaveCount(5);
    await expect(popup.locator('body')).toContainText('WI-2026-00012');
    await expect(popup.locator('body')).toContainText('SN-A-1');

    // More units for the same customer: the customer stays, the items are empty.
    await done.getByRole('button', { name: 'Add more units for this customer' }).click();
    await expect(page.locator('#walkInForm')).toBeVisible();
    await expect(page.locator('#wiCustomerName')).toHaveValue('JUMEIRAH COLLEGE (2)');
    await expect(page.locator('[data-wi-line]')).toHaveCount(1);
    await expect(page.locator('#wiModelNo')).toHaveValue('');
    await expect(page.locator('#wiSubmit')).toHaveText('Open walk-in job card');
  });

  test('a serial number open on another card stops that unit until it is confirmed', async ({
    page,
  }) => {
    const api = await signIn(page, { openSerials: ['SN-OPEN-1'] });
    await fillB2bCustomer(page);
    await page.locator('#wiModelNo').fill('VWD5FS');
    await page.locator('#wiComplaint').fill('Leaking');
    await page.locator('#wiSerialNo').fill('SN-OPEN-1');
    const note = page.locator('[data-u-note]').first();
    await expect(note).toContainText('Already open on JBC-2026-00201');
    await page.locator('#wiSubmit').click();
    await expect(page.locator('#wiResult')).toContainText('already open on JBC-2026-00201');
    expect(api.visitBodies).toHaveLength(0);

    await page.locator('[data-u="allow"]').check();
    await page.locator('#wiSubmit').click();
    await expect.poll(() => api.visitBodies.length).toBe(1);
    expect(api.visitBodies[0].lines[0].units[0]).toMatchObject({
      serialNo: 'SN-OPEN-1',
      allowDuplicateSerial: true,
    });
  });

  test('the units-per-visit limit caps the quantity and an administrator can change it', async ({
    page,
  }) => {
    const api = await signIn(page);
    await fillB2bCustomer(page);
    const line = page.locator('[data-wi-line]').first();
    await line.locator('[data-f="quantity"]').fill('11');
    await line.locator('[data-f="quantity"]').dispatchEvent('change');
    await expect(line.locator('[data-wi-unit]')).toHaveCount(10);
    await expect(page.locator('[data-wi-limit-note]')).toContainText('at most 10 units');

    await page.locator('#mastersNav').dispatchEvent('click');
    await page.getByRole('tab', { name: 'Walk-in' }).click();
    await expect(page.locator('#wiMaxUnits')).toHaveValue('10');
    await page.locator('#wiMaxUnits').fill('25');
    await page.locator('#wiMaxUnitsSave').click();
    await expect.poll(() => api.settingsPuts.length).toBe(1);
    expect(api.settingsPuts[0]).toEqual({ maxUnitsPerVisit: 25 });
    await expect(page.locator('#wiMaxUnitsStatus')).toContainText('Saved');
  });
});
