import { expect, test } from '@playwright/test';

test.describe('staff access boundary', () => {
  test('allows an authorized staff member to update complaint notes and status', async ({
    page,
  }) => {
    let notesBody = null;
    let statusBody = null;
    let detailRequests = 0;
    const complaintListUrls: string[] = [];
    const complaint = {
      id: '101',
      complaintReference: 'JSC-20260926-0001',
      customerType: 'individual',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      description: 'Test complaint',
      status: 'New',
      cceNotes: 'Existing note',
      submittedAt: '2026-09-26T08:00:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
    };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/auth/login') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'test-token',
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
              role: 'admin',
              permissions: ['*'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/auth/me') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
              role: 'admin',
              permissions: ['*'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/complaints' && request.method() === 'GET') {
        complaintListUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaints: [complaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101' && request.method() === 'GET') {
        detailRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101/notes' && request.method() === 'POST') {
        notesBody = request.postDataJSON();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101/status' && request.method() === 'PATCH') {
        statusBody = request.postDataJSON();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: { ...complaint, status: statusBody.status } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('vysakh.raju@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Existing note');
    await page.getByLabel('Notes', { exact: true }).fill('Followed up with customer.');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Notes saved.');
    expect(notesBody).toEqual({ notes: 'Followed up with customer.' });

    await page.locator('#complaintNextStatus').selectOption('Under Review');
    await page.locator('#complaintStatusReason').fill('Initial review started.');
    await page.locator('#statusForm').getByRole('button', { name: 'Update status' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Complaint status updated.');
    expect(statusBody).toEqual({ status: 'Under Review', reason: 'Initial review started.' });
    expect(detailRequests).toBeGreaterThanOrEqual(3);

    await page.getByRole('button', { name: 'Service requests' }).click();
    await expect(page.getByRole('heading', { name: 'Service requests' })).toBeVisible();
    await expect(page.locator('#workspaceDescription')).toHaveText(
      'Review complaints that are ready to be scheduled.',
    );
    await expect(page.locator('#complaintStatusFilter')).toHaveValue('Ready for Scheduling');
    await expect(page.locator('#complaintStatusFilter')).toBeDisabled();
    expect(complaintListUrls.at(-1)).toContain('status=Ready+for+Scheduling');
  });

  test('allows an authorized staff member to schedule a ready complaint', async ({ page }) => {
    let complaintStatus = 'Ready for Scheduling';
    let appointmentBody = null;
    const technicianUrls: string[] = [];
    const complaint = {
      id: '101',
      complaintReference: 'JSC-20260926-0001',
      customerType: 'individual',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      description: 'Test complaint',
      cceNotes: 'Existing note',
      submittedAt: '2026-09-26T08:00:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
    };
    const technician = { id: '7', name: 'Aisha Technician', active: true, region: 'Dubai' };

    await page.route('**/api/**', async (route) => {
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
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
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
          body: JSON.stringify({ complaints: [{ ...complaint, status: complaintStatus }] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            complaint: { ...complaint, status: complaintStatus },
            history: [],
          }),
        });
        return;
      }
      if (url.pathname === '/api/technicians' && request.method() === 'GET') {
        technicianUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            technicians: [technician],
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments' && request.method() === 'POST') {
        appointmentBody = request.postDataJSON();
        complaintStatus = 'Scheduled';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            appointment: {
              id: '501',
              appointmentReference: 'APT-2026-00001',
              appointmentDate: '2026-10-05',
              appointmentTime: '09:00',
              status: 'Scheduled',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('vysakh.raju@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Service requests' }).click();
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    await expect(page.locator('#scheduleAction')).toBeVisible();
    await page.locator('#appointmentDate').fill('2026-10-05');
    await page.locator('#appointmentTime').fill('09:00');
    await page.getByRole('button', { name: 'Find available technicians' }).click();
    await expect(page.locator('#technicianId')).toBeEnabled();
    await expect(page.locator('#technicianId')).toContainText('Aisha Technician');
    expect(technicianUrls.at(-1)).toContain('active=true');
    expect(technicianUrls.at(-1)).toContain('availableDate=2026-10-05');
    expect(technicianUrls.at(-1)).toContain('availableTime=09%3A00');

    await page.locator('#technicianId').selectOption('7');
    await page.getByRole('button', { name: 'Schedule appointment' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Appointment APT-2026-00001 scheduled successfully.',
    );
    expect(appointmentBody).toEqual({
      complaintId: '101',
      technicianId: '7',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
    });
    await expect(page.locator('#detailStatus')).toContainText('Scheduled');
    await expect(page.locator('#scheduleAction')).toBeHidden();
  });

  test('hides appointment scheduling without appointment-write permission', async ({ page }) => {
    const complaint = {
      id: '101',
      complaintReference: 'JSC-20260926-0001',
      customerType: 'individual',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      description: 'Test complaint',
      status: 'Ready for Scheduling',
    };
    let technicianRequests = 0;

    await page.route('**/api/**', async (route) => {
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
              name: 'Read Only',
              email: 'readonly@jackys.com',
              role: 'user',
              permissions: ['complaints.read', 'technicians.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/complaints' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaints: [complaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/technicians') technicianRequests += 1;
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('readonly@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Service requests' }).click();
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    await expect(page.locator('#scheduleAction')).toBeHidden();
    expect(technicianRequests).toBe(0);
  });

  test('shows scheduling validation and server conflicts', async ({ page }) => {
    let appointmentRequests = 0;
    let detailRequests = 0;
    const complaint = {
      id: '101',
      complaintReference: 'JSC-20260926-0001',
      customerType: 'individual',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      description: 'Test complaint',
      status: 'Ready for Scheduling',
    };

    await page.route('**/api/**', async (route) => {
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
          body: JSON.stringify({ complaints: [complaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101' && request.method() === 'GET') {
        detailRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint, history: [] }),
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
      if (url.pathname === '/api/appointments' && request.method() === 'POST') {
        appointmentRequests += 1;
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            detail: 'The technician already has an appointment at the requested time.',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('scheduler@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Service requests' }).click();
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    await page.getByRole('button', { name: 'Schedule appointment' }).click();
    await expect(page.locator('[data-error-for="appointmentDate"]')).toHaveText(
      'Select an appointment date.',
    );
    await expect(page.locator('[data-error-for="appointmentTime"]')).toHaveText(
      'Select an appointment time.',
    );
    await expect(page.locator('[data-error-for="technicianId"]')).toHaveText(
      'Select an available technician.',
    );
    expect(appointmentRequests).toBe(0);

    await page.locator('#appointmentDate').fill('2026-10-05');
    await page.locator('#appointmentTime').fill('09:00');
    await page.getByRole('button', { name: 'Find available technicians' }).click();
    await page.locator('#technicianId').selectOption('7');
    await page.getByRole('button', { name: 'Schedule appointment' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText(
      'The technician already has an appointment at the requested time.',
    );
    expect(detailRequests).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#scheduleAction')).toBeVisible();
  });

  test('keeps the protected workspace behind sign in', async ({ page }) => {
    const response = await page.request.get('/api/complaints');
    expect(response.status()).toBe(401);

    await page.goto('/portal/');
    await expect(page.getByRole('heading', { name: 'Staff workspace' })).toBeVisible();
    await expect(page.locator('#staff-workspace')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'First-time setup' })).toBeVisible();
  });

  test('lists, filters, and opens appointment details with history', async ({ page }) => {
    const appointmentListUrls: string[] = [];
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      customerEmail: 'customer@example.com',
      complaintId: '101',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      technicianId: '7',
      region: 'Dubai',
      address: 'Test address',
      brand: 'Jacky',
      model: 'Model X',
      faultDescription: 'Test complaint',
      status: 'Scheduled',
      createdAt: '2026-09-26T08:00:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
    };
    const history = [
      {
        fromStatus: null,
        toStatus: 'Scheduled',
        reason: 'Appointment created.',
        changedAt: '2026-09-26T08:00:00.000Z',
      },
      {
        fromStatus: 'Ready for Scheduling',
        toStatus: 'Scheduled',
        reason: 'Technician assigned.',
        changedAt: '2026-09-26T08:05:00.000Z',
      },
    ];

    await page.route('**/api/**', async (route) => {
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
        appointmentListUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            appointments: [appointment],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history }),
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
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('scheduler@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'APT-2026-00001' })).toBeVisible();
    await page.locator('#appointmentSearch').fill('APT-2026');
    await page.locator('#appointmentStatusFilter').selectOption('Scheduled');
    await page.locator('#appointmentFrom').fill('2026-10-01');
    await page.locator('#appointmentTo').fill('2026-10-31');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect.poll(() => appointmentListUrls.at(-1)).toContain('search=APT-2026');
    const filteredUrl = new URL(appointmentListUrls.at(-1)!);
    expect(filteredUrl.searchParams.get('status')).toBe('Scheduled');
    expect(filteredUrl.searchParams.get('from')).toBe('2026-10-01');
    expect(filteredUrl.searchParams.get('to')).toBe('2026-10-31');

    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await expect(page.locator('#appointmentDetail')).toBeVisible();
    await expect(page.locator('#appointmentDetailHeading')).toHaveText('APT-2026-00001');
    await expect(page.locator('#appointmentDetailGrid')).toContainText('Local Test Customer');
    await expect(page.locator('#appointmentHistoryList')).toContainText(
      'Ready for Scheduling → Scheduled',
    );
    await expect(page.locator('#appointmentHistoryList')).toContainText('Technician assigned.');
  });

  test('assigns, unassigns, and changes appointment status', async ({ page }) => {
    let technicianId: string | null = '7';
    let status = 'Scheduled';
    const assignmentBodies: unknown[] = [];
    let statusBody: unknown = null;
    let detailRequests = 0;
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Local Test Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      region: 'Dubai',
      status,
    };

    await page.route('**/api/**', async (route) => {
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
            user: { name: 'Admin', email: 'admin@jackys.com', role: 'admin', permissions: ['*'] },
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
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            appointments: [{ ...appointment, technicianId, status }],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        detailRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            appointment: { ...appointment, technicianId, status },
            history: [],
          }),
        });
        return;
      }
      if (url.pathname === '/api/technicians' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            technicians: [
              { id: '7', name: 'Aisha Technician' },
              { id: '8', name: 'Bilal Technician' },
            ],
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/assignment' && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        assignmentBodies.push(body);
        technicianId = body.technicianId;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment: { ...appointment, technicianId, status } }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/status' && request.method() === 'PATCH') {
        const body = request.postDataJSON() as { status: string; reason?: string };
        statusBody = body;
        status = body.status;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment: { ...appointment, technicianId, status } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();

    await page.locator('#appointmentTechnician').selectOption('8');
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Technician assignment updated.');
    expect(assignmentBodies[0]).toEqual({ technicianId: '8' });

    await page.getByRole('button', { name: 'Unassign' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Technician assignment updated.');
    expect(assignmentBodies[1]).toEqual({ technicianId: null });

    await page.locator('#appointmentNextStatus').selectOption('In Progress');
    await page.locator('#appointmentStatusReason').fill('Technician started service work.');
    await expect(page.locator('#appointmentStatusReason')).toHaveValue(
      'Technician started service work.',
    );
    await page
      .locator('#appointmentStatusForm')
      .getByRole('button', { name: 'Update status' })
      .click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Appointment status updated.');
    expect(statusBody).toEqual({
      status: 'In Progress',
      reason: 'Technician started service work.',
    });
    await expect(page.locator('#appointmentDetailStatus')).toContainText('In Progress');
    expect(detailRequests).toBeGreaterThanOrEqual(4);
  });

  test('shows terminal appointment status controls without further transitions', async ({
    page,
  }) => {
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Completed Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      status: 'Completed',
    };

    await page.route('**/api/**', async (route) => {
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
            user: { name: 'Admin', email: 'admin@jackys.com', role: 'admin', permissions: ['*'] },
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
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/technicians' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ technicians: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();

    await expect(page.locator('#appointmentNextStatus')).toHaveValue('');
    await expect(page.locator('#appointmentNextStatus')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Update status' })).toBeDisabled();
  });

  test('downloads an authenticated appointment calendar file', async ({ page }) => {
    let icsAuthorization = '';
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Calendar Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      status: 'Scheduled',
    };

    await page.route('**/api/**', async (route) => {
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
            user: { name: 'Admin', email: 'admin@jackys.com', role: 'admin', permissions: ['*'] },
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
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/technicians' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ technicians: [] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/ics' && request.method() === 'GET') {
        icsAuthorization = request.headers().authorization || '';
        await route.fulfill({
          contentType: 'text/calendar',
          body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download calendar file' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('APT-2026-00001.ics');
    expect(icsAuthorization).toBe('Bearer test-token');
  });

  test('keeps read-only appointments access free of technician lookups', async ({ page }) => {
    let technicianRequests = 0;
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Read Only Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      technicianId: '7',
      status: 'Scheduled',
    };

    await page.route('**/api/**', async (route) => {
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
              name: 'Read Only',
              email: 'readonly@jackys.com',
              role: 'user',
              permissions: ['appointments.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/technicians') technicianRequests += 1;
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('readonly@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await expect(page.locator('#appointmentActions')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download calendar file' })).toBeVisible();
    expect(technicianRequests).toBe(0);
  });

  test('does not show or request appointments without read permission', async ({ page }) => {
    let appointmentRequests = 0;

    await page.route('**/api/**', async (route) => {
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
              name: 'Complaints User',
              email: 'user@jackys.com',
              role: 'user',
              permissions: ['complaints.read'],
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
      if (url.pathname === '/api/appointments') appointmentRequests += 1;
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('user@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Appointments', exact: true })).toBeHidden();
    expect(appointmentRequests).toBe(0);
  });

  test('refreshes appointment state after an assignment conflict', async ({ page }) => {
    let assignmentRequests = 0;
    let detailRequests = 0;
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Conflict Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      technicianId: '7',
      status: 'Scheduled',
    };

    await page.route('**/api/**', async (route) => {
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
            user: { name: 'Admin', email: 'admin@jackys.com', role: 'admin', permissions: ['*'] },
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
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        detailRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/technicians' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            technicians: [
              { id: '7', name: 'Aisha Technician' },
              { id: '8', name: 'Bilal Technician' },
            ],
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/assignment' && request.method() === 'PATCH') {
        assignmentRequests += 1;
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            detail: 'The technician already has an appointment at the requested time.',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await page.locator('#appointmentTechnician').selectOption('8');
    await page.getByRole('button', { name: 'Save assignment' }).click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'The technician already has an appointment at the requested time.',
    );
    expect(assignmentRequests).toBe(1);
    expect(detailRequests).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#appointmentTechnician')).toHaveValue('7');
  });

  for (const role of [
    {
      name: 'non-wildcard operational user',
      role: 'staff',
      permissions: ['complaints.read', 'appointments.read'],
    },
    {
      name: 'sales user',
      role: 'sales',
      permissions: [
        'complaints.read',
        'scheduler.read',
        'scheduler.write',
        'appointments.read',
        'appointments.write',
        'technicians.read',
        'technicians.write',
        'customers.read',
        'branches.read',
      ],
    },
    {
      name: 'management user',
      role: 'management',
      permissions: [
        'complaints.read',
        'scheduler.read',
        'scheduler.write',
        'appointments.read',
        'appointments.write',
        'technicians.read',
        'technicians.write',
        'customers.read',
        'branches.read',
      ],
    },
  ]) {
    test(`shows protected navigation for a ${role.name}`, async ({ page }) => {
      const complaintListRequests: string[] = [];
      const appointmentListRequests: string[] = [];

      await page.route('**/api/**', async (route) => {
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
                name: role.name,
                email: `${role.role}@jackys.com`,
                role: role.role,
                permissions: role.permissions,
              },
            }),
          });
          return;
        }
        if (url.pathname === '/api/complaints' && request.method() === 'GET') {
          complaintListRequests.push(request.url());
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ complaints: [] }),
          });
          return;
        }
        if (url.pathname === '/api/appointments' && request.method() === 'GET') {
          appointmentListRequests.push(request.url());
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ appointments: [] }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto('/portal/');
      await page.locator('#loginEmail').fill(`${role.role}@jackys.com`);
      await page.locator('#loginPassword').fill('local-password-1234');
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page.getByRole('heading', { name: 'Complaint inbox' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Complaint inbox', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Service requests', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Appointments', exact: true })).toBeVisible();
      expect(complaintListRequests).toHaveLength(1);
      expect(appointmentListRequests).toHaveLength(0);
    });
  }

  test('shows every protected navigation entry for a wildcard admin', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
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
              name: 'Administrator',
              email: 'admin@jackys.com',
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
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('admin@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Complaint inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Service requests', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Appointments', exact: true })).toBeVisible();
  });

  test('shows a clear no-access state without protected list requests', async ({ page }) => {
    let complaintListRequests = 0;
    let appointmentListRequests = 0;

    await page.route('**/api/**', async (route) => {
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
              name: 'Basic User',
              email: 'user@jackys.com',
              role: 'user',
              permissions: ['dashboard.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/complaints' && request.method() === 'GET') {
        complaintListRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaints: [] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments' && request.method() === 'GET') {
        appointmentListRequests += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('user@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'No workspace access' })).toBeVisible();
    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Ask an administrator to grant the required workspace permission.',
    );
    await expect(page.locator('#complaintsNav')).toBeHidden();
    await expect(page.locator('#serviceRequestsNav')).toBeHidden();
    await expect(page.locator('#appointmentsNav')).toBeHidden();
    expect(complaintListRequests).toBe(0);
    expect(appointmentListRequests).toBe(0);
  });
});

test.describe('service job-card workspace', () => {
  const openJobCard = {
    id: '701',
    jobCardReference: 'JBC-2026-00001',
    appointmentReference: 'APT-2026-00001',
    appointmentDate: '2026-10-05',
    appointmentTime: '09:00',
    customerName: 'Job Card Customer',
    contactNumber: '0500000000',
    faultDescription: 'The appliance does not start.',
    status: 'Open',
    finalizedAt: null,
    finalizedBy: null,
    createdAt: '2026-09-26T08:00:00.000Z',
    updatedAt: '2026-09-26T08:00:00.000Z',
  };

  test('lists, filters, opens, and updates a job card with history', async ({ page }) => {
    let status = 'Open';
    let statusBody: unknown = null;
    const listUrls: string[] = [];
    const history = [
      {
        fromStatus: null,
        toStatus: 'Open',
        reason: 'Job card created.',
        changedAt: '2026-09-26T08:00:00.000Z',
      },
    ];

    await page.route('**/api/**', async (route) => {
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
              name: 'Job Card Operator',
              email: 'jobcards@jackys.com',
              role: 'staff',
              permissions: ['service_job_card.read', 'service_job_card.write'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        listUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jobCards: [{ ...openJobCard, status }],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: { ...openJobCard, status }, history }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701/status' && request.method() === 'PATCH') {
        statusBody = request.postDataJSON();
        status = (statusBody as { status: string }).status;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: { ...openJobCard, status } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('jobcards@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Service job cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'JBC-2026-00001' })).toBeVisible();
    await page.locator('#jobCardSearch').fill('JBC-2026');
    await page.locator('#jobCardStatusFilter').selectOption('Open');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect.poll(() => listUrls.at(-1)).toContain('search=JBC-2026');
    expect(new URL(listUrls.at(-1)!).searchParams.get('status')).toBe('Open');

    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();
    await expect(page.locator('#jobCardDetail')).toBeVisible();
    await expect(page.locator('#jobCardDetailGrid')).toContainText('Job Card Customer');
    await expect(page.locator('#jobCardHistoryList')).toContainText('Job card created.');

    await page.locator('#jobCardNextStatus').selectOption('In Progress');
    await page.locator('#jobCardStatusReason').fill('Technician started work.');
    await page.locator('#jobCardStatusForm').getByRole('button', { name: 'Update status' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Service job-card status updated.');
    expect(statusBody).toEqual({ status: 'In Progress', reason: 'Technician started work.' });
    await expect(page.locator('#jobCardDetailStatus')).toContainText('In Progress');
  });

  test('keeps terminal job cards read-only for a read-only user', async ({ page }) => {
    const terminalJobCard = { ...openJobCard, status: 'Completed' };

    await page.route('**/api/**', async (route) => {
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
              name: 'Read Only Job Card User',
              email: 'readonly-jobcards@jackys.com',
              role: 'staff',
              permissions: ['service_job_card.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCards: [terminalJobCard] }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: terminalJobCard, history: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('readonly-jobcards@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();

    await expect(page.locator('#jobCardActions')).toBeHidden();
    await expect(page.locator('#jobCardNextStatus')).toBeDisabled();
  });

  test('shows no workspace access without job-card permission', async ({ page }) => {
    let jobCardRequests = 0;

    await page.route('**/api/**', async (route) => {
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
              name: 'Basic User',
              email: 'basic@jackys.com',
              role: 'staff',
              permissions: ['dashboard.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards') jobCardRequests += 1;
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('basic@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'No workspace access' })).toBeVisible();
    await expect(page.locator('#jobCardsNav')).toBeHidden();
    expect(jobCardRequests).toBe(0);
  });

  test('creates a job card from an appointment and opens its detail', async ({ page }) => {
    let createBody: unknown = null;
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Appointment Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      faultDescription: 'The appliance does not start.',
      status: 'Scheduled',
    };
    const createdJobCard = {
      ...openJobCard,
      appointmentReference: appointment.appointmentReference,
    };

    await page.route('**/api/**', async (route) => {
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
              name: 'Appointment Operator',
              email: 'appointments@jackys.com',
              role: 'staff',
              permissions: ['appointments.read', 'service_job_card.read', 'service_job_card.write'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: null }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card/prefill' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            content: {
              jobCardDate: '2026-10-05',
              customerName: appointment.customerName,
              customerContact: appointment.contactNumber,
              customerAddress: '',
              itemDescription: '',
              modelNo: '',
              brand: '',
              warrantyStatus: '',
              technicianName: '',
              complaint: appointment.faultDescription,
              serviceRendered: '',
              periodFrom: null,
              periodTo: null,
              serviceCharge: 0,
              amountChargeable: null,
              invoiceNo: '',
              deliveryDate: null,
              jobFinalStatus: 'WIP',
              schoolContactPerson: '',
              schoolContactNumber: '',
              customerNumber: '',
              legacyReference: '',
              parts: [],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card' && request.method() === 'POST') {
        createBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: createdJobCard }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCards: [createdJobCard] }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: createdJobCard, history: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('appointments@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await page.getByRole('button', { name: 'Create service job card' }).click();

    await expect(page.locator('#jobCardCreatePanel')).toBeVisible();
    await page.getByRole('button', { name: 'Create job card' }).click();

    await expect(page.getByRole('heading', { name: 'Service job cards' })).toBeVisible();
    await expect(page.locator('#jobCardDetailHeading')).toHaveText('JBC-2026-00001');
    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Service job card JBC-2026-00001 created.',
    );
    expect(createBody).not.toBeNull();
    expect((createBody as { customerName?: string }).customerName).toBe('Appointment Customer');
  });

  test('returns to sign in after the job-card queue returns unauthorized', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
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
              name: 'Job Card Operator',
              email: 'jobcards@jackys.com',
              role: 'staff',
              permissions: ['service_job_card.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          status: 401,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'Authentication is required.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('jobcards@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('#staff-workspace')).toBeHidden();
    await expect(page.locator('#authMessage')).toHaveText(
      'Your session has expired. Please sign in again.',
    );
  });

  test('shows retry recovery when the job-card queue returns forbidden', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
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
              name: 'Job Card Operator',
              email: 'jobcards@jackys.com',
              role: 'staff',
              permissions: ['service_job_card.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          status: 403,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'You are not authorized to view service job cards.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('jobcards@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('#workspaceRecoveryMessage')).toHaveText(
      'You are not authorized to view service job cards.',
    );
    await expect(page.locator('#retryWorkspaceButton')).toBeVisible();
  });

  test('shows a conflict when creating a duplicate job card from an appointment', async ({
    page,
  }) => {
    const appointment = {
      id: '501',
      appointmentReference: 'APT-2026-00001',
      customerName: 'Appointment Customer',
      contactNumber: '0500000000',
      appointmentDate: '2026-10-05',
      appointmentTime: '09:00',
      faultDescription: 'The appliance does not start.',
      status: 'Scheduled',
    };

    await page.route('**/api/**', async (route) => {
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
              name: 'Appointment Operator',
              email: 'appointments@jackys.com',
              role: 'staff',
              permissions: ['appointments.read', 'service_job_card.read', 'service_job_card.write'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [appointment] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ appointment, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: null }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card/prefill' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            content: {
              jobCardDate: '2026-10-05',
              customerName: appointment.customerName,
              customerContact: appointment.contactNumber,
              customerAddress: '',
              itemDescription: '',
              modelNo: '',
              brand: '',
              warrantyStatus: '',
              technicianName: '',
              complaint: appointment.faultDescription,
              serviceRendered: '',
              periodFrom: null,
              periodTo: null,
              serviceCharge: 0,
              amountChargeable: null,
              invoiceNo: '',
              deliveryDate: null,
              jobFinalStatus: 'WIP',
              schoolContactPerson: '',
              schoolContactNumber: '',
              customerNumber: '',
              legacyReference: '',
              parts: [],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/appointments/501/job-card' && request.method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'The appointment already has a service job card.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('appointments@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Appointments', exact: true }).click();
    await page.getByRole('button', { name: 'APT-2026-00001' }).click();
    await page.getByRole('button', { name: 'Create service job card' }).click();

    await expect(page.locator('#jobCardCreatePanel')).toBeVisible();
    await page.getByRole('button', { name: 'Create job card' }).click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'The appointment already has a service job card.',
    );
  });

  test('shows recovery after a job-card detail request returns not found', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
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
              name: 'Job Card Operator',
              email: 'jobcards@jackys.com',
              role: 'staff',
              permissions: ['service_job_card.read'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCards: [{ ...openJobCard }] }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'The service job card was not found.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('jobcards@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();

    await expect(page.locator('#workspaceRecoveryMessage')).toHaveText(
      'This service job card no longer exists. Return to the job-card list and try again.',
    );
    await expect(page.locator('#retryWorkspaceButton')).toBeVisible();
  });
});

test.describe('B2B Branch / School staff linking (modification.md #2)', () => {
  test('lets an authorized staff member search the master list and link a match', async ({
    page,
  }) => {
    let linkBody: unknown = null;
    let searchQueries: string[] = [];
    const complaint = {
      id: '202',
      complaintReference: 'JSC-20260929-0002',
      customerType: 'B2B',
      customerName: 'Acme School Group',
      contactNumber: null,
      description: 'AC unit not cooling.',
      status: 'New',
      cceNotes: '',
      b2bBranchSchool: 'american school of dubai',
      b2bBranchCustCode: null as string | null,
      submittedAt: '2026-09-29T08:00:00.000Z',
      updatedAt: '2026-09-29T08:00:00.000Z',
    };
    let linkedComplaint = complaint;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/auth/login') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'test-token',
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
              role: 'admin',
              permissions: ['*'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/auth/me') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
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
          body: JSON.stringify({ complaints: [linkedComplaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/202' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: linkedComplaint, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/b2b-branches' && request.method() === 'GET') {
        searchQueries.push(url.searchParams.get('query') || '');
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            branches: [
              { custCode: '100599', branchName: 'AMERICAN SCHOOL OF DUBAI', salesman: 'Rahul' },
            ],
          }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/202/b2b-branch' && request.method() === 'PATCH') {
        linkBody = request.postDataJSON();
        linkedComplaint = { ...complaint, b2bBranchCustCode: '100599' };
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: linkedComplaint }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('vysakh.raju@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'JSC-20260929-0002' }).click();

    await expect(page.locator('#b2bBranchAction')).toBeVisible();
    await expect(page.locator('#b2bBranchCurrent')).toHaveText(
      'american school of dubai — not yet matched',
    );
    await expect(page.locator('#unlinkB2bBranchButton')).toBeHidden();

    await page.locator('#b2bBranchSearchInput').fill('american');
    await expect(page.locator('#b2bBranchResults li')).toHaveCount(1);
    await expect(page.locator('#b2bBranchResults')).toContainText('AMERICAN SCHOOL OF DUBAI');
    await expect(page.locator('#b2bBranchResults')).toContainText('Cust_Code 100599');

    await page.getByRole('button', { name: /AMERICAN SCHOOL OF DUBAI/ }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Branch matched.');
    expect(linkBody).toEqual({ custCode: '100599' });
    expect(searchQueries.at(-1)).toBe('american');
    await expect(page.locator('#b2bBranchCurrent')).toHaveText(
      'american school of dubai — matched (Cust_Code 100599)',
    );
    await expect(page.locator('#unlinkB2bBranchButton')).toBeVisible();
  });

  test('lets staff clear an existing match', async ({ page }) => {
    let linkBody: unknown = null;
    const complaint = {
      id: '303',
      complaintReference: 'JSC-20260929-0003',
      customerType: 'B2B',
      customerName: 'Acme School Group',
      contactNumber: null,
      description: 'Fridge leaking.',
      status: 'New',
      cceNotes: '',
      b2bBranchSchool: 'american school of dubai',
      b2bBranchCustCode: '100599' as string | null,
      submittedAt: '2026-09-29T08:00:00.000Z',
      updatedAt: '2026-09-29T08:00:00.000Z',
    };
    let linkedComplaint = complaint;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/auth/login') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'test-token',
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
              role: 'admin',
              permissions: ['*'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/auth/me') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
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
          body: JSON.stringify({ complaints: [linkedComplaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/303' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: linkedComplaint, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/303/b2b-branch' && request.method() === 'PATCH') {
        linkBody = request.postDataJSON();
        linkedComplaint = { ...complaint, b2bBranchCustCode: null };
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: linkedComplaint }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('vysakh.raju@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'JSC-20260929-0003' }).click();

    await expect(page.locator('#b2bBranchCurrent')).toHaveText(
      'american school of dubai — matched (Cust_Code 100599)',
    );
    await page.getByRole('button', { name: 'Clear match' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Match cleared.');
    expect(linkBody).toEqual({ custCode: null });
    await expect(page.locator('#b2bBranchCurrent')).toHaveText(
      'american school of dubai — not yet matched',
    );
  });

  test('hides the match tool for a B2C complaint', async ({ page }) => {
    const complaint = {
      id: '404',
      complaintReference: 'JSC-20260929-0004',
      customerType: 'B2C',
      customerName: 'Jane Doe',
      contactNumber: '0500000000',
      description: 'Oven not heating.',
      status: 'New',
      cceNotes: '',
      submittedAt: '2026-09-29T08:00:00.000Z',
      updatedAt: '2026-09-29T08:00:00.000Z',
    };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/auth/login') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'test-token',
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
              role: 'admin',
              permissions: ['*'],
            },
          }),
        });
        return;
      }
      if (url.pathname === '/api/auth/me') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'Vysakh',
              email: 'vysakh.raju@jackys.com',
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
          body: JSON.stringify({ complaints: [complaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/404' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint, history: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('vysakh.raju@jackys.com');
    await page.locator('#loginPassword').fill('local-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#staff-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'JSC-20260929-0004' }).click();

    await expect(page.locator('#b2bBranchAction')).toBeHidden();
  });
});
