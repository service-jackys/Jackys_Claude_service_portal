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
