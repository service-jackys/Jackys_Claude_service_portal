import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Handler = (url: URL, method: string, body: unknown) => unknown | undefined;

async function mockApi(page: Page, permissions: string[], handler: Handler) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 'test-token' });
    if (url.pathname === '/api/auth/me') {
      return json({
        user: { name: 'Billing Tester', email: 'billing@jackys.com', role: 'staff', permissions },
      });
    }
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const result = handler(url, request.method(), body);
    if (result !== undefined) return json(result);
    return json({}, 200);
  });
}

async function signIn(page: Page) {
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('billing@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
}

const invoiceRow = {
  id: '801',
  jobCardReference: 'JBC-2026-00801',
  jobCardDate: '2026-10-01',
  customerName: 'Invoice Customer',
  customerType: 'B2C',
  billingJobType: 'CSIJO',
  warrantyStatus: 'In Warranty',
  finalWarrantyStatus: 'Out Warranty',
  paymentBy: 'Customer',
  billToChannel: null,
  salesChannel: null,
  amount: '150.00',
  invoiceNo: null,
  invoiceDate: null,
  paymentMode: null,
  paymentReference: null,
  paymentConfirmedAt: null,
  jobFinalStatus: 'Repair Completed',
  deliveryDate: null,
  paymentStatus: 'Awaiting invoice',
};

test.describe('warranty and billing', () => {
  test('New request sends the warranty status chosen by staff', async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    await mockApi(page, ['complaints.read', 'complaints.write'], (url, method, body) => {
      if (url.pathname === '/api/complaints' && method === 'POST') {
        posted = body as Record<string, unknown>;
        return { complaint: { id: '1', complaintReference: 'CMP-261008-001' } };
      }
      if (url.pathname === '/api/complaints') return { complaints: [], pagination: {} };
      return undefined;
    });
    await signIn(page);
    await page.locator('#newRequestNav').dispatchEvent('click');
    await page.locator('#newComplaintCustomerType').selectOption('B2C');
    await page.locator('#newComplaintCustomerName').fill('Warranty Customer');
    await page.locator('#newComplaintContactNumber').fill('0500000001');
    await page.locator('#newComplaintWarranty').selectOption('In Warranty');
    await page.locator('#newComplaintDescription').fill('Does not start');
    await page.locator('#submitNewComplaintButton').click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toMatchObject({ warrantyClassification: 'In Warranty' });
  });

  test('Invoices page lists jobs with an amount and records invoice and payment', async ({
    page,
  }) => {
    const perms = ['service_job_card.read', 'service_job_card.write'];
    let patched: Record<string, unknown> | null = null;
    await mockApi(page, perms, (url, method, body) => {
      if (url.pathname === '/api/invoices/summary') {
        return {
          summary: {
            byType: [{ billingJobType: 'CSIJO', jobs: 1, amount: 150 }],
            byPaymentStatus: [{ paymentStatus: 'Awaiting invoice', jobs: 1, amount: 150 }],
            outOfWarrantyPendingDelivery: [],
          },
        };
      }
      if (url.pathname === '/api/invoices') {
        return { invoices: [invoiceRow], pagination: { page: 1, pageSize: 100, total: 1 } };
      }
      if (url.pathname === '/api/job-cards/801' && method === 'PATCH') {
        patched = body as Record<string, unknown>;
        return { jobCard: { id: '801' } };
      }
      if (url.pathname === '/api/dashboard') return {};
      return undefined;
    });
    await signIn(page);
    await page.locator('#invoicesNav').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
    await expect(page.getByText('JBC-2026-00801')).toBeVisible();
    await expect(page.getByText('CSIJO Non-warranty').first()).toBeVisible();
    await expect(page.getByText('Awaiting invoice').first()).toBeVisible();

    await page.getByRole('button', { name: 'Record' }).click();
    await page.locator('[data-rec="invoiceNo"]').fill('INV-9001');
    await page.locator('[data-rec="paymentMode"]').selectOption('Cash');
    await page.locator('[data-rec="paymentConfirmed"]').check();
    await page.locator('[data-rec-save]').click();
    await expect.poll(() => patched).not.toBeNull();
    expect(patched).toMatchObject({
      invoiceNo: 'INV-9001',
      paymentMode: 'Cash',
      paymentConfirmed: true,
    });
  });

  test('Billing rules tab shows the rules and only the super admin can add one', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read'], (url) => {
      if (url.pathname === '/api/invoices/summary') {
        return { summary: { byType: [], byPaymentStatus: [], outOfWarrantyPendingDelivery: [] } };
      }
      if (url.pathname === '/api/invoices') return { invoices: [], pagination: {} };
      if (url.pathname === '/api/billing-rules') {
        return {
          billingRules: [
            {
              id: '1',
              salesman: 'Raneesh Jose',
              branchKeyword: 'GEMS',
              billToChannel: 'JDI',
              active: true,
              notes: null,
            },
          ],
        };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#invoicesNav').dispatchEvent('click');
    await page.getByRole('tab', { name: 'Billing rules' }).click();
    await expect(page.getByText('Raneesh Jose')).toBeVisible();
    await expect(page.getByText('GEMS').first()).toBeVisible();
    await expect(page.getByText('Only the super admin can change billing rules.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  });

  test('Billing page shows the accounts ledger, statement and allocation, and downloads Excel', async ({
    page,
  }) => {
    let exportUrl = '';
    const ledger = {
      rows: [
        {
          id: '901',
          jobCardReference: 'JBC-2026-00901',
          jobCardDate: '2026-10-02',
          deliveryDate: null,
          billingJobType: 'CSIJW',
          registeredWarranty: 'In Warranty',
          finalWarranty: 'In Warranty',
          warrantyChangeReason: null,
          payer: 'Sales channel',
          billTo: 'JDI',
          customerName: 'GEMS School',
          customerType: 'B2B',
          b2bBranchSchool: 'GEMS Branch',
          salesman: 'Raneesh Jose',
          salesChannel: 'Dubai B2B',
          region: 'Dubai',
          salesOrderNumber: 'SO-1',
          itemCode: 'HIS-RF-001',
          brand: 'Hisense',
          mainGroup: 'Home Appliances',
          groupName: 'Refrigerators',
          subGroup: 'Side by side',
          modelNo: 'RS-1',
          serialNo: 'SN123',
          technicianName: 'Tech',
          serviceCharge: 120,
          partsCost: 380,
          grandTotal: 500,
          adjustment: 0,
          billedAmount: 500,
          invoiceNo: null,
          invoiceDate: null,
          paymentMode: null,
          paymentReference: null,
          paymentConfirmedAt: null,
          stage: 'Not invoiced',
          jobFinalStatus: 'Repair Completed',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totals: {
        jobs: 1,
        serviceCharge: 120,
        partsCost: 380,
        adjustment: 0,
        billedAmount: 500,
        invoicedAmount: 0,
        notInvoicedAmount: 500,
      },
      statement: [
        {
          billTo: 'JDI',
          jobs: 1,
          warrantyAmount: 500,
          nonWarrantyAmount: 0,
          billedAmount: 500,
          invoicedAmount: 0,
          notInvoicedAmount: 500,
          paidAmount: 0,
        },
      ],
      allocation: [
        {
          brand: 'Hisense',
          mainGroup: 'Home Appliances',
          groupName: 'Refrigerators',
          jobs: 1,
          serviceCharge: 120,
          partsCost: 380,
          billedAmount: 500,
        },
      ],
      billToOptions: ['JDI'],
      stages: ['Not invoiced', 'Paid'],
    };
    await mockApi(page, ['service_job_card.read'], (url) => {
      if (url.pathname === '/api/billing/ledger') return ledger;
      return undefined;
    });
    await page.route('**/api/billing/export**', async (route) => {
      exportUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: 'xlsx',
      });
    });
    await signIn(page);
    await page.locator('#billingNav').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.getByText('JBC-2026-00901')).toBeVisible();
    await expect(page.locator('.acc-table .status', { hasText: 'Not invoiced' })).toBeVisible();
    await expect(page.getByText('Total, all 1 matching jobs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Bill-to statement' }).click();
    await expect(page.getByRole('cell', { name: 'JDI', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Cost allocation' }).click();
    await expect(page.getByText('Subtotal Hisense')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Excel' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^Billing_.*\.xlsx$/);
    expect(exportUrl).toContain('/api/billing/export');
  });
});
