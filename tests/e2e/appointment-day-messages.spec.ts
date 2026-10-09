import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Json = Record<string, unknown>;

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = isoDate(0);
const tomorrow = isoDate(1);

function appt(id: string, ref: string, date: string, status: string, name: string): Json {
  return {
    id,
    appointmentReference: ref,
    customerName: name,
    contactNumber: '0501234567',
    customerEmail: 'c@example.test',
    appointmentDate: date,
    status,
    technicianId: '7',
    technicianName: 'Siva',
    region: 'Dubai',
    faultDescription: 'Not cooling',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const all = [
  appt('1', 'APT-2026-00001', today, 'Scheduled', 'Today Open'),
  appt('2', 'APT-2026-00002', today, 'Completed', 'Today Done'),
  appt('3', 'APT-2026-00003', tomorrow, 'Scheduled', 'Tomorrow Open'),
];

const draft = (template: string, label: string, type: string) => ({
  template,
  label,
  recipientType: type,
  recipientName: 'Someone',
  phone: '0501234567',
  whatsappNumber: '971501234567',
  email: type === 'customer' ? 'c@example.test' : null,
  subject: 'Subject',
  body: 'Hello there',
  whatsappUnavailableReason: null,
  emailUnavailableReason: type === 'customer' ? null : 'The technician has no email address.',
});

async function setup(page: Page) {
  const listUrls: URL[] = [];
  const posted: Json[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { name: 'Tester', email: 't@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/appointments' && request.method() === 'GET') {
      listUrls.push(url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const rows = all.filter(
        (a) =>
          (!from || (a.appointmentDate as string) >= from) &&
          (!to || (a.appointmentDate as string) <= to),
      );
      return json({
        appointments: rows,
        pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 },
      });
    }
    const detail = /^\/api\/appointments\/(\d+)$/.exec(url.pathname);
    if (detail) {
      const found = all.find((a) => a.id === detail[1]);
      return json({ appointment: found, history: [] });
    }
    const messages = /^\/api\/appointments\/(\d+)\/messages$/.exec(url.pathname);
    if (messages && request.method() === 'GET') {
      const found = all.find((a) => a.id === messages[1])!;
      const open = found.status === 'Scheduled' || found.status === 'In Progress';
      return json({
        canSend: open,
        drafts: open
          ? [
              draft('customer_booked', 'Customer: appointment booked', 'customer'),
              draft('technician_assigned', 'Technician: new job assigned', 'technician'),
            ]
          : [],
        history: [],
      });
    }
    if (messages && request.method() === 'POST') {
      posted.push(request.postDataJSON() as Json);
      return json({ message: { id: '9' }, url: 'about:blank#sent' }, 201);
    }
    if (url.pathname === '/api/technicians') return json({ technicians: [] });
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('t@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  await page.locator('#appointmentsNav').dispatchEvent('click');
  await expect(page.locator('#appointmentsBody tr')).toHaveCount(3);
  return { listUrls, posted };
}

test.describe('appointment calendar day select and messages', () => {
  test('clicking a day filters the list and Show all dates clears it', async ({ page }) => {
    const api = await setup(page);
    await expect(page.locator('#appointmentDayBar')).toBeHidden();

    await page.locator(`[data-cal-day="${tomorrow}"]`).click();
    await expect(page.locator('#appointmentsBody tr')).toHaveCount(1);
    await expect(page.locator('#appointmentsBody')).toContainText('APT-2026-00003');
    await expect(page.locator('#appointmentDayBar')).toBeVisible();
    await expect(page.locator('#appointmentFrom')).toHaveValue(tomorrow);
    await expect(page.locator('#appointmentTo')).toHaveValue(tomorrow);
    await expect(page.locator(`[data-calendar-date="${tomorrow}"]`)).toHaveClass(/is-selected/);
    expect(
      api.listUrls.some(
        (u) => u.searchParams.get('from') === tomorrow && u.searchParams.get('to') === tomorrow,
      ),
    ).toBe(true);

    await page.locator('#appointmentDayClearButton').click();
    await expect(page.locator('#appointmentsBody tr')).toHaveCount(3);
    await expect(page.locator('#appointmentDayBar')).toBeHidden();
    await expect(page.locator('#appointmentFrom')).toHaveValue('');
  });

  test('clicking the selected day again clears the selection', async ({ page }) => {
    await setup(page);
    await page.locator(`[data-cal-day="${today}"]`).click();
    await expect(page.locator('#appointmentsBody tr')).toHaveCount(2);
    await page.locator(`[data-cal-day="${today}"]`).click();
    await expect(page.locator('#appointmentsBody tr')).toHaveCount(3);
  });

  test('Message action shows only on open appointments and sends through the API', async ({
    page,
  }) => {
    const api = await setup(page);
    await expect(page.locator('[data-appointment-message]')).toHaveCount(2);
    await expect(
      page.locator('tr', { hasText: 'APT-2026-00002' }).locator('[data-appointment-message]'),
    ).toHaveCount(0);

    await page
      .locator('tr', { hasText: 'APT-2026-00001' })
      .locator('[data-appointment-message]')
      .click();
    await expect(page.locator('#appointmentMessagePanel')).toBeVisible();
    await expect(page.locator('#appointmentMessageDrafts .msg-draft')).toHaveCount(2);
    // Technician has no email, so that button is disabled and says why.
    await expect(
      page.locator('[data-message-template="technician_assigned"][data-message-channel="email"]'),
    ).toBeDisabled();

    await page
      .locator('[data-message-template="customer_booked"][data-message-channel="whatsapp"]')
      .click();
    await expect.poll(() => api.posted.length).toBe(1);
    expect(api.posted[0]).toEqual({ template: 'customer_booked', channel: 'whatsapp' });
  });

  test('closed appointments show no message panel', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'APT-2026-00002' }).click();
    await expect(page.locator('#appointmentDetail')).toBeVisible();
    await expect(page.locator('#appointmentMessagePanel')).toBeHidden();
  });
});
