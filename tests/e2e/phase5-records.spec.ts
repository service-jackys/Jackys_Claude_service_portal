import { expect, test } from '@playwright/test';

async function routeCommonAuth(
  route: import('@playwright/test').Route,
  url: URL,
  permissions: string[],
  name: string,
  email: string,
): Promise<boolean> {
  if (url.pathname === '/api/auth/login') {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ token: 'test-token' }),
    });
    return true;
  }
  if (url.pathname === '/api/auth/me') {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: { name, email, role: 'staff', permissions },
      }),
    });
    return true;
  }
  return false;
}

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

test.describe('quotations workspace', () => {
  test('hides the quotations nav entry without quotation.read permission', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(route, url, ['dashboard.read'], 'Dashboard Only', 'dash@jackys.com')
      )
        return;
      await route.continue();
    });

    await signIn(page, 'dash@jackys.com');
    await expect(page.locator('#quotationsNav')).toBeHidden();
  });

  test('lists quotations, creates one, and opens the print view', async ({ page }) => {
    const quotation = {
      id: '801',
      quotationReference: 'QTN-2026-00001',
      customerName: 'Quotation Customer',
      contactNumber: '0500000000',
      projectName: 'AC servicing',
      siteLocation: 'Dubai Marina',
      products: [],
      parts: [],
      grandTotal: 0,
      updatedAt: '2026-09-26T08:00:00.000Z',
    };
    let createBody: unknown = null;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['quotation.read', 'quotation.write'],
          'Sales Operator',
          'sales@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/quotations' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ quotations: [quotation] }),
        });
        return;
      }
      if (url.pathname === '/api/quotations' && request.method() === 'POST') {
        createBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ quotation }),
        });
        return;
      }
      if (url.pathname === '/api/quotations/801' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ quotation }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'sales@jackys.com');
    await page.getByRole('button', { name: 'Quotations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quotations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'QTN-2026-00001' })).toBeVisible();

    await page.getByRole('button', { name: 'New quotation' }).click();
    await expect(page.locator('#quotationCreatePanel')).toBeVisible();
    await page.locator('#qtcCustomerName').fill('Quotation Customer');
    await page
      .locator('#quotationCreatePanel')
      .getByRole('button', { name: 'Save quotation' })
      .click();

    await expect(page.locator('#workspaceMessage')).toHaveText('Quotation QTN-2026-00001 created.');
    await expect(page.locator('#quotationDetailHeading')).toHaveText('QTN-2026-00001');
    expect((createBody as { customerName?: string }).customerName).toBe('Quotation Customer');

    await page.context().addInitScript(() => {
      window.print = () => {};
    });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    await expect.poll(() => popup.content()).toContain('QTN-2026-00001');
  });
});

test.describe('inspections workspace', () => {
  test('hides the inspections nav entry without inspection.read permission', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(route, url, ['dashboard.read'], 'Dashboard Only', 'dash2@jackys.com')
      )
        return;
      await route.continue();
    });

    await signIn(page, 'dash2@jackys.com');
    await expect(page.locator('#inspectionsNav')).toBeHidden();
  });

  test('lists inspections, creates one, and opens the print view', async ({ page }) => {
    const inspection = {
      id: '901',
      inspectionReference: 'INS-2026-00001',
      customerName: 'Inspection Customer',
      contactNumber: '0500000000',
      projectName: 'Chiller inspection',
      siteLocation: 'JLT',
      products: [],
      faultyParts: [],
      updatedAt: '2026-09-26T08:00:00.000Z',
    };
    let createBody: unknown = null;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['inspection.read', 'inspection.write'],
          'Inspector',
          'inspector@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/inspections' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ inspections: [inspection] }),
        });
        return;
      }
      if (url.pathname === '/api/inspections' && request.method() === 'POST') {
        createBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ inspection }),
        });
        return;
      }
      if (url.pathname === '/api/inspections/901' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ inspection }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'inspector@jackys.com');
    await page.getByRole('button', { name: 'Inspections', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inspections' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'INS-2026-00001' })).toBeVisible();

    await page.getByRole('button', { name: 'New inspection' }).click();
    await expect(page.locator('#inspectionCreatePanel')).toBeVisible();
    await page.locator('#iqcCustomerName').fill('Inspection Customer');
    await page
      .locator('#inspectionCreatePanel')
      .getByRole('button', { name: 'Save inspection' })
      .click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Inspection INS-2026-00001 created.',
    );
    await expect(page.locator('#inspectionDetailHeading')).toHaveText('INS-2026-00001');
    expect((createBody as { customerName?: string }).customerName).toBe('Inspection Customer');

    await page.context().addInitScript(() => {
      window.print = () => {};
    });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    await expect.poll(() => popup.content()).toContain('INS-2026-00001');
  });
});

