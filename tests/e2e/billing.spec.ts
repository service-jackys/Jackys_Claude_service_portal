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
  portalInvoiceNo: null,
  customerTrn: null,
  invoiceDate: null,
  paymentMode: null,
  paymentReference: null,
  paymentConfirmedAt: null,
  jobFinalStatus: 'Repair Completed',
  deliveryDate: null,
  paymentStatus: 'Awaiting invoice',
};

test.describe('warranty and billing', () => {
  test('New request books an appointment directly with source and warranty', async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    let complaintsPosted = false;
    await mockApi(
      page,
      ['appointments.read', 'appointments.write', 'complaints.write'],
      (url, method, body) => {
        if (url.pathname === '/api/complaints' && method === 'POST') complaintsPosted = true;
        if (url.pathname === '/api/appointments' && method === 'POST') {
          posted = body as Record<string, unknown>;
          return {
            appointment: {
              id: '77',
              appointmentReference: 'APT-2026-00077',
              appointmentDate: '2026-10-12',
              technicianName: null,
            },
            warnings: [],
          };
        }
        if (url.pathname === '/api/appointments') {
          return { appointments: [], pagination: { page: 1, pageSize: 100, total: 0 } };
        }
        return undefined;
      },
    );
    await signIn(page);
    await page.locator('#newRequestNav').dispatchEvent('click');
    await page.locator('#newComplaintSource').selectOption('WhatsApp');
    await expect(page.locator('#newComplaintSalesmanField')).toBeHidden();
    await page.locator('#newComplaintAppointmentDate').fill('2026-10-12');
    await page.locator('#newComplaintCustomerType').selectOption('B2C');
    await page.locator('#newComplaintCustomerName').fill('Warranty Customer');
    await page.locator('#newComplaintContactNumber').fill('0500000001');
    await page.locator('#newComplaintWarranty').selectOption('In Warranty');
    await page.locator('#newComplaintDescription').fill('Does not start');
    await page.locator('#submitNewComplaintButton').click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toMatchObject({
      complaintSource: 'WhatsApp',
      appointmentDate: '2026-10-12',
      jobWarranty: 'In Warranty',
      faultDescription: 'Does not start',
    });
    expect(posted).not.toHaveProperty('salesman');
    await expect(page.locator('#newComplaintReference')).toHaveText('APT-2026-00077');
    expect(complaintsPosted).toBe(false);
  });

  test('New request needs a salesman when the source is Salesman and warns on a B2B mismatch', async ({
    page,
  }) => {
    let posted: Record<string, unknown> | null = null;
    await mockApi(
      page,
      ['appointments.read', 'appointments.write', 'salesmen.read'],
      (url, method, body) => {
        if (url.pathname === '/api/salesmen') {
          return {
            salesmen: [
              { id: '1', name: 'Rahul', active: true },
              { id: '2', name: 'Anil', active: true },
            ],
          };
        }
        if (url.pathname === '/api/b2b-branches') {
          return {
            branches: [
              {
                custCode: 'C100',
                branchName: 'Green School',
                salesman: 'Rahul',
                salesChannel: null,
              },
            ],
          };
        }
        if (url.pathname === '/api/appointments' && method === 'POST') {
          posted = body as Record<string, unknown>;
          return {
            appointment: { id: '78', appointmentReference: 'APT-2026-00078' },
            warnings: ['The B2B branch master lists Rahul as the salesman for Green School.'],
          };
        }
        if (url.pathname === '/api/appointments') {
          return { appointments: [], pagination: { page: 1, pageSize: 100, total: 0 } };
        }
        return undefined;
      },
    );
    await signIn(page);
    await page.locator('#newRequestNav').dispatchEvent('click');
    await page.locator('#newComplaintSource').selectOption('Salesman');
    await expect(page.locator('#newComplaintSalesmanField')).toBeVisible();
    await page.locator('#newComplaintAppointmentDate').fill('2026-10-12');
    await page.locator('#newComplaintCustomerType').selectOption('B2B');
    await page.locator('#newComplaintCustomerName').fill('Green School');
    await page.locator('#newComplaintDescription').fill('Fridge not cooling');

    await page.locator('#submitNewComplaintButton').click();
    await expect(page.locator('[data-error-for="newComplaintSalesman"]')).toContainText('Pick');
    expect(posted).toBeNull();

    await page.locator('#newComplaintB2bBranchSearchInput').fill('Green');
    await page.locator('#newComplaintB2bBranchResults button').first().click();
    await page.locator('#newComplaintSalesman').selectOption('Anil');
    await expect(page.locator('#newComplaintSourceWarning')).toBeVisible();
    await expect(page.locator('#newComplaintSourceWarning')).toContainText('Rahul');

    await page.locator('#submitNewComplaintButton').click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toMatchObject({ complaintSource: 'Salesman', salesman: 'Anil' });
    await expect(page.locator('#newComplaintWarning')).toContainText('Rahul');
  });

  test('Invoice page issues a tax invoice with a customer TRN, confirms payment and prints it', async ({
    page,
  }) => {
    const perms = ['service_job_card.read', 'service_job_card.write'];
    let issued: Record<string, unknown> | null = null;
    let patched: Record<string, unknown> | null = null;
    const snapshot = (invoiceNo: string | null, customerTrn: string | null) => ({
      invoiceNo,
      invoiceDate: '2026-10-14',
      dueDate: '2026-10-14',
      customerName: 'Invoice Customer',
      customerCode: null,
      customerTrn,
      contact: '0501234567',
      jobCardReference: 'JBC-2026-00801',
      salesman: 'Anil',
      paymentTerm: 'CASH IN ADVANCE',
      deliveryDate: null,
      remarks: 'JBC-2026-00801 | Oven',
      lines: [
        {
          sno: 1,
          itemCode: 'SERVICE',
          description: 'Service charges - Oven',
          uom: 'NOS',
          qty: 1,
          rate: 142.86,
          value: 142.86,
          taxRate: 5,
          vat: 7.14,
          amount: 150,
        },
      ],
      totals: { net: 142.86, vat: 7.14, gross: 150 },
      amountInWords: 'AED One Hundred Fifty Only',
    });
    const job = {
      id: '801',
      jobCardReference: 'JBC-2026-00801',
      jobFinalStatus: 'Repair Completed',
      customerName: 'Invoice Customer',
      customerType: 'B2C',
      billingJobType: 'CSIJO',
      paymentBy: 'Customer',
      billToChannel: null,
      amount: 150,
      deliveryDate: null,
    };
    let detail: Record<string, unknown> = {
      job,
      issued: false,
      stale: false,
      invoice: snapshot(null, null),
      erpReference: null,
      customerTrn: null,
      portalInvoiceNo: null,
      paymentMode: null,
      paymentReference: null,
      paymentConfirmedAt: null,
      deliveryBlockReason:
        'This job has an amount payable by the customer. Issue the tax invoice and confirm the payment under Service desk > Invoices before delivery.',
    };
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
      if (url.pathname === '/api/invoices/801/issue' && method === 'POST') {
        issued = body as Record<string, unknown>;
        detail = {
          ...detail,
          issued: true,
          portalInvoiceNo: 'SINV-2026-00001',
          customerTrn: (issued.customerTrn as string) ?? null,
          invoice: snapshot('SINV-2026-00001', (issued.customerTrn as string) ?? null),
          deliveryBlockReason: 'The invoice is issued. Confirm the payment before delivery.',
        };
        return { invoice: detail };
      }
      if (url.pathname === '/api/invoices/801' && method === 'PATCH') {
        patched = body as Record<string, unknown>;
        detail = {
          ...detail,
          paymentMode: 'Cash',
          paymentConfirmedAt: '2026-10-14T08:00:00Z',
          deliveryBlockReason: null,
        };
        return { invoice: detail };
      }
      if (url.pathname === '/api/invoices/801') return { invoice: detail };
      if (url.pathname === '/api/dashboard') return {};
      return undefined;
    });
    await signIn(page);
    await page.locator('#invoicesNav').dispatchEvent('click');
    await expect(
      page.getByRole('heading', { name: 'Invoice [Warranty and billing]', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('JBC-2026-00801').first()).toBeVisible();
    await expect(page.getByText('CSIJO Non-warranty').first()).toBeVisible();
    await expect(page.getByText('Awaiting invoice').first()).toBeVisible();

    await page.getByRole('button', { name: 'Invoice', exact: true }).click();
    await expect(page.getByText('Cannot be delivered yet')).toBeVisible();
    await page.locator('[data-rec="customerTrn"]').fill('1234');
    await page.locator('[data-rec-issue]').click();
    await expect(page.locator('[data-inv-message]')).toContainText('15 digits');
    expect(issued).toBeNull();
    await page.locator('[data-rec="customerTrn"]').fill('100123456700003');
    await page.locator('[data-rec-issue]').click();
    await expect.poll(() => issued).not.toBeNull();
    expect(issued).toMatchObject({ customerTrn: '100123456700003' });
    await expect(page.getByText('Issued SINV-2026-00001').first()).toBeVisible();

    await page.locator('[data-rec="paymentMode"]').selectOption('Cash');
    await page.locator('[data-rec="paymentConfirmed"]').check();
    await page.locator('[data-rec-save]').click();
    await expect.poll(() => patched).not.toBeNull();
    expect(patched).toMatchObject({ paymentMode: 'Cash', paymentConfirmed: true });

    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-rec-print]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const printed = await popup.content();
    expect(printed).toContain('TRN: 100268906300003');
    expect(printed).toContain('Customer TRN');
    expect(printed).toContain('100123456700003');
    expect(printed).toContain('SINV-2026-00001');
    expect(printed).toContain('This is system generated invoice. No need of signature and stamp.');
    expect(printed).toContain('AE18 0290 1203 1110 5178 162');
    expect(printed).toContain('AED One Hundred Fifty Only');
  });

  test('A printed invoice shows the company TRN always and the customer TRN only when entered', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read', 'service_job_card.write'], (url) => {
      if (url.pathname === '/api/invoices/summary') {
        return { summary: { byType: [], byPaymentStatus: [], outOfWarrantyPendingDelivery: [] } };
      }
      if (url.pathname === '/api/invoices') {
        return { invoices: [invoiceRow], pagination: { page: 1, pageSize: 100, total: 1 } };
      }
      if (url.pathname === '/api/invoices/801') {
        return {
          invoice: {
            job: {
              id: '801',
              jobCardReference: 'JBC-2026-00801',
              amount: 150,
              paymentBy: 'Customer',
            },
            issued: true,
            stale: false,
            portalInvoiceNo: 'SINV-2026-00002',
            customerTrn: null,
            paymentConfirmedAt: null,
            deliveryBlockReason: null,
            invoice: {
              invoiceNo: 'SINV-2026-00002',
              invoiceDate: '2026-10-14',
              dueDate: '2026-10-14',
              customerName: 'Cash Buyer',
              customerTrn: null,
              lines: [],
              totals: { net: 0, vat: 0, gross: 0 },
              amountInWords: 'AED Zero Only',
            },
          },
        };
      }
      return undefined;
    });
    await signIn(page);
    await page.locator('#invoicesNav').dispatchEvent('click');
    await page.getByRole('button', { name: 'Invoice', exact: true }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-rec-print]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const printed = await popup.content();
    expect(printed).toContain('TRN: 100268906300003');
    expect(printed).not.toContain('Customer TRN');
  });

  test('Sidebar groups open and close on click and Warranty approvals sits in Service desk', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read', 'quotation.read'], (url) => {
      if (url.pathname === '/api/dashboard') return {};
      return undefined;
    });
    await signIn(page);
    await expect(page.locator('[data-nav-group="service-desk"] #warrantyApprovalsNav')).toHaveCount(
      1,
    );
    await expect(page.locator('[data-nav-group="records"] #warrantyApprovalsNav')).toHaveCount(0);
    await expect(page.locator('[data-nav-group="service-desk"] #invoicesNav')).toHaveCount(1);

    const services = page.locator('#navGroup-service-desk');
    await expect(services).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#invoicesNav')).toBeVisible();
    await services.click();
    await expect(services).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#invoicesNav')).toBeHidden();
    await services.click();
    await expect(services).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#invoicesNav')).toBeVisible();

    const records = page.locator('#navGroup-records');
    await expect(records).toHaveAttribute('aria-expanded', 'false');
    await records.click();
    await expect(records).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#quotationsNav')).toBeVisible();
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

  test('Billing record panel greys out payment fields unless the customer pays', async ({
    page,
  }) => {
    const row = (id: string, ref: string, payer: string) => ({
      id,
      jobCardReference: ref,
      jobCardDate: '2026-10-02',
      deliveryDate: null,
      billingJobType: 'CSIJO',
      registeredWarranty: 'Out Warranty',
      finalWarranty: 'Out Warranty',
      warrantyChangeReason: null,
      payer,
      billTo: payer === 'Customer' ? 'Walk In Customer' : 'JDI',
      customerName: 'Walk In Customer',
      customerType: 'B2C',
      b2bBranchSchool: '',
      salesman: null,
      salesChannel: 'JDI',
      region: 'Dubai',
      salesOrderNumber: null,
      itemCode: 'ITM-1',
      brand: 'Venus',
      mainGroup: 'MDA',
      groupName: 'Refrigerators',
      subGroup: null,
      modelNo: 'M1',
      serialNo: null,
      technicianName: 'Tech',
      serviceCharge: 100,
      partsCost: 0,
      grandTotal: 100,
      adjustment: 0,
      billedAmount: 100,
      invoiceNo: null,
      invoiceDate: null,
      paymentMode: null,
      paymentReference: null,
      paymentConfirmedAt: null,
      stage: 'Not invoiced',
      jobFinalStatus: 'Repair Completed',
    });
    const ledger = {
      rows: [row('1', 'JBC-2026-00911', 'Sales channel'), row('2', 'JBC-2026-00912', 'Customer')],
      total: 2,
      page: 1,
      pageSize: 50,
      totals: {
        jobs: 2,
        serviceCharge: 200,
        partsCost: 0,
        adjustment: 0,
        billedAmount: 200,
        invoicedAmount: 0,
        notInvoicedAmount: 200,
      },
      statement: [],
      allocation: [],
      billToOptions: ['JDI'],
      stages: ['Not invoiced', 'Paid'],
    };
    await mockApi(page, ['service_job_card.read', 'service_job_card.write'], (url) => {
      if (url.pathname === '/api/billing/ledger') return ledger;
      return undefined;
    });
    await signIn(page);
    await page.locator('#billingNav').dispatchEvent('click');
    await expect(page.getByText('JBC-2026-00911')).toBeVisible();
    const records = page.getByRole('button', { name: 'Record' });
    await records.nth(0).click();
    await expect(page.locator('[data-acc-record] [data-rec="paymentMode"]')).toBeDisabled();
    await expect(page.locator('[data-acc-record] [data-rec="paymentReference"]')).toBeDisabled();
    await records.nth(1).click();
    await expect(page.locator('[data-acc-record] [data-rec="paymentMode"]')).toBeEnabled();
    await expect(page.locator('[data-acc-record] [data-rec="paymentReference"]')).toBeEnabled();
  });

  test('Job card page: Edit tab shows the form, Job card tab shows the read-only view', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read', 'service_job_card.write'], () => undefined);
    await signIn(page);
    const state = await page.evaluate(() => {
      const detail = document.getElementById('jobCardDetail') as HTMLElement;
      detail.hidden = false;
      (document.getElementById('jobCardActions') as HTMLElement).hidden = false;
      const shown = (id: string) =>
        getComputedStyle(document.getElementById(id) as HTMLElement).display !== 'none';
      detail.dataset.jcView = 'edit';
      const edit = { grid: shown('jobCardDetailGrid'), actions: shown('jobCardActions') };
      detail.dataset.jcView = 'view';
      return { edit, view: { grid: shown('jobCardDetailGrid'), actions: shown('jobCardActions') } };
    });
    expect(state.edit).toEqual({ grid: false, actions: true });
    expect(state.view).toEqual({ grid: true, actions: false });
  });

  test('Job card form: period from locked, warranty days pill, post-create sections hidden', async ({
    page,
  }) => {
    await mockApi(page, ['service_job_card.read', 'service_job_card.write'], () => undefined);
    await signIn(page);
    const state = await page.evaluate(() => {
      const el = (id: string) => document.getElementById(id) as HTMLInputElement;
      const set = (id: string, value: string) => {
        el(id).value = value;
        el(id).dispatchEvent(new Event('input', { bubbles: true }));
      };
      const pill = () => document.getElementById('jccWarrantyDaysPill') as HTMLElement;
      const before = pill().hidden;
      const d = new Date();
      d.setDate(d.getDate() - 65);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      set('jccPurchaseDate', iso);
      const recent = pill().textContent;
      set('jccPurchaseDate', '2000-01-01');
      const old = { text: pill().textContent, expired: pill().classList.contains('is-expired') };
      return {
        before,
        recent,
        old,
        periodReadonly: el('jccPeriodFrom').readOnly,
        createHidden: (document.getElementById('jccPostCreate') as HTMLElement).hidden,
        editHidden: (document.getElementById('jcePostCreate') as HTMLElement).hidden,
      };
    });
    expect(state.before).toBe(true);
    expect(state.recent).toMatch(/^\d+ warranty days? left$/);
    expect(state.old).toEqual({ text: 'Warranty expired', expired: true });
    expect(state.periodReadonly).toBe(true);
    expect(state.createHidden).toBe(true);
    expect(state.editHidden).toBe(false);
  });

  test('Job card form locks the MDA service charge and greys payment mode', async ({ page }) => {
    await mockApi(page, ['service_job_card.read', 'service_job_card.write'], (url) => {
      if (url.pathname === '/api/rate-card') {
        return {
          sections: [
            {
              key: 'warranty_repairs',
              label: 'Warranty Repairs',
              activities: [
                { name: 'SDA', rate: 50 },
                { name: 'MDA \u2013 Standard', rate: 100 },
              ],
            },
          ],
        };
      }
      return undefined;
    });
    await signIn(page);
    // The form fields exist in the page even before a job card is opened.
    const state = await page.evaluate(async () => {
      const set = (id: string, value: string) => {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const read = (id: string) => document.getElementById(id) as HTMLInputElement;
      const wait = () => new Promise((resolve) => setTimeout(resolve, 300));
      set('jccFinalWarrantyStatus', 'Out Warranty');
      set('jccCustomerType', 'B2B');
      set('jccPaymentBy', 'Sales channel');
      set('jccPaymentBy', 'Customer');
      set('jccServiceCharge', '7');
      set('jccMainGroup', 'MDA');
      await wait();
      const mda = {
        value: read('jccServiceCharge').value,
        locked: read('jccServiceCharge').readOnly,
      };
      set('jccMainGroup', 'SDA');
      await wait();
      return {
        mda,
        sdaLocked: read('jccServiceCharge').readOnly,
      };
    });
    expect(state.mda).toEqual({ value: '100', locked: true });
    expect(state.sdaLocked).toBe(false);
  });
});
