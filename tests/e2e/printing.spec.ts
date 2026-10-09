import { expect, test, type Page } from '@playwright/test';

const rows = [
  ['1', 'APT-2026-00001', 'Ali', 'tech-a', 'Tech A'],
  ['2', 'APT-2026-00002', 'Bina', 'tech-a', 'Tech A'],
  ['3', 'APT-2026-00003', 'Chen', 'tech-b', 'Tech B'],
  ['4', 'APT-2026-00004', 'Dev', 'tech-b', 'Tech B'],
].map(([id, ref, name, tid, tname]) => ({
  id,
  appointmentReference: ref,
  appointmentDate: '2026-10-09',
  status: 'Scheduled',
  customerType: 'B2C',
  customerName: name,
  contactNumber: '0500000000',
  address: 'Dubai',
  region: 'Dubai',
  brand: 'VENUS',
  model: 'VW708SD',
  itemCode: 'VW708SD',
  faultDescription: 'Not cooling',
  jobWarranty: 'In Warranty',
  salesOrderNumber: null,
  technicianId: tid,
  technicianName: tname,
  branchName: null,
  schoolContactPerson: null,
  schoolContactNumber: null,
  complaintReference: null,
  customerEmail: 'x@y.com',
  customerNumber: null,
  subGroup: null,
  salesman: 'Sam',
  complaintSource: 'Phone',
}));

const jobCard = {
  id: '701',
  jobCardReference: 'JBC-2026-00001',
  customerName: 'Job Card Customer',
  status: 'Open',
  jobFinalStatus: 'WIP',
  billingJobType: 'CSIJW - Warranty repair',
  paymentBy: 'Sales channel',
  salesman: 'Sam Salesman',
  salesChannel: 'Channel X',
  parts: [{ partNo: 'P1', description: 'Compressor', qty: 1, unitPrice: 123.45 }],
  totalCost: 123.45,
  serviceCharge: 77,
  grandTotal: 200.45,
  invoiceNo: 'INV-999',
};

async function signIn(page: Page, dailyRows: unknown[] = rows) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { name: 'Tester', email: 't@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/appointments/daily-list')
      return json({ rows: dailyRows, truncated: false, from: '2026-10-09', to: '2026-10-09' });
    if (url.pathname === '/api/job-cards' && route.request().method() === 'GET')
      return json({
        jobCards: [jobCard],
        pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
      });
    if (url.pathname === '/api/job-cards/701') return json({ jobCard, history: [] });
    if (url.pathname === '/api/technicians')
      return json({
        technicians: [
          { id: 'tech-a', name: 'Tech A' },
          { id: 'tech-b', name: 'Tech B' },
        ],
      });
    if (url.pathname === '/api/appointments' && route.request().method() === 'GET')
      return json({
        appointments: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
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

test.describe('printing', () => {
  test('job card print asks for a copy; the customer copy has no amounts', async ({ page }) => {
    await signIn(page);
    await page.locator('#jobCardsNav').dispatchEvent('click');
    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await page.locator('[data-print-choice="customer"]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    await expect.poll(() => popup.content()).toContain('Customer copy');
    const html = await popup.content();
    expect(html).toContain('class="logo"');
    expect(html).toContain('Compressor');
    for (const hidden of [
      '123.45',
      '77.00',
      '200.45',
      'Grand total',
      'INV-999',
      'Channel X',
      'Sam Salesman',
      'Payment by',
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  test('daily schedule: filter by technician and print only the ticked appointments', async ({
    page,
  }) => {
    await signIn(page);
    await page.locator('#dailyListNav').dispatchEvent('click');
    await expect(page.locator('[data-dl-pick]')).toHaveCount(4);

    // Technician filter shows one technician's jobs only.
    await page.locator('[data-dl="technician"]').selectOption('tech-a');
    await expect(page.locator('[data-dl-pick]')).toHaveCount(2);

    // The group tick box selects every job of that technician.
    await page.locator('[data-dl-pick-group]').check();
    await expect(page.locator('[data-dl-print-list]')).toContainText('2 selected');
    await page.locator('[data-dl-pick-group]').uncheck();

    // Tick one job: the print buttons act on the selection.
    await page.locator('[data-dl-pick="1"]').check();
    await expect(page.locator('[data-dl-print-sheets]')).toContainText('1 selected');
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-dl-print-sheets]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    const html = await popup.content();
    expect(html).toContain('APT-2026-00001');
    expect(html).not.toContain('APT-2026-00002');
    expect(html).not.toContain('APT-2026-00003');
    expect(html).toContain('class="logo"');
    expect(html).toContain('Complaint source');
  });

  test('printing is blocked until every appointment has a technician', async ({ page }) => {
    const unassigned = {
      ...rows[0]!,
      id: '9',
      appointmentReference: 'APT-2026-00009',
      technicianId: null,
      technicianName: null,
    };
    await signIn(page, [rows[0]!, unassigned]);
    await page.locator('#dailyListNav').dispatchEvent('click');
    await expect(page.locator('[data-dl-pick]')).toHaveCount(2);
    await page.locator('[data-dl-print-list]').click();
    const dialog = page.locator('dialog.print-choice');
    await expect(dialog).toContainText('Technician not assigned');
    await expect(dialog).toContainText('APT-2026-00009');
    await expect(dialog).not.toContainText('APT-2026-00001');
    // Choosing the appointment opens it so a technician can be assigned.
    await dialog.locator('[data-open-appointment="9"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#appointmentWorkspace')).toBeVisible();
  });

  test('daily schedule lists scheduled jobs only (no cancelled option)', async ({ page }) => {
    await signIn(page);
    await page.locator('#dailyListNav').dispatchEvent('click');
    await expect(page.locator('[data-dl-pick]')).toHaveCount(4);
    await expect(page.locator('[data-dl="cancelled"]')).toHaveCount(0);
  });

  test('appointments page prints a date range for one technician', async ({ page }) => {
    await signIn(page);
    await page.locator('#appointmentsNav').dispatchEvent('click');
    await expect(page.locator('#appointmentTechnicianFilter')).toBeVisible();
    await page.locator('#appointmentFrom').fill('2026-10-09');
    await page.locator('#appointmentTo').fill('2026-10-10');
    await page.locator('#appointmentTechnicianFilter').selectOption('tech-b');
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#appointmentPrintSheetsButton').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    const html = await popup.content();
    expect(html).toContain('APT-2026-00003');
    expect(html).toContain('APT-2026-00004');
    expect(html).not.toContain('APT-2026-00001');
    expect(html).toContain('class="logo"');
  });
});
