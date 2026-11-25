import { expect, test } from '@playwright/test';

const appointment = {
  id: '501',
  appointmentReference: 'APT-2026-00001',
  customerName: 'Calendar Customer',
  contactNumber: '0500000000',
  appointmentDate: '2026-10-05',
  technicianId: '7',
  region: 'Dubai',
  status: 'Scheduled',
};

async function installStaffApi(
  page: import('@playwright/test').Page,
  options: {
    appointment?: typeof appointment;
    scheduleStatus?: number;
    scheduleDetail?: string;
    listStatus?: number;
    detailStatus?: number;
  } = {},
) {
  let currentAppointment = { ...appointment, ...(options.appointment || {}) };
  const listStatus = options.listStatus || 200;
  const detailStatus = options.detailStatus || 200;
  const scheduleStatus = options.scheduleStatus || 200;
  const scheduleDetail = options.scheduleDetail || '';
  const scheduleBodies: unknown[] = [];
  const visitBodies: unknown[] = [];
  const lookupUrls: string[] = [];
  const draftCalls: { method: string; path: string; body?: Record<string, any> }[] = [];
  let drafts: Record<string, any>[] = [
    {
      id: '71',
      payload: {
        customerName: 'Late Customer',
        contactNumber: '0501111111',
        customerType: 'B2C',
        appointmentDate: '2026-10-20',
        items: [{ brand: 'LG', model: 'Washer', faultDescription: 'Noise' }, { brand: 'Bosch' }],
      },
      customerName: 'Late Customer',
      itemCount: 2,
      createdByName: 'CCE One',
      createdAt: '2026-10-10T08:00:00Z',
      ageDays: 3,
    },
    {
      id: '72',
      payload: { customerName: 'Warn Customer', items: [{ brand: 'Sharp' }] },
      customerName: 'Warn Customer',
      itemCount: 1,
      createdByName: 'CCE Two',
      createdAt: '2026-10-11T08:00:00Z',
      ageDays: 2,
    },
  ];
  const listUrls: string[] = [];
  let detailRequests = 0;

  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/dashboard')) {
      await route.fulfill({ contentType: 'application/json', body: '{}' });
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/login') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token' }),
      });
      return;
    }
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            name: 'Scheduler',
            email: 'scheduler@jackys.com',
            role: 'admin',
            permissions: ['*'],
          },
        }),
      });
      return;
    }
    if (url.pathname === '/api/complaints' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ complaints: [] }),
      });
      return;
    }
    if (url.pathname === '/api/appointments' && request.method() === 'GET') {
      listUrls.push(request.url());
      await route.fulfill({
        status: listStatus,
        contentType: listStatus === 200 ? 'application/json' : 'application/problem+json',
        body: JSON.stringify(
          listStatus === 200
            ? {
                appointments: [currentAppointment],
                pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
              }
            : { detail: 'Appointment list could not be loaded.' },
        ),
      });
      return;
    }
    if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
      detailRequests += 1;
      await route.fulfill({
        status: detailStatus,
        contentType: detailStatus === 200 ? 'application/json' : 'application/problem+json',
        body: JSON.stringify(
          detailStatus === 200
            ? { appointment: currentAppointment, history: [] }
            : { detail: 'This appointment no longer exists.' },
        ),
      });
      return;
    }
    if (url.pathname.startsWith('/api/appointments/visit-drafts')) {
      const id = url.pathname.split('/')[4];
      const method = request.method();
      const body = method === 'GET' || method === 'DELETE' ? undefined : request.postDataJSON();
      draftCalls.push({ method, path: url.pathname, body });
      if (method === 'GET') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ drafts }) });
      } else if (method === 'DELETE') {
        drafts = drafts.filter((entry) => entry.id !== id);
        await route.fulfill({ status: 204 });
      } else {
        const saved = {
          id: id || '99',
          payload: body,
          customerName: body?.customerName,
          itemCount: body?.items.length,
          createdByName: 'Scheduler',
          createdAt: new Date().toISOString(),
          ageDays: 0,
        };
        drafts = [...drafts.filter((entry) => entry.id !== saved.id), saved];
        await route.fulfill({
          status: id ? 200 : 201,
          contentType: 'application/json',
          body: JSON.stringify({ draft: saved }),
        });
      }
      return;
    }
    if (url.pathname === '/api/appointments' && request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          appointment: {
            id: '700',
            appointmentReference: 'APT-2026-00700',
            appointmentDate: '2026-10-20',
          },
          warnings: [],
        }),
      });
      return;
    }
    if (url.pathname === '/api/appointments/customer-lookup') {
      lookupUrls.push(request.url());
      const rec = {
        customerType: 'B2C',
        customerName: 'Sara Khan',
        contactNumber: '050 123 4567',
        address: 'Villa 12, Marina',
        region: 'Dubai',
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          appointments: [
            {
              ...rec,
              id: '417',
              appointmentReference: 'APT-2026-00417',
              status: 'Completed',
              appointmentDate: '2026-10-14',
              brand: 'LG',
              model: 'Washer',
              itemCode: 'SN-1',
              faultDescription: 'Seal replaced',
            },
            {
              ...rec,
              id: '188',
              appointmentReference: 'APT-2026-00188',
              status: 'Cancelled',
              appointmentDate: '2026-08-02',
              brand: 'Bosch',
              model: 'Fridge',
              faultDescription: 'Thermostat',
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname === '/api/appointments/visit' && request.method() === 'POST') {
      visitBodies.push(request.postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          visitGroupId: '9',
          items: [
            { id: '601', appointmentReference: 'APT-2026-00601', appointmentDate: '2026-10-12' },
            { id: '602', appointmentReference: 'APT-2026-00602', appointmentDate: '2026-10-13' },
          ],
        }),
      });
      return;
    }
    if (url.pathname === '/api/technicians' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ technicians: [{ id: '7', name: 'Aisha Technician' }] }),
      });
      return;
    }
    if (url.pathname === '/api/appointments/501/schedule' && request.method() === 'PATCH') {
      scheduleBodies.push(request.postDataJSON());
      await route.fulfill({
        status: scheduleStatus,
        contentType: scheduleStatus === 200 ? 'application/json' : 'application/problem+json',
        body: JSON.stringify(
          scheduleStatus === 200
            ? {
                appointment: {
                  ...currentAppointment,
                  ...(request.postDataJSON() as object),
                },
              }
            : {
                detail:
                  scheduleDetail ||
                  'The technician already has an appointment at the requested time.',
              },
        ),
      });
      return;
    }
    await route.continue();
  });

  return {
    scheduleBodies,
    visitBodies,
    lookupUrls,
    draftCalls,
    listUrls,
    get detailRequests() {
      return detailRequests;
    },
  };
}

