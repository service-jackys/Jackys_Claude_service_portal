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
  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
}

test.describe('Phase4 appointment calendar and recovery', () => {
  test('loads month and week windows and navigates the calendar', async ({ page }) => {
    const api = await installStaffApi(page);
    await signInAndOpenAppointments(page);

    await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible();
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
