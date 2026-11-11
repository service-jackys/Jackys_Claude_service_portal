import { expect, test, type Page } from '@playwright/test';

// Modifications #249 / #251: transport rules tab on the Service Revenue Dashboard.
const rulesResponse = (over: Record<string, unknown> = {}) => ({
  rules: { dailyCap: true, deliveryOnlyCap: false, mixedInvoiceTransport: true, maxTrips: 2 },
  preset: 'new_master',
  label: 'Transport rules: new master logic (2-trip daily cap, delivery-only outside the cap)',
  matchesWorkbook: false,
  workbookRule: 'old',
  appliedToActive: true,
  notRecalculated: false,
  updatedByName: 'Vysakh',
  batch: { id: '1', fileName: 'master.xlsm', uploadedAt: '2026-11-11T08:00:00.000Z' },
  totals: { workbook: 112950.25, current: 112050.25, change: -900 },
  summary: {
    workbookTotal: 112950.25,
    currentTotal: 112050.25,
    change: -900,
    tripsNotCharged: 15,
    droppedCharges: 900,
    daysOverCap: 12,
    byJobType: [
      {
        key: 'CSIJW',
        label: 'CSIJW - Warranty repairs',
        workbook: 19580,
        current: 19580,
        change: 0,
      },
      {
        key: 'TRANSPORT',
        label: 'Transport - trip charges',
        workbook: 7590,
        current: 6690,
        change: -900,
      },
    ],
  },
  days: [
    {
      date: '2026-07-10',
      salesperson: 'SHIVA',
      overCap: true,
      trips: [
        {
          invoice: '16101001',
          kind: 'installation',
          carrier: 'CSIDI',
          charge: 60,
          rank: 1,
          charged: true,
        },
        {
          invoice: '16101002',
          kind: 'installation',
          carrier: 'CSIDI',
          charge: 60,
          rank: 2,
          charged: true,
        },
        {
          invoice: '16101003',
          kind: 'installation',
          carrier: 'CSIDO',
          charge: 60,
          rank: 3,
          charged: false,
        },
      ],
    },
  ],
  ...over,
});

async function open(page: Page, permissions: string[], puts: unknown[]) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({ user: { name: 'User', email: 'u@jackys.com', role: 'staff', permissions } });
    if (url.pathname === '/api/revenue-dashboard/transport-rules') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        puts.push(body);
        return json(
          rulesResponse({
            rules: body,
            preset: 'old_master',
            label: 'Transport rules: old master logic (no daily cap)',
            matchesWorkbook: true,
          }),
        );
      }
      return json(
        puts.length
          ? rulesResponse({
              rules: puts[puts.length - 1],
              preset: 'old_master',
              label: 'Transport rules: old master logic (no daily cap)',
              matchesWorkbook: true,
            })
          : rulesResponse(),
      );
    }
    if (url.pathname === '/api/revenue-dashboard/summary')
      return json({
        batch: { fileName: 'master.xlsm', uploadedAt: '2026-11-11T08:00:00Z' },
        summary: {
          totals: { jobs: 5, qty: 7, revenue: 4321 },
          options: {
            years: [2026],
            months: [10],
            weeks: [],
            jobTypes: [],
            channels: [],
            costStatuses: [],
          },
          monthly: [],
        },
      });
    return json({}, 404);
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('u@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.evaluate(() => document.getElementById('revenueDashNav')?.click());
  // Not on the other tabs any more: only a one-line notice when the rules need attention.
  await expect(page.locator('.rd-subtab-btn', { hasText: 'Logic applied' })).toBeVisible();
  await expect(page.locator('.rd-rules-card')).toHaveCount(0);
  await page.locator('.rd-subtab-btn', { hasText: 'Transport rules' }).click();
  await expect(page.locator('.rd-rules-card')).toBeVisible();
}

test('admin switches the 2-trip daily cap off and saves for the whole dashboard', async ({
  page,
}) => {
  const puts: unknown[] = [];
  await open(
    page,
    ['revenue_dashboard.read', 'revenue_dashboard.tab_logic', 'revenue_dashboard.transport_rules'],
    puts,
  );
  const card = page.locator('.rd-rules-card');
  await expect(card.locator('.rd-rules-chip')).toHaveText(/new master logic/);
  await expect(card.locator('.rd-rules-flag')).toContainText(
    'Figures differ from the uploaded master workbook (it uses the old logic)',
  );
  await expect(card.locator('.rd-rules-transport')).toContainText('Transport - trip charges');
  await expect(card.locator('.rd-rule-toggle').first()).toHaveAttribute(
    'title',
    /ON: Each salesperson pays transport for at most 2/,
  );
  await card.locator('summary', { hasText: 'Salesperson-days with more than 2' }).click();
  await expect(card.locator('.rd-rules-dropped')).toHaveText('Not charged (3)');
  await card.locator('[data-rd-rule="dailyCap"]').uncheck();
  await expect(card.locator('[data-rd-rule="deliveryOnlyCap"]')).toBeDisabled();
  await expect(card.locator('.rd-rule-help').first()).toContainText('No daily limit');
  await card.locator('[data-rd-rules-save]').click();
  await expect(page.locator('.rd-rules-card .rd-rules-chip')).toHaveText(/old master logic/);
  expect(puts).toEqual([
    { dailyCap: false, deliveryOnlyCap: false, mixedInvoiceTransport: true, maxTrips: 2 },
  ]);
});

test('other users see the active rules read-only', async ({ page }) => {
  await open(page, ['revenue_dashboard.read', 'revenue_dashboard.tab_logic'], []);
  const card = page.locator('.rd-rules-card');
  await expect(card.locator('[data-rd-rule="dailyCap"]')).toBeDisabled();
  await expect(card.locator('[data-rd-rules-save]')).toHaveCount(0);
  await expect(card).toContainText('Only an administrator can change these settings');
});

test('the other tabs show a short notice that opens the Transport rules tab', async ({ page }) => {
  await open(page, ['revenue_dashboard.read', 'revenue_dashboard.tab_logic'], []);
  await page.locator('.rd-subtab-btn', { hasText: 'Logic applied' }).click();
  const strip = page.locator('.rd-rules-strip');
  await expect(strip).toContainText('new master logic');
  await strip.getByRole('button', { name: 'Open Transport rules' }).click();
  await expect(page.locator('.rd-rules-card')).toBeVisible();
  await expect(page.locator('.rd-subtab-btn.active')).toHaveText('Transport rules');
});
