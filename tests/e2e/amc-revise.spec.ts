import { expect, test } from '@playwright/test';

const amc = {
  basicPct: 0.05,
  standardPct: 0.08,
  premiumPct: 0.12,
  riskUplift: 0.25,
  overhead: 0.1,
  profitMarkup: 0.3,
  standardPartsReserve: 0.025,
  premiumPartsReserve: 0.045,
  handledPerVisit: 8,
  transportPerVisit: 100,
  salary: 4500,
  technicians: 2,
  workingDays: 26,
  hoursPerDay: 8,
  visitHours: 4,
  standardVisits: 2,
  premiumVisits: 4,
  basicVisitTiers: [[1, 4]],
};
const master = {
  appliances: [
    {
      name: 'Built-in Oven',
      amcEnabled: true,
      thomsonEnabled: true,
      amcRefValue: 650,
      active: true,
    },
  ],
};
const plan = (planKey: string, planLabel: string, price: number) => ({
  planKey,
  planLabel,
  annualVisits: 4,
  laborCost: 0,
  transportCost: 0,
  partsReserve: 0,
  directCost: 0,
  overhead: 0,
  priceExclVat: price,
  priceInclVat: price * 1.05,
});
const contract = (status: string) => ({
  id: '7',
  amcContractReference: 'AC-2026-00001',
  contractDate: '2026-11-01',
  contractPeriod: '1 Year',
  clientName: 'Acme Hotel',
  attentionTo: null,
  siteLocation: 'Dubai',
  // Saved when the oven's reference value was 500; the master now says 650.
  appliances: [{ name: 'Built-in Oven', qty: 5, price: 500, ref: true }],
  totalCount: '5',
  totalValue: '2500',
  plans: [plan('basic-rm', 'Basic RM', 1000), plan('premium-pmc', 'Premium PMC', 2000)],
  commencementDate: null,
  contractRef: null,
  revision: 1,
  revisionNote: null,
  status,
  soldPlanKey: null,
  soldPlanLabel: null,
  soldPriceExclVat: null,
  soldPriceInclVat: null,
  soldDate: null,
  lostReason: null,
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
});

async function open(page: import('@playwright/test').Page, status: string, perms: string[]) {
  const puts: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { id: '1', name: 'Admin', email: 'a@jackys.com', role: 'admin', permissions: perms },
      });
    }
    if (url.pathname === '/api/pricing-config/amc_pricing') return json({ payload: amc });
    if (url.pathname === '/api/pricing-config/appliance_master') return json({ payload: master });
    if (url.pathname === '/api/amc-contracts' && route.request().method() === 'GET')
      return json({ amcContracts: [contract(status)], pagination: {} });
    if (url.pathname === '/api/amc-contracts/7/revisions')
      return json({
        revisions: [
          {
            id: '1',
            revision: 1,
            revisionNote: null,
            savedAt: '2026-11-01T08:00:00Z',
            savedByName: 'Sales Sam',
            snapshot: { ...contract('Quote'), totalCount: 5 },
          },
        ],
      });
    if (url.pathname === '/api/amc-contracts/7' && route.request().method() === 'PUT') {
      puts.push(route.request().postDataJSON());
      return json({ amcContract: { ...contract('Quote'), revision: 2 } });
    }
    if (url.pathname === '/api/amc-contracts/7') return json({ amcContract: contract(status) });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('a@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Quote Calculators', exact: true }).click();
  await page.locator('#amcCalcNav').dispatchEvent('click');
  await page.locator('[data-ac-tab="issued"]').click();
  return puts;
}

test.describe('Admin edits an issued AMC quote', () => {
  test('reopens with current prices, saves a revision, and shows history', async ({ page }) => {
    const puts = await open(page, 'Quote', [
      '*',
      'amc_contract.read',
      'amc_contract.write',
      'amc_contract.revise',
      'quote_calculators.use',
    ]);
    await expect(page.locator('[data-ac-edit="7"]')).toBeVisible();

    await page.locator('[data-ac-edit="7"]').click();
    await expect(page.locator('[data-as-edit-banner]')).toContainText(
      'Editing AC-2026-00001 (Rev 1)',
    );
    await expect(page.locator('[data-as-edit-banner]')).toContainText('Basic RM 1050.00');
    await expect(page.locator('[data-as-save]')).toHaveText('Save revision (Rev 2)');
    await expect(page.locator('[data-as-client]')).toHaveValue('Acme Hotel');
    await expect(page.locator('[data-ac-qty="0"]')).toHaveValue('5');
    // 5 x current reference value 650, not the 500 it was saved with.
    await expect(page.locator('[data-ac-output]')).toContainText('3250.00');

    await page.locator('[data-as-note]').fill('Management price reduction');
    await page.locator('[data-as-save]').click();
    await expect(page.locator('[data-as-message]')).toContainText('Rev 2');
    expect(puts).toHaveLength(1);
    const body = puts[0] as { revisionNote: string; totalValue: number; clientName: string };
    expect(body.revisionNote).toBe('Management price reduction');
    expect(body.totalValue).toBe(3250);
    expect(body.clientName).toBe('Acme Hotel');

    await page.locator('[data-ac-tab="issued"]').click();
    await page.locator('[data-ac-history="7"]').click();
    await expect(page.locator('[data-ac-history-panel]')).toContainText('Rev 1');
    await expect(page.locator('[data-ac-history-panel]')).toContainText('Sales Sam');
  });

  test('Sold quotes have no Edit button; users without the permission see neither button', async ({
    page,
  }) => {
    await open(page, 'Sold', [
      'amc_contract.read',
      'amc_contract.write',
      'amc_contract.revise',
      'quote_calculators.use',
    ]);
    await expect(page.locator('[data-ac-history="7"]')).toBeVisible();
    await expect(page.locator('[data-ac-edit="7"]')).toHaveCount(0);
  });

  test('without amc_contract.revise there is no Edit or History', async ({ page }) => {
    await open(page, 'Quote', ['amc_contract.read', 'amc_contract.write', 'quote_calculators.use']);
    await expect(page.locator('[data-ac-reprint="7"]')).toBeVisible();
    await expect(page.locator('[data-ac-edit="7"]')).toHaveCount(0);
    await expect(page.locator('[data-ac-history="7"]')).toHaveCount(0);
  });
});
