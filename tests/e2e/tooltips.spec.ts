import { expect, test } from '@playwright/test';

// Help text is shown as an (i) tooltip beside the label or heading, never as a
// line of text on the page.
test('New request shows help as tooltips, not inline notes', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { name: 'Tester', email: 't@jackys.com', role: 'admin', permissions: ['*'] },
      });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('t@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#newRequestNav').dispatchEvent('click');
  await expect(page.locator('#newComplaintFields')).toBeVisible();

  // No visible inline help text left in the form.
  const inline = await page
    .locator('#newComplaintFields .form-note, #newComplaintFields .form-note-inline')
    .evaluateAll((nodes) => nodes.filter((n) => (n.textContent || '').trim() !== '').length);
  expect(inline).toBe(0);

  const bubble = page.locator('label[for="newComplaintWarranty"] .tooltip-bubble');
  await expect(bubble).toBeHidden();
  await page.locator('label[for="newComplaintWarranty"] .tooltip-icon').hover();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('final warranty on the job card');

  const technician = page.locator('label[for="newComplaintTechnician"] .tooltip-bubble');
  await expect(technician).toContainText('daily cap');
});

// Every Schedules tab explains itself, and the fields people get stuck on carry a tooltip.
test('Schedules tabs, New request fields and the Daily schedule bar have tooltips', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { name: 'Tester', email: 't@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/appointments/daily-list')
      return json({ rows: [], truncated: false, from: '2026-10-09', to: '2026-10-09' });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('t@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#newRequestNav').dispatchEvent('click');

  for (const tab of ['appointments', 'new-request', 'daily-list', 'visit-drafts']) {
    await expect(page.locator(`[data-schedules-tab="${tab}"]`)).toHaveAttribute('title', /.{20,}/);
  }
  for (const id of [
    'newComplaintSource',
    'newComplaintAppointmentDate',
    'newComplaintCustomerType',
    'newComplaintCustomerName',
    'newComplaintAddress',
    'newComplaintBrand',
    'newComplaintModel',
    'newComplaintSerialOrItemCode',
    'newComplaintDescription',
  ]) {
    await expect(page.locator(`label[for="${id}"] .tooltip-bubble`)).toHaveCount(1);
  }
  await expect(page.locator('#saveVisitDraftButton')).toHaveAttribute('title', /Awaiting/);
  await expect(page.locator('#submitNewComplaintButton')).toHaveAttribute('title', /limit/);

  await page.locator('#dailyListNav').dispatchEvent('click');
  for (const name of ['from', 'to', 'by', 'visits', 'technician']) {
    await expect(page.locator(`label:has([data-dl="${name}"]) .tooltip-bubble`)).toHaveCount(1);
  }
  await expect(page.locator('[data-dl-print-list]')).toHaveAttribute('title', /technician/);
});
