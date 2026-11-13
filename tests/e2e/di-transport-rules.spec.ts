import { expect, test, type Page } from '@playwright/test';

// Delivery & Installation has its own Transport rules tab, apart from the Service Revenue Dashboard.
const rulesResponse = (rules: Record<string, unknown>) => ({
  rules,
  updatedAt: '2026-11-13T06:00:00.000Z',
  updatedByName: 'Vysakh',
  impact: {
    completedTripJobs: 9,
    tripsNotCharged: 2,
    transportNotCharged: 120,
    daysOverCap: 1,
    days: [
      {
        date: '2026-11-10',
        salesman: 'SHIVA',
        trips: [
          {
            reference: 'DI-0001',
            deliveryNoteRef: '1001',
            kind: 'installation',
            carrier: 'CSIDI',
            charge: 60,
            rank: 1,
            charged: true,
          },
          {
            reference: 'DI-0002',
            deliveryNoteRef: '1002',
            kind: 'installation',
            carrier: 'CSIDI',
            charge: 60,
            rank: 2,
            charged: true,
          },
          {
            reference: 'DI-0003',
            deliveryNoteRef: '1003',
            kind: 'installation',
            carrier: 'CSIDI',
            charge: 60,
            rank: 3,
            charged: false,
          },
        ],
      },
    ],
  },
});

async function open(page: Page, permissions: string[], puts: unknown[]) {
  let current = {
    dailyCap: true,
    deliveryOnlyCap: false,
    mixedInvoiceTransport: true,
    maxTrips: 2,
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({ user: { name: 'User', email: 'u@jackys.com', role: 'staff', permissions } });
    if (url.pathname === '/api/di-jobs/transport-rules') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        puts.push(body);
        current = { ...current, ...body };
      }
      return json(rulesResponse(current));
    }
    if (url.pathname === '/api/di-jobs/options')
      return json({ salesmen: [], regions: ['Dubai', 'Sharjah'], erpInvMandatory: false });
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('u@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.evaluate(() => document.getElementById('deliveryInstallNav')?.click());
  await page.locator('[data-di-tab="rules"]').click();
  await expect(page.locator('.rd-rules-card')).toBeVisible();
}

test('admin changes the Delivery & Installation daily cap on its own tab', async ({ page }) => {
  const puts: unknown[] = [];
  await open(page, ['di_jobs.read', 'di_jobs.configure'], puts);
  const card = page.locator('.rd-rules-card');
  await expect(card.locator('.rd-rules-summary')).toContainText(
    '2 trip(s) are not charged on 1 salesperson-day(s)',
  );
  await card.locator('summary', { hasText: 'Salesperson-days over the cap' }).click();
  await expect(card.locator('.rd-rules-dropped')).toHaveText('Not charged (3)');
  await card.locator('[data-di-rule="dailyCap"]').uncheck();
  await expect(card.locator('[data-di-rule="deliveryOnlyCap"]')).toBeDisabled();
  await card.locator('[data-di-rules-save]').click();
  await expect(page.locator('[data-di-rules-msg]')).toHaveText('Saved.');
  expect(puts).toEqual([
    { dailyCap: false, deliveryOnlyCap: false, mixedInvoiceTransport: true, maxTrips: 2 },
  ]);
});

test('others see the Delivery & Installation rules read-only', async ({ page }) => {
  await open(page, ['di_jobs.read'], []);
  const card = page.locator('.rd-rules-card');
  await expect(card.locator('[data-di-rule="dailyCap"]')).toBeDisabled();
  await expect(card.locator('[data-di-rules-save]')).toHaveCount(0);
  await expect(card).toContainText('Only an administrator can change these settings');
});
