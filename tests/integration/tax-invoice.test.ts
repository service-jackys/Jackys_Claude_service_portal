import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import { InvoiceServiceError, createInvoiceService } from '../../apps/api/src/invoices/service.js';
import {
  ServiceJobCardError,
  createServiceJobCardService,
} from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test(
  'Tax invoice: issued from the Invoice screen, numbered, and required before delivery',
  { skip: !databaseUrl, concurrency: false },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    const appointmentService = createAppointmentService(pool);
    const jobCardService = createServiceJobCardService(pool);
    const invoiceService = createInvoiceService(pool);
    let nextDay = 120;
    let profileId = '';

    async function makeCard() {
      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Invoice Customer',
          contactNumber: '0500000800',
          faultDescription: 'Tax invoice integration appointment',
          appointmentDate: dayOffset(nextDay++),
          jobWarranty: 'Out Warranty',
        },
        profileId,
        `inv-appt-${randomUUID()}`,
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        `inv-progress-${randomUUID()}`,
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        `inv-complete-${randomUUID()}`,
      );
      return jobCardService.create(appointment.id, {}, profileId, `inv-card-${randomUUID()}`);
    }

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Invoice integration') RETURNING id`,
        [`invoice-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      const card = await makeCard();
      assert.equal(card.paymentBy, 'Customer');
      await jobCardService.updateContent(
        card.id,
        { serviceCharge: 105, jobFinalStatus: 'Repair Completed' },
        profileId,
        'inv-charge',
      );

      const preview = await invoiceService.detail(card.id);
      assert.equal(preview.issued, false);
      assert.equal(preview.invoice.totals.gross, 105);
      assert.equal(preview.invoice.totals.net, 100);
      assert.equal(preview.invoice.totals.vat, 5);
      assert.match(preview.deliveryBlockReason ?? '', /tax invoice/);

      // Customer TRN must be 15 digits.
      await assert.rejects(invoiceService.issue(card.id, { customerTrn: '123' }, profileId));

      const issued = await invoiceService.issue(
        card.id,
        { customerTrn: '1001 2345 6700 003', remarks: 'Oven repaired' },
        profileId,
        'inv-issue',
      );
      assert.match(issued.portalInvoiceNo ?? '', /^SINV-\d{4}-\d{5}$/);
      assert.equal(issued.issued, true);
      assert.equal(issued.customerTrn, '100123456700003');
      assert.equal(issued.invoice.customerTrn, '100123456700003');
      assert.equal(issued.invoice.remarks, 'Oven repaired');
      assert.equal(issued.invoice.amountInWords, 'AED One Hundred Five Only');

      await assert.rejects(
        invoiceService.issue(card.id, {}, profileId),
        (error: unknown) => error instanceof InvoiceServiceError && error.code === 'blocked',
      );

      // Invoiced but unpaid: still cannot be delivered.
      await assert.rejects(
        jobCardService.updateContent(
          card.id,
          { jobFinalStatus: 'Delivered' },
          profileId,
          'inv-deliver-unpaid',
        ),
        (error: unknown) =>
          error instanceof ServiceJobCardError && /Confirm the payment/.test(error.message),
      );
      await assert.rejects(
        invoiceService.update(card.id, { paymentConfirmed: true }, profileId),
        (error: unknown) =>
          error instanceof InvoiceServiceError && /payment mode/.test(error.message),
      );
      const paid = await invoiceService.update(
        card.id,
        { paymentMode: 'Card', paymentReference: 'POS-77', paymentConfirmed: true },
        profileId,
        'inv-pay',
      );
      assert.ok(paid.paymentConfirmedAt);
      assert.equal(paid.deliveryBlockReason, null);

      // The customer TRN can still be corrected, and the print follows.
      const corrected = await invoiceService.update(
        card.id,
        { customerTrn: '' },
        profileId,
        'inv-trn-clear',
      );
      assert.equal(corrected.customerTrn, null);
      assert.equal(corrected.invoice.customerTrn, null);

      const delivered = await jobCardService.updateContent(
        card.id,
        { jobFinalStatus: 'Delivered' },
        profileId,
        'inv-deliver-paid',
      );
      assert.equal(delivered.finalStatus, 'Delivered');
      assert.equal(delivered.jobFinalStatus, 'Repair Completed');

      // A second invoice takes the next number in the series.
      const second = await makeCard();
      await jobCardService.updateContent(second.id, { serviceCharge: 21 }, profileId, 'inv-c2');
      const next = await invoiceService.issue(second.id, {}, profileId, 'inv-issue-2');
      assert.notEqual(next.portalInvoiceNo, issued.portalInvoiceNo);

      // A job with no amount (internal billing) has nothing to invoice.
      const free = await makeCard();
      await assert.rejects(
        invoiceService.issue(free.id, {}, profileId),
        (error: unknown) => error instanceof InvoiceServiceError && /no amount/.test(error.message),
      );
    } finally {
      await pool.end();
    }
  },
);