test.describe('warranty approvals workspace', () => {
  test('hides the warranty approvals nav entry without warranty_approval.read permission', async ({
    page,
  }) => {
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(route, url, ['dashboard.read'], 'Dashboard Only', 'dash3@jackys.com')
      )
        return;
      await route.continue();
    });

    await signIn(page, 'dash3@jackys.com');
    await expect(page.locator('#warrantyApprovalsNav')).toBeHidden();
  });

  test('rejects a request naming both a job card and an inspection without a network call', async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['warranty_approval.read', 'warranty_approval.write'],
          'Warranty Operator',
          'warranty@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/warranty-approvals' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ approvals: [] }),
        });
        return;
      }
      if (url.pathname === '/api/warranty-approvals' && request.method() === 'POST') {
        requestCount += 1;
        await route.continue();
        return;
      }
      await route.continue();
    });

    await signIn(page, 'warranty@jackys.com');
    await page.getByRole('button', { name: 'Warranty approvals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Warranty approvals' })).toBeVisible();

    await page.getByRole('button', { name: 'New approval request' }).click();
    await page.locator('#waJobCardId').fill('701');
    await page.locator('#waInspectionId').fill('901');
    await page
      .locator('#warrantyApprovalCreatePanel')
      .getByRole('button', { name: 'Create approval request' })
      .click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Enter exactly one of Job card ID or Inspection ID.',
    );
    expect(requestCount).toBe(0);
  });

  test('creates a warranty approval request and shows the customer approval link', async ({
    page,
  }) => {
    const approval = {
      id: '1001',
      approvalReference: 'WA-2026-00001',
      jobCardId: '701',
      jobCardReference: 'JBC-2026-00001',
      customerName: 'Warranty Customer',
      contactNumber: '0500000000',
      itemDescription: 'Split AC unit',
      warrantyStatus: 'Out of Warranty',
      estimatedCost: 350,
      notes: null,
      status: 'Pending',
      accessToken: 'test-access-token',
      decidedAt: null,
      decidedByName: null,
      decisionNotes: null,
      createdAt: '2026-09-26T08:00:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
    };
    let createBody: unknown = null;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['warranty_approval.read', 'warranty_approval.write'],
          'Warranty Operator',
          'warranty2@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/warranty-approvals' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ approvals: [approval] }),
        });
        return;
      }
      if (url.pathname === '/api/warranty-approvals' && request.method() === 'POST') {
        createBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ approval }),
        });
        return;
      }
      if (url.pathname === '/api/warranty-approvals/1001' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ approval }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'warranty2@jackys.com');
    await page.getByRole('button', { name: 'Warranty approvals', exact: true }).click();
    await page.getByRole('button', { name: 'New approval request' }).click();
    await page.locator('#waJobCardId').fill('701');
    await page.locator('#waCustomerName').fill('Warranty Customer');
    await page.locator('#waItemDescription').fill('Split AC unit');
    await page
      .locator('#warrantyApprovalCreatePanel')
      .getByRole('button', { name: 'Create approval request' })
      .click();

    await expect(page.locator('#workspaceMessage')).toHaveText(
      'Warranty approval request WA-2026-00001 created.',
    );
    expect((createBody as { jobCardId?: string }).jobCardId).toBe('701');
    await expect(page.locator('#warrantyApprovalLinkInput')).toHaveValue(
      /\/portal\/approve\.html\?token=test-access-token$/,
    );
  });
});

