import { expect, test } from '@playwright/test';

test('Stock master shows fridge capacity: review default 400, type litres, work out again', async ({
  page,
}) => {
  const puts: unknown[] = [];
  let recalcs = 0;
  let rows = [
    {
      itemCode: 'LGF1',
      itemDesc: 'LG FRIDGE / 2 DOOR, SILVER',
      groupName: 'FRIDGE',
      subGroup: 'FRIDGE DOUBLE DOOR',
      brand: 'LG',
      capacityLitres: 400,
      capacitySource: 'default',
    },
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Master Tester',
          email: 'md@jackys.com',
          role: 'admin',
          permissions: ['stock.read', 'stock.write'],
        },
      });
    }
    if (url.pathname === '/api/stock/status') {
      return json({
        lastUpload: null,
        totalItems: 10,
        searchableItems: 10,
        notInFileCount: 0,
        recentUploads: [],
        capacityCounts: { description: 1366, default: 790, cft: 12 },
      });
    }
    if (url.pathname === '/api/stock/capacity/recalculate') {
      recalcs += 1;
      return json({ checked: 2185, changed: 3, counts: { default: 790 } });
    }
    if (url.pathname === '/api/stock/capacity/LGF1' && request.method() === 'PUT') {
      const body = request.postDataJSON() as { litres: number | null };
      puts.push(body);
      rows = [
        {
          ...rows[0],
          capacityLitres: body.litres ?? 400,
          capacitySource: body.litres === null ? 'default' : 'manual',
        },
      ];
      return json({ item: rows[0] });
    }
    if (url.pathname === '/api/stock/capacity') {
      const filter = url.searchParams.get('filter');
      const shown = rows.filter((r) =>
        filter === 'default'
          ? r.capacitySource === 'default'
          : filter === 'manual'
            ? r.capacitySource === 'manual'
            : true,
      );
      return json({
        items: shown,
        counts: { description: 1366, default: 790, cft: 12 },
        pagination: { page: 1, pageSize: 25, total: shown.length, totalPages: 1 },
      });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('md@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#mastersNav').dispatchEvent('click');

  const card = page.locator('[data-sm-cap]');
  await expect(card).toContainText('Fridge capacity (litres)');
  await expect(card).toContainText('2,168 fridges and freezers');
  await expect(card.locator('tbody tr')).toHaveCount(1);
  await expect(card.locator('tbody')).toContainText('Default 400');

  await card.locator('[data-smc-input]').fill('650');
  await card.locator('[data-smc-save]').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ litres: 650 });
  await expect(card.locator('[data-smc-msg]')).toContainText('Saved.');

  await card.locator('[data-smc-filter]').selectOption('manual');
  await expect(card.locator('tbody')).toContainText('Typed by you');
  await card.locator('[data-smc-clear]').click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({ litres: null });

  await card.locator('[data-smc-recalc]').click();
  await expect(card.locator('[data-smc-msg]')).toContainText('2,185 items checked, 3 updated.');
  expect(recalcs).toBe(1);
});