async function signInAndOpenAppointments(page: import('@playwright/test').Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('scheduler@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#complaintsNav').dispatchEvent('click');
  await page.locator('#schedulesNav').click();
}

test.describe('Phase4 appointment calendar and recovery', () => {
  test('loads month and week windows and navigates the calendar', async ({ page }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);

    await expect(page.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
    // Month grids are whole weeks (35 or 42 cells depending on the real month).
    await expect
      .poll(async () => {
        const cells = await page.locator('#appointmentCalendar .calendar-cell').count();
        return [35, 42].includes(cells);
      })
      .toBe(true);
    await expect(page.locator('#calendarMonthButton')).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(api.listUrls.at(-1)!).searchParams.get('pageSize')).toBe('100');
    expect(new URL(api.listUrls.at(-1)!).searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: 'Week' }).click();
    await expect(page.locator('#appointmentCalendar .calendar-cell')).toHaveCount(7);
    await expect(page.locator('#calendarWeekButton')).toHaveAttribute('aria-pressed', 'true');
    const weekUrl = new URL(api.listUrls.at(-1)!);
    expect(weekUrl.searchParams.get('to')).not.toBe(weekUrl.searchParams.get('from'));

    const previousUrl = api.listUrls.at(-1);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => api.listUrls.at(-1)).not.toBe(previousUrl);
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('#appointmentCalendar')).toBeVisible();
  });

  test('keeps the All appointments list in step with the calendar period and date filters', async ({
    page,
  }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await expect(page.locator('#appointmentListRange')).toContainText(
      new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    );
    const listCalls = () =>
      api.listUrls
        .map((url) => new URL(url))
        .filter((url) => url.searchParams.get('pageSize') === '100');
    const last = () => listCalls().at(-1)!.searchParams;

    // Month view: the list is requested for the whole calendar month, not a fixed 50.
    expect(last().get('from')).toMatch(/^\d{4}-\d{2}-01$/);

    await page.getByRole('button', { name: 'Week' }).click();
    await expect
      .poll(() => {
        const from = last().get('from')!;
        const to = last().get('to')!;
        return (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
      })
      .toBe(6);

    const before = last().get('from');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => last().get('from')).not.toBe(before);

    // A manual date filter wins over the calendar period.
    await page.locator('#appointmentFrom').fill('2026-03-05');
    await page.locator('#appointmentTo').fill('2026-03-09');
    await page.locator('#appointmentTo').dispatchEvent('change');
    await expect.poll(() => last().get('from')).toBe('2026-03-05');
    expect(last().get('to')).toBe('2026-03-09');
    await expect(page.locator('#appointmentListRange')).toContainText('5 Mar 2026');

    // Moving the calendar replaces the filter with the new period.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#appointmentFrom')).toHaveValue('');
    await expect.poll(() => last().get('from')).not.toBe('2026-03-05');
  });

  test('Schedules is one sidebar page with Appointments, New request and Daily schedule tabs', async ({
    page,
  }) => {
    await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await expect(page.locator('#appointmentsNav')).toBeHidden();
    await expect(page.locator('#newRequestNav')).toBeHidden();
    await expect(page.locator('#dailyListNav')).toBeHidden();
    await expect(page.locator('#schedulesNav')).toHaveAttribute('aria-current', 'page');
    const tabs = page.locator('#schedulesTabs');
    await expect(tabs.getByRole('tab')).toHaveText([
      /^\s*Appointments\s*$/,
      /^\s*New request\s*$/,
      /^\s*Daily schedule\s*$/,
      /^\s*Awaiting/,
    ]);
    await expect(tabs.getByRole('tab', { name: 'Appointments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#appointmentWorkspace')).toBeVisible();

    await tabs.getByRole('tab', { name: 'New request' }).click();
    await expect(page.locator('#newComplaintWorkspace')).toBeVisible();
    await expect(page.locator('#appointmentWorkspace')).toBeHidden();
    await expect(page.locator('#newComplaintWorkspace #schedulesTabs')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();

    await page.locator('#schedulesTabs').getByRole('tab', { name: 'Daily schedule' }).click();
    await expect(page.locator('#dailyListWorkspace')).toBeVisible();
    await expect(page.locator('#dailyListWorkspace #schedulesTabs')).toBeVisible();
    await expect(page.locator('#schedulesNav')).toHaveAttribute('aria-current', 'page');

    await page.locator('#schedulesTabs').getByRole('tab', { name: 'Appointments' }).click();
    await expect(page.locator('#appointmentWorkspace')).toBeVisible();

    await page.locator('#dashboardNav').dispatchEvent('click');
    await expect(page.locator('#schedulesTabs')).toBeHidden();
    await expect(page.locator('#schedulesNav')).toHaveAttribute('aria-current', 'false');
  });

  test('New request books several items as one visit and warns when an item changes date', async ({
    page,
  }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await page.locator('#schedulesTabs').getByRole('tab', { name: 'New request' }).click();
    await page.locator('#newComplaintSource').selectOption('Phone');
    await page.locator('#newComplaintAppointmentDate').fill('2026-10-12');
    await page.locator('#newComplaintCustomerType').selectOption('B2C');
    await page.locator('#newComplaintCustomerName').fill('Visit Customer');
    await page.locator('#newComplaintContactNumber').fill('0500000001');
    await page.locator('#newComplaintBrand').fill('LG');
    await page.locator('#newComplaintDescription').fill('Washer not spinning');
    await page.locator('#newComplaintSerialNo').fill('VN4501234');
    await page.locator('#newComplaintInvoiceNumber').fill('16101234');
    await page.locator('#newComplaintInvoiceDate').fill('2025-03-12');
    await page.locator('#newComplaintReceivedDate').fill('2025-03-20');
    await expect(page.locator('#submitNewComplaintButton')).toHaveText('Book appointment');

    await page.locator('#addVisitItemButton').click();
    await expect(page.locator('#submitNewComplaintButton')).toHaveText('Book all 2 items');
    const item = page.locator('#visitExtraItems .visit-item').first();
    await expect(item.locator('[data-v="appointmentDate"]')).toHaveValue('2026-10-12');
    await expect(item.locator('[data-visit-notice]')).toBeHidden();

    // The item needs its own issue text.
    await page.locator('#submitNewComplaintButton').click();
    await expect(item.locator('[data-visit-error]')).toHaveText('Describe the issue.');
    expect(api.visitBodies).toHaveLength(0);

    await item.locator('[data-v="model"]').fill('Fridge');
    await item.locator('[data-v="serialNo"]').fill('SN-FRIDGE-1');
    await item.locator('[data-v="invoiceDate"]').fill('2025-01-02');
    await item.locator('[data-v="faultDescription"]').fill('Fridge not cooling');
    await item.locator('[data-v="appointmentDate"]').fill('2026-10-13');
    await item.locator('[data-v="appointmentDate"]').dispatchEvent('change');
    await expect(item.locator('[data-visit-notice]')).toBeVisible();
    await expect(item.locator('[data-visit-notice]')).toContainText('same customer');

    await page.locator('#submitNewComplaintButton').click();
    await expect.poll(() => api.visitBodies.length).toBe(1);
    const body = api.visitBodies[0] as Record<string, any>;
    expect(body).toMatchObject({
      customerName: 'Visit Customer',
      appointmentDate: '2026-10-12',
      complaintSource: 'Phone',
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      brand: 'LG',
      faultDescription: 'Washer not spinning',
      serialNo: 'VN4501234',
      invoiceNumber: '16101234',
      invoiceDate: '2025-03-12',
      receivedDate: '2025-03-20',
    });
    expect(body.items[1]).toMatchObject({
      serialNo: 'SN-FRIDGE-1',
      invoiceDate: '2025-01-02',
    });
    expect(body.items[1].invoiceNumber).toBeUndefined();
    expect(body.items[1]).toMatchObject({
      model: 'Fridge',
      faultDescription: 'Fridge not cooling',
      appointmentDate: '2026-10-13',
    });
    await expect(page.locator('#newComplaintReference')).toHaveText(
      'APT-2026-00601, APT-2026-00602',
    );
  });

  test('Awaiting tab lists saved visit drafts with age colours and finishes one', async ({
    page,
  }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    const tabs = page.locator('#schedulesTabs');
    await expect(tabs.getByRole('tab', { name: /Awaiting/ })).toBeVisible();
    await expect(page.locator('#visitDraftsTabCount')).toHaveText('2');

    await tabs.getByRole('tab', { name: /Awaiting/ }).click();
    await expect(page.locator('#visitDraftsWorkspace')).toBeVisible();
    await expect(
      page.locator('#visitDraftsWorkspace tr[data-draft-id="71"] .draft-age'),
    ).toHaveClass(/age-late/);
    await expect(
      page.locator('#visitDraftsWorkspace tr[data-draft-id="72"] .draft-age'),
    ).toHaveClass(/age-warn/);

    // Finish draft 71: both items land in the form.
    await page.locator('tr[data-draft-id="71"] [data-draft-open]').click();
    await expect(page.locator('#newComplaintCustomerName')).toHaveValue('Late Customer');
    await expect(page.locator('#newComplaintBrand')).toHaveValue('LG');
    await expect(page.locator('#visitExtraItems .visit-item')).toHaveCount(1);
    await expect(page.locator('#submitNewComplaintButton')).toHaveText('Book all 2 items');
    await page.locator('#newComplaintSource').selectOption('Phone');

    // Book item 1 now and keep item 2 as a draft.
    await page.locator('#visitExtraItems [data-visit-later]').check();
    await expect(page.locator('#submitNewComplaintButton')).toHaveText('Book item 1 now');
    await page.locator('#submitNewComplaintButton').click();
    await expect.poll(() => api.draftCalls.filter((call) => call.method === 'PUT').length).toBe(1);
    const put = api.draftCalls.find((call) => call.method === 'PUT')!;
    expect(put.path).toBe('/api/appointments/visit-drafts/71');
    expect(put.body?.items).toHaveLength(1);
    expect(put.body?.items[0]).toMatchObject({ brand: 'Bosch' });
    await expect(page.locator('#newComplaintSuccessNote')).toContainText('kept as a draft');
  });

  test('Save visit as draft stores the form and opens the Awaiting tab', async ({ page }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await page.locator('#schedulesTabs').getByRole('tab', { name: 'New request' }).click();
    await page.locator('#saveVisitDraftButton').click();
    await expect(page.locator('[data-error-for="newComplaintCustomerName"]')).toContainText(
      'customer name',
    );
    await page.locator('#newComplaintCustomerName').fill('Later Customer');
    await page.locator('#newComplaintBrand').fill('Philips');
    await page.locator('#addVisitItemButton').click();
    await page.locator('#visitExtraItems [data-v="brand"]').fill('Venus');
    await page.locator('#saveVisitDraftButton').click();
    await expect(page.locator('#visitDraftsWorkspace')).toBeVisible();
    const post = api.draftCalls.find((call) => call.method === 'POST')!;
    expect(post.body).toMatchObject({ customerName: 'Later Customer' });
    expect(post.body?.items).toEqual([{ brand: 'Philips' }, { brand: 'Venus' }]);
    await expect(page.locator('#visitDraftsWorkspace tr[data-draft-id="99"]')).toBeVisible();
  });

  test('Duplicate as new request copies the customer, leaves date blank, and can repeat the appliance', async ({
    page,
  }) => {
    await installStaffApi(page, {
      appointment: {
        ...appointment,
        status: 'Completed',
        brand: 'LG',
        model: 'FWM 8kg Washer',
        address: 'Villa 12, Marina',
        customerType: 'B2C',
        itemCode: 'SN-123',
        jobWarranty: 'Out Warranty',
      } as typeof appointment,
    });
    await signInAndOpenAppointments(page);
    await page.locator('[data-appointment-id="501"]').click();
    await page.locator('#duplicateAppointmentButton').click();

    await expect(page.locator('#newComplaintWorkspace')).toBeVisible();
    await expect(page.locator('#duplicateStrip')).toBeVisible();
    await expect(page.locator('#duplicateStripTitle')).toContainText('APT-2026-00001');
    await expect(page.locator('#duplicateStripTitle')).toContainText('LG FWM 8kg Washer');
    await expect(page.locator('#newComplaintCustomerName')).toHaveValue('Calendar Customer');
    await expect(page.locator('#newComplaintAddress')).toHaveValue('Villa 12, Marina');
    await expect(page.locator('#newComplaintAppointmentDate')).toHaveValue('');
    await expect(page.locator('#newComplaintBrand')).toHaveValue('');

    await page.locator('[data-dup-mode="same"]').click();
    await expect(page.locator('#newComplaintBrand')).toHaveValue('LG');
    await expect(page.locator('#newComplaintSerialOrItemCode')).toHaveValue('SN-123');
    await expect(page.locator('#newComplaintDescription')).toHaveValue(
      /Repeat visit \(previous APT-2026-00001\)/,
    );
    await page.locator('[data-dup-mode="new"]').click();
    await expect(page.locator('#newComplaintBrand')).toHaveValue('');
    await expect(page.locator('#newComplaintCustomerName')).toHaveValue('Calendar Customer');

    // Also from the list row.
    await page.locator('#schedulesTabs').getByRole('tab', { name: 'Appointments' }).click();
    await page.locator('[data-appointment-duplicate="501"]').click();
    await expect(page.locator('#duplicateStrip')).toBeVisible();
    await expect(page.locator('#newComplaintCustomerName')).toHaveValue('Calendar Customer');
  });

  test('New request finds a repeat customer by phone and copies the customer and appliances', async ({
    page,
  }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await page.locator('#schedulesTabs').getByRole('tab', { name: 'New request' }).click();

    // Too short: no request.
    await page.locator('#newComplaintContactNumber').fill('0501');
    await page.waitForTimeout(700);
    expect(api.lookupUrls).toHaveLength(0);

    await page.locator('#newComplaintContactNumber').fill('0501234567');
    await expect(page.locator('#repeatLookup')).toContainText('1 customer found');
    expect(api.lookupUrls).toHaveLength(1);
    expect(api.lookupUrls[0]).toContain('phone=0501234567');
    await expect(page.locator('#repeatLookup')).toContainText('APT-2026-00417');
    await expect(page.locator('#repeatLookup')).toContainText('Cancelled');

    await page.locator('[data-rl-use]').click();
    await expect(page.locator('#newComplaintCustomerName')).toHaveValue('Sara Khan');
    await expect(page.locator('#newComplaintAddress')).toHaveValue('Villa 12, Marina');
    await expect(page.locator('#newComplaintAppointmentDate')).toHaveValue('');

    // First appliance goes to item 1, the next one becomes another item of the visit.
    await page.locator('[data-rl-copy="417"]').click();
    await expect(page.locator('#newComplaintBrand')).toHaveValue('LG');
    await expect(page.locator('#visitExtraItems .visit-item')).toHaveCount(0);
    await page.locator('[data-rl-same="188"]').click();
    await expect(page.locator('#visitExtraItems .visit-item')).toHaveCount(1);
    const item = page.locator('#visitExtraItems .visit-item').first();
    await expect(item.locator('[data-v="brand"]')).toHaveValue('Bosch');
    await expect(item.locator('[data-v="faultDescription"]')).toHaveValue(
      /Repeat visit \(previous APT-2026-00188\)/,
    );
    await expect(page.locator('#submitNewComplaintButton')).toHaveText('Book all 2 items');

    await page.locator('[data-rl-close]').click();
    await expect(page.locator('#repeatLookupField')).toBeHidden();
  });

  test('reschedules through the accessible form and refreshes authoritative state', async ({
    page,
  }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();

    await page.locator('#appointmentRescheduleDate').fill('2026-10-12');
    await page.getByRole('button', { name: 'Save schedule' }).click();

    await expect(page.locator('#workspaceMessage')).toHaveText('Appointment schedule updated.');
    expect(api.scheduleBodies).toEqual([{ appointmentDate: '2026-10-12' }]);
    expect(api.detailRequests).toBeGreaterThanOrEqual(2);
  });

  test('refreshes state after a rescheduling conflict', async ({ page }) => {
    const api = await installStaffApi(page, {
      scheduleStatus: 409,
      scheduleDetail: 'The technician already has an appointment at the requested time.',
    });
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await page.locator('#appointmentRescheduleDate').fill('2026-10-12');
    await page.getByRole('button', { name: 'Save schedule' }).click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'The technician already has an appointment at the requested time.',
    );
    expect(api.scheduleBodies).toHaveLength(1);
    expect(api.detailRequests).toBeGreaterThanOrEqual(2);
  });

  test('prints the appointment sheet in grouped sections and flags missing required details', async ({
    page,
  }) => {
    await installStaffApi(page, {
      appointment: {
        ...appointment,
        customerType: 'B2B',
        technicianName: 'Aisha Technician',
        address: 'RAK',
        brand: 'VENUS',
        model: 'VM655 Fridge',
        jobWarranty: 'Out Warranty',
        faultDescription: 'Fridge not cooling',
      } as typeof appointment,
    });
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#printAppointmentButton').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.locator('.apt-sec h3')).toHaveText([
      'Customer details',
      'Product details',
      /^Purchase details/,
    ]);
    await expect(popup.locator('.apt-card .apt-kicker')).toHaveText(['Customer', 'Visit']);
    // Required and entered: bold cell; required and missing: red "Not entered".
    await expect(popup.locator('td.req', { hasText: 'Calendar Customer' })).toBeVisible();
    await expect(popup.locator('td.req', { hasText: 'VENUS' })).toBeVisible();
    await expect(popup.locator('td.gap')).toHaveCount(2); // sub group and item code
    await expect(popup.locator('td.gap').first()).toHaveText(
      'Not entered \u2014 confirm with customer',
    );
    await expect(popup.locator('.block', { hasText: 'Fridge not cooling' })).toBeVisible();
    await expect(popup.locator('input[type="checkbox"]')).toHaveCount(0);
    // Purchase details are optional: all four blank print as ruled write-in lines, not red gaps.
    await expect(
      popup.locator('.apt-sec', { hasText: 'Purchase details' }).locator('.write-line'),
    ).toHaveCount(4);
    await expect(popup.locator('.apt-sec', { hasText: 'Purchase details' })).toContainText('S/N');
    await expect(popup.locator('.apt-card', { hasText: 'Complaint source' })).toBeVisible();
  });

  test('prints entered purchase details as values and keeps write-in lines only for blank ones', async ({
    page,
  }) => {
    await installStaffApi(page, {
      appointment: {
        ...appointment,
        serialNo: 'VN4501234',
        invoiceNumber: null,
        invoiceDate: '2025-03-12',
        receivedDate: null,
      } as typeof appointment,
    });
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#printAppointmentButton').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const sec = popup.locator('.apt-sec', { hasText: 'Purchase details' });
    await expect(sec.locator('td', { hasText: 'VN4501234' })).toBeVisible();
    await expect(sec.locator('td', { hasText: '12 Mar 2025' })).toBeVisible();
    await expect(sec.locator('.write-line')).toHaveCount(2);
    await expect(sec).toContainText('technician writes in');
  });

  test('hides rescheduling for terminal appointments', async ({ page }) => {
    await installStaffApi(page, { appointment: { ...appointment, status: 'Completed' } });
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();

    await expect(page.locator('#appointmentScheduleAction')).toBeHidden();
    await expect(page.locator('#appointmentNextStatus')).toBeDisabled();
  });

  test('shows retry and return recovery for a missing appointment detail', async ({ page }) => {
    await installStaffApi(page, { detailStatus: 404 });
    await signInAndOpenAppointments(page);
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();

    await expect(page.locator('#appointmentDetail')).toBeHidden();
    await expect(page.locator('#workspaceRecoveryMessage')).toHaveText(
      'This appointment no longer exists. Return to the appointment list and try again.',
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to appointments' })).toBeVisible();
  });
});