test.describe('operational dashboard', () => {
  test('renders summary tiles from the dashboard endpoint', async ({ page }) => {
    const summary = {
      complaints: { total: 12, byStatus: { New: 4, 'Under Review': 8 } },
      appointments: { total: 6, today: 2, byStatus: { Scheduled: 6 } },
      jobCards: { total: 3, byStatus: { Open: 2, Completed: 1 } },
      quotations: { total: 5, thisMonth: 2 },
      inspections: { total: 4, thisMonth: 1 },
      warrantyApprovals: { total: 2, byStatus: { Pending: 1, Approved: 1 } },
    };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['dashboard.read'],
          'Dashboard Viewer',
          'dashboard@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/dashboard/summary' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ summary }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'dashboard@jackys.com');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect(page.locator('#dashComplaintTiles')).toContainText('12');
    await expect(page.locator('#dashComplaintTiles')).toContainText('New');
    await expect(page.locator('#dashAppointmentTiles')).toContainText('Today');
    await expect(page.locator('#dashJobCardTiles')).toContainText('Open');
    await expect(page.locator('#dashQuotationInspectionTiles')).toContainText('Quotations (total)');
    await expect(page.locator('#dashWarrantyApprovalTiles')).toContainText('Pending');
  });

  // modification.md #6: dashboard tiles are clickable and drill down into
  // the filtered underlying list.
  test('clicking a status tile jumps to the filtered list (modification.md #6)', async ({
    page,
  }) => {
    const summary = {
      complaints: { total: 12, byStatus: { New: 4, 'Under Review': 8 } },
      appointments: { total: 6, today: 2, byStatus: { Scheduled: 6 } },
      jobCards: { total: 3, byStatus: { Open: 2, Completed: 1 } },
      quotations: { total: 5, thisMonth: 2 },
      inspections: { total: 4, thisMonth: 1 },
      warrantyApprovals: { total: 2, byStatus: { Pending: 1, Approved: 1 } },
    };
    const complaintListUrls: string[] = [];

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['dashboard.read', 'complaints.read'],
          'Dashboard Viewer',
          'dashboard@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/dashboard/summary' && request.method() === 'GET') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ summary }) });
        return;
      }
      if (url.pathname === '/api/complaints' && request.method() === 'GET') {
        complaintListUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaints: [] }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'dashboard@jackys.com');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();

    await page.locator('#dashComplaintTiles').getByText('New', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Complaint inbox' })).toBeVisible();
    await expect(page.locator('#complaintStatusFilter')).toHaveValue('New');
    expect(complaintListUrls.at(-1)).toContain('status=New');
  });
});

test.describe('service job-card attachments', () => {
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

  test('uploads, lists, downloads, and removes a job-card attachment', async ({ page }) => {
    let attachments: Array<{
      id: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      downloadUrl: string;
    }> = [];
    let deletedId: string | null = null;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['service_job_card.read', 'service_job_card.write'],
          'Job Card Operator',
          'jobcards2@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jobCards: [openJobCard],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: openJobCard, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701/attachments' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ attachments }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701/attachments' && request.method() === 'POST') {
        attachments = [
          {
            id: 'att-1',
            fileName: 'inspection-photo.pdf',
            contentType: 'application/pdf',
            sizeBytes: 20480,
            downloadUrl: '/api/attachments/att-1/download?sig=abc',
          },
        ];
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ attachment: attachments[0] }),
        });
        return;
      }
      if (url.pathname === '/api/attachments/att-1' && request.method() === 'DELETE') {
        deletedId = 'att-1';
        attachments = [];
        await route.fulfill({ status: 204 });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'jobcards2@jackys.com');
    await expect(page.getByRole('heading', { name: 'Service job cards' })).toBeVisible();
    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();
    await expect(page.locator('#jobCardDetail')).toBeVisible();
    await expect(page.locator('#jobCardAttachmentsList')).toContainText('No attachments yet.');

    await page.setInputFiles('#jobCardAttachmentFile', {
      name: 'inspection-photo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test attachment'),
    });
    await page.getByRole('button', { name: 'Upload attachment' }).click();

    await expect(page.locator('#workspaceMessage')).toHaveText('Attachment uploaded.');
    await expect(page.locator('#jobCardAttachmentsList')).toContainText('inspection-photo.pdf');
    await expect(page.getByRole('link', { name: 'inspection-photo.pdf' })).toHaveAttribute(
      'href',
      '/api/attachments/att-1/download?sig=abc',
    );

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#workspaceMessage')).toHaveText('Attachment deleted.');
    await expect(page.locator('#jobCardAttachmentsList')).toContainText('No attachments yet.');
    expect(deletedId).toBe('att-1');
  });

  test('prints a service job card', async ({ page }) => {
    const completedJobCard = { ...openJobCard, status: 'Completed' };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['service_job_card.read'],
          'Job Card Viewer',
          'jobcards3@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/job-cards' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jobCards: [completedJobCard],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jobCard: completedJobCard, history: [] }),
        });
        return;
      }
      if (url.pathname === '/api/job-cards/701/attachments' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ attachments: [] }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'jobcards3@jackys.com');
    await page.getByRole('button', { name: 'JBC-2026-00001' }).click();
    await expect(page.locator('#jobCardDetail')).toBeVisible();

    await page.context().addInitScript(() => {
      window.print = () => {};
    });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('load').catch(() => {});
    await expect.poll(() => popup.content()).toContain('JBC-2026-00001');
  });
});

