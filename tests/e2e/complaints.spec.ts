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

test.describe('B2B Branch / School free text + gating (modification.md #1, #2)', () => {
  test('offers only B2C and B2B customer types, not B2B Sales Channel', async ({ page }) => {
    await page.goto('/complaints');
    const options = await page.locator('#customerType option').allTextContents();
    expect(options).toEqual(['Select a type', 'B2C (Direct customer)', 'B2B (Corporate client)']);
  });

  test('greys out B2B-only fields for a B2C customer and clears any typed values', async ({
    page,
  }) => {
    await page.goto('/complaints');
    await page.selectOption('#customerType', 'B2B');
    await page.fill('#b2bBranchSchool', 'Some Branch');
    await page.fill('#schoolContactPerson', 'Jane Doe');
    await page.selectOption('#customerType', 'B2C');

    await expect(page.locator('#b2bBranchSchool')).toBeDisabled();
    await expect(page.locator('#schoolContactPerson')).toBeDisabled();
    await expect(page.locator('#schoolContactNumber')).toBeDisabled();
    await expect(page.locator('#b2bBranchSchool')).toHaveValue('');
    await expect(page.locator('#schoolContactPerson')).toHaveValue('');
    await expect(page.locator('#contactNumberRequiredMark')).toBeVisible();
  });

  test('does not require a contact number for a B2B customer, and submits without one', async ({
    page,
  }) => {
    let submittedBody: Record<string, unknown> | null = null;
    await page.route('**/api/public/complaints', async (route) => {
      submittedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: { complaint: { complaintReference: 'CMP-000000-001' } },
      });
    });
    await page.goto('/complaints');
    await page.selectOption('#customerType', 'B2B');
    await expect(page.locator('#contactNumberRequiredMark')).toBeHidden();
    await expect(page.locator('#contactNumberHint')).toBeVisible();

    await page.fill('#customerName', 'Acme Corp');
    await page.fill('#description', 'AC unit not cooling.');
    await page.getByRole('button', { name: 'Submit service request' }).click();

    await expect(page.locator('#successReference')).toHaveText('CMP-000000-001');
    expect(submittedBody).not.toBeNull();
    expect(submittedBody!.contactNumber).toBeUndefined();
  });
});
