import { expect, test } from '@playwright/test';

test.describe('public complaint registration page', () => {
  test('renders the standalone complaint form, separate from the staff portal', async ({
    page,
  }) => {
    await page.goto('/complaints');

    await expect(page).toHaveTitle("Register a service request — Jacky's Distribution");
    await expect(page.getByRole('heading', { name: 'Register a service complaint' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit service request' })).toBeVisible();

    // The page must not carry any staff-only workspace markup.
    await expect(page.locator('#staff-workspace')).toHaveCount(0);
    await expect(page.locator('#signInPanel')).toHaveCount(0);
  });

  test('shows required-field feedback without sending incomplete data', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/public/complaints', async (route) => {
      requestCount += 1;
      await route.continue();
    });
    await page.goto('/complaints');
    await page.getByRole('button', { name: 'Submit service request' }).click();

    await expect(page.locator('[data-error-for="customerType"]')).toHaveText(
      'Select a customer type.',
    );
    await expect(page.locator('[data-error-for="customerName"]')).toHaveText(
      'Enter the customer name.',
    );
    await expect(page.locator('[data-error-for="contactNumber"]')).toHaveText(
      'Enter a contact number.',
    );
    await expect(page.locator('[data-error-for="description"]')).toHaveText('Describe the issue.');
    expect(requestCount).toBe(0);
  });

  test("links out to the landing page and the staff portal, not to each other's content", async ({
    page,
  }) => {
    await page.goto('/complaints');

    await expect(page.getByRole('link', { name: '← Back to overview' })).toHaveAttribute(
      'href',
      'landing.html',
    );
    await expect(
      page.locator('nav').getByRole('link', { name: 'Internal Service Team' }),
    ).toHaveAttribute('href', '/portal/');
  });

  test('also resolves with a trailing slash', async ({ page }) => {
    await page.goto('/complaints/');
    await expect(page.getByRole('heading', { name: 'Register a service complaint' })).toBeVisible();
  });
});