test.describe('workflow stepper', () => {
  const complaint = {
    id: '101',
    complaintReference: 'JSC-20260926-0001',
    customerType: 'individual',
    customerName: 'Local Test Customer',
    contactNumber: '0500000000',
    description: 'Test complaint',
    status: 'Closed',
    cceNotes: '',
    submittedAt: '2026-09-26T08:00:00.000Z',
    updatedAt: '2026-09-26T08:00:00.000Z',
  };

  test('shows the current stage for a closed complaint and marks earlier stages done', async ({
    page,
  }) => {
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['complaints.read'],
          'Complaint Viewer',
          'stepper@jackys.com',
        )
      )
        return;
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
      await route.continue();
    });

    await signIn(page, 'stepper@jackys.com');
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    const stepper = page.locator('#workflowStepper');
    await expect(stepper.locator('.stepper-item.is-current .stepper-label')).toHaveText(
      'Completion',
    );
    const doneLabels = stepper.locator('.stepper-item.is-done .stepper-label');
    await expect(doneLabels).toHaveCount(3);
    await expect(doneLabels).toContainText(['Complaint', 'Scheduling', 'Job Card']);
  });

  test('shows a single cancelled marker for a cancelled complaint', async ({ page }) => {
    const cancelledComplaint = { ...complaint, status: 'Cancelled' };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        await routeCommonAuth(
          route,
          url,
          ['complaints.read'],
          'Complaint Viewer',
          'stepper2@jackys.com',
        )
      )
        return;
      if (url.pathname === '/api/complaints' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaints: [cancelledComplaint] }),
        });
        return;
      }
      if (url.pathname === '/api/complaints/101' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ complaint: cancelledComplaint, history: [] }),
        });
        return;
      }
      await route.continue();
    });

    await signIn(page, 'stepper2@jackys.com');
    await page.getByRole('button', { name: 'JSC-20260926-0001' }).click();

    const stepper = page.locator('#workflowStepper');
    await expect(stepper.locator('.stepper-item.is-cancelled .stepper-label')).toHaveText(
      'Cancelled',
    );
    await expect(stepper.locator('.stepper-item')).toHaveCount(1);
  });
});

test.describe('customer warranty-approval decision page', () => {
  const approval = {
    id: '1001',
    approvalReference: 'WA-2026-00001',
    itemDescription: 'Split AC unit',
    warrantyStatus: 'Out of Warranty',
    estimatedCost: 350,
    customerName: 'Warranty Customer',
    notes: null,
    status: 'Pending',
  };

  test('lets a customer approve a pending request without staff sign-in', async ({ page }) => {
    let decisionBody: unknown = null;

    await page.route('**/api/public/warranty-approvals/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.pathname === '/api/public/warranty-approvals/test-token' &&
        request.method() === 'GET'
      ) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ approval }),
        });
        return;
      }
      if (
        url.pathname === '/api/public/warranty-approvals/test-token/decision' &&
        request.method() === 'POST'
      ) {
        decisionBody = request.postDataJSON();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            approval: {
              ...approval,
              status: 'Approved',
              decidedAt: '2026-09-28T08:00:00.000Z',
              decidedByName: (decisionBody as { decidedByName: string }).decidedByName,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/approve.html?token=test-token');
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#approvalReference')).toHaveText('WA-2026-00001');
    await expect(page.locator('#detailsGrid')).toContainText('Split AC unit');

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.locator('#decisionError')).toBeVisible();

    await page.locator('#decidedByName').fill('Jane Customer');
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect(page.locator('#statusBanner')).toContainText('Approved by Jane Customer');
    expect(decisionBody).toEqual({ decision: 'Approved', decidedByName: 'Jane Customer' });
  });

  test('shows an error for a missing or invalid token', async ({ page }) => {
    await page.route('**/api/public/warranty-approvals/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.pathname === '/api/public/warranty-approvals/bad-token' &&
        request.method() === 'GET'
      ) {
        await route.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'This approval link is no longer valid.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/portal/approve.html?token=bad-token');
    await expect(page.locator('#errorState')).toHaveText('This approval link is no longer valid.');
    await expect(page.locator('#content')).toBeHidden();
  });
});
