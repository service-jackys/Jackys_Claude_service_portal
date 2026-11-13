import { expect, test } from '@playwright/test';

// Tasks > "Add from a record": pick a quotation, inspection or job card, get the normal New task
// panel filled in, and see a coloured link to the record on the task and on the record page.
test('a task can be added from a quotation and links back to it', async ({ page }) => {
  const posted: Record<string, unknown>[] = [];
  const requested: string[] = [];
  const stored: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    requested.push(url.pathname + url.search);
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Vysakh Raju',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: ['tasks.use', 'quotation.read', 'inspection.read', 'service_job_card.read'],
        },
      });
    }
    if (url.pathname === '/api/roi/tasks' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posted.push(body);
      const task = {
        id: '41',
        ownerProfileId: '1',
        kind: 'task',
        status: 'not_started',
        priority: 'medium',
        percentComplete: 0,
        startDate: body.startDate,
        dueDate: null,
        remarks: null,
        notes: body.notes,
        completedAt: null,
        archivedAt: null,
        recordLabel: 'QO-2026-00101 · Metro Delux Trading',
        ...body,
      };
      stored.push(task);
      return json({ task }, 201);
    }
    if (url.pathname === '/api/roi/tasks') return json({ tasks: stored, owners: [] });
    if (url.pathname === '/api/quotations') {
      return json({
        quotations: [
          {
            id: '7',
            quotationReference: 'QO-2026-00101',
            customerName: 'Metro Delux Trading',
            quotationStatus: 'Pending',
          },
        ],
      });
    }
    return json({});
  });

  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('finance@jackys.com');
  await page.locator('#loginPassword').fill('a-long-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#tasksNav').dispatchEvent('click');

  await page.locator('[data-tk-from-record]').click();
  await expect(page.locator('[data-pk-section]')).toHaveText(['Records', 'Service desk']);
  await page.locator('[data-pk-type="quotation"]').click();
  await page.locator('[data-pk-search]').fill('Metro');
  await expect.poll(() => requested.some((r) => r.includes('search=Metro'))).toBe(true);
  await page.locator('.tk-pk-row').first().click();

  await expect(page.locator('#tkTitle')).toHaveValue(
    'Follow up: QO-2026-00101 · Metro Delux Trading',
  );
  await expect(page.locator('#tkNotes')).toContainText('Quotation: QO-2026-00101');
  await expect(page.locator('.tk-panel .tk-rec-quotation')).toContainText('QO-2026-00101');
  await page.locator('.tk-panel [type=submit]').click();

  expect(posted[0]).toMatchObject({ recordType: 'quotation', recordId: '7' });
  const chip = page.locator('.tk-row .tk-rec-quotation');
  await expect(chip).toContainText('QO-2026-00101');
  await chip.click();
  await expect.poll(() => requested.includes('/api/quotations/7')).toBe(true);
});

test('Service desk offers job cards only', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: {
          name: 'Vysakh Raju',
          email: 'finance@jackys.com',
          role: 'staff',
          permissions: ['tasks.use', 'quotation.read', 'service_job_card.read'],
        },
      });
    }
    if (url.pathname === '/api/roi/tasks') return json({ tasks: [], owners: [] });
    if (url.pathname === '/api/job-cards') {
      return json({
        jobCards: [{ id: '3', jobCardReference: 'JBC-2026-00101', customerName: 'Omar Haddad' }],
      });
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('finance@jackys.com');
  await page.locator('#loginPassword').fill('a-long-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#tasksNav').dispatchEvent('click');
  await page.locator('[data-tk-from-record]').click();
  // No inspection permission: Records offers Quotation only.
  await expect(page.locator('[data-pk-type]')).toHaveText(['Quotation']);
  await page.locator('[data-pk-section="Service desk"]').click();
  await expect(page.locator('[data-pk-type]')).toHaveText(['Job card']);
  await page.locator('[data-pk-type="job_card"]').click();
  await page.locator('.tk-pk-row').first().click();
  await expect(page.locator('#tkTitle')).toHaveValue('Follow up: JBC-2026-00101 · Omar Haddad');
});
