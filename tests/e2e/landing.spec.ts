import { expect, test } from '@playwright/test';

test.describe('public landing page', () => {
  test('renders the hero and both access paths', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle("Jacky's Distribution — Service Center Portal");
    await expect(
      page.getByRole('heading', { name: 'One portal for every step of your service request.' }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Register a complaint →' })).toHaveAttribute(
      'href',
      'complaints.html',
    );
    await expect(page.getByRole('link', { name: 'Open staff workspace →' })).toHaveAttribute(
      'href',
      '/portal/',
    );
  });

  // Regression test: the scroll-reveal script used to be an inline <script>,
  // which the app's default Content-Security-Policy silently blocks. Every
  // section below the hero uses the .reveal class (opacity: 0 until JS adds
  // is-visible), so a blocked script left the whole page below the fold
  // invisible even though it was present in the DOM.
  test('reveals below-the-fold sections instead of leaving them at opacity 0', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto('/');
    const howItWorksHeading = page.getByRole('heading', {
      name: 'Three steps from complaint to completion',
    });
    await howItWorksHeading.scrollIntoViewIfNeeded();
    await expect(howItWorksHeading).toBeVisible();
    await expect(
      howItWorksHeading.locator('xpath=ancestor::*[contains(@class, "reveal")][1]'),
    ).toHaveClass(/is-visible/);

    const coverageHeading = page.getByRole('heading', {
      name: 'One service network, all seven emirates',
    });
    await coverageHeading.scrollIntoViewIfNeeded();
    await expect(coverageHeading).toBeVisible();

    const finalCta = page.getByRole('heading', {
      name: 'Ready to get your service request moving?',
    });
    await finalCta.scrollIntoViewIfNeeded();
    await expect(finalCta).toBeVisible();

    expect(consoleErrors.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
  });

  test('brand logos and service photography actually load, not just placeholders', async ({
    page,
  }) => {
    await page.goto('/');
    const images = page.locator('img');
    const count = await images.count();
    expect(count).toBeGreaterThan(5);

    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      const naturalWidth = await image.evaluate((el: HTMLImageElement) => el.naturalWidth);
      const src = await image.getAttribute('src');
      expect(naturalWidth, `image failed to load: ${src ?? '(no src)'}`).toBeGreaterThan(0);
    }
  });
});
