import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInvoiceService } from '../../apps/api/src/invoices/service.js';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
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

const blocked = (error: unknown) =>
  error instanceof ServiceJobCardError && error.code === 'billing-blocked';

test(
  'Billing: warranty drives job type and payer, and the customer must pay before Delivered',
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
    const appointmentIds: string[] = [];
    const jobCardIds: string[] = [];
    let profileId: string | undefined;
    let nextDay = 40;

    async function makeCard(overrides: Record<string, unknown>) {
      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Billing Customer',
          contactNumber: '0500000700',
          faultDescription: 'Billing integration appointment',
          appointmentDate: dayOffset(nextDay++),
          jobWarranty: 'In Warranty',
          ...overrides,
        },
        profileId!,
        `billing-appt-${randomUUID()}`,
      );
      appointmentIds.push(appointment.id);
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId!,
        `billing-progress-${randomUUID()}`,
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId!,
        `billing-complete-${randomUUID()}`,
      );
      const card = await jobCardService.create(
        appointment.id,
        {},
        profileId!,
        `billing-card-${randomUUID()}`,
      );
      jobCardIds.push(card.id);
      return card;
    }

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Billing integration') RETURNING id`,
        [`billing-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      // In warranty: CSIJW, billed to the channel the billing rule picks.
      const gems = await makeCard({
        customerType: 'B2B',
        b2bBranchSchool: 'GEMS Billing Test School',
        salesman: 'Raneesh Jose',
      });
      assert.equal(gems.billingJobType, 'CSIJW');
      assert.equal(gems.paymentBy, 'Sales channel');
      assert.equal(gems.billToChannel, 'JDI');

      // The technician voids the warranty: a reason is mandatory.
      const card = await makeCard({});
      assert.equal(card.billingJobType, 'CSIJW');
      await assert.rejects(
        jobCardService.updateContent(
          card.id,
          { finalWarrantyStatus: 'Out Warranty' },
          profileId,
          'billing-void-no-reason',
        ),
        blocked,
      );
      const voided = await jobCardService.updateContent(
        card.id,
        {
          finalWarrantyStatus: 'Out Warranty',
          warrantyOverrideReason: 'Customer-induced damage',
          serviceCharge: 120,
        },
        profileId,
        'billing-void',
      );
      assert.equal(voided.billingJobType, 'CSIJO');
      assert.equal(voided.paymentBy, 'Customer');
      assert.equal(voided.billToChannel, null);
      assert.equal(voided.warrantyOverrideReason, 'Customer-induced damage');

      await jobCardService.updateContent(
        card.id,
        { jobFinalStatus: 'Repair Completed' },
        profileId,
        'billing-repaired',
      );

      // Customer pays: no invoice -> blocked, invoice but no payment -> blocked.
      await assert.rejects(
        jobCardService.updateContent(
          card.id,
          { jobFinalStatus: 'Delivered' },
          profileId,
          'billing-deliver-no-invoice',
        ),
        (error: unknown) => blocked(error) && /invoice number/.test((error as Error).message),
      );
      await assert.rejects(
        jobCardService.updateContent(
          card.id,
          { jobFinalStatus: 'Delivered', invoiceNo: 'INV-BILL-1' },
          profileId,
          'billing-deliver-unpaid',
        ),
        (error: unknown) => blocked(error) && /Confirm the payment/.test((error as Error).message),
      );
      // Confirming needs a payment mode.
      await assert.rejects(
        jobCardService.updateContent(
          card.id,
          { invoiceNo: 'INV-BILL-1', paymentConfirmed: true },
          profileId,
          'billing-confirm-no-mode',
        ),
        blocked,
      );
      const delivered = await jobCardService.updateContent(
        card.id,
        {
          jobFinalStatus: 'Delivered',
          invoiceNo: 'INV-BILL-1',
          invoiceDate: dayOffset(0),
          paymentMode: 'Bank transfer',
          paymentReference: 'TRX-1',
          paymentConfirmed: true,
        },
        profileId,
        'billing-deliver-paid',
      );
      assert.equal(delivered.jobFinalStatus, 'Delivered');
      assert.ok(delivered.paymentConfirmedAt);
      assert.equal(delivered.paymentMode, 'Bank transfer');

      // Out of warranty billed to the channel: no payment gate.
      const channelCard = await makeCard({
        customerType: 'B2B',
        b2bBranchSchool: 'Plain School',
        jobWarranty: 'Out Warranty',
      });
      assert.equal(channelCard.billingJobType, 'CSIJO');
      assert.equal(channelCard.paymentBy, 'Sales channel');
      await jobCardService.updateContent(
        channelCard.id,
        { serviceCharge: 300, jobFinalStatus: 'Repair Completed' },
        profileId,
        'billing-channel-repaired',
      );
      const channelDelivered = await jobCardService.updateContent(
        channelCard.id,
        { jobFinalStatus: 'Delivered' },
        profileId,
        'billing-channel-delivered',
      );
      assert.equal(channelDelivered.jobFinalStatus, 'Delivered');

      // Accounts ledger: the paid customer job and the channel job both show,
      // each with its bill-to party, stage and amount; totals cover the filter.
      const invoiceService = createInvoiceService(pool);
      const paid = await invoiceService.ledger({ search: card.jobCardReference });
      assert.equal(paid.rows.length, 1);
      assert.equal(paid.rows[0].stage, 'Paid');
      assert.equal(paid.rows[0].payer, 'Customer');
      assert.equal(paid.rows[0].billTo, 'Billing Customer');
      assert.equal(paid.rows[0].invoiceNo, 'INV-BILL-1');
      assert.equal(paid.totals.billedAmount, 120);
      const viaChannel = await invoiceService.ledger({ search: channelCard.jobCardReference });
      assert.equal(viaChannel.rows.length, 1);
      assert.equal(viaChannel.rows[0].stage, 'Not invoiced');
      assert.equal(viaChannel.rows[0].billedAmount, 300);
      assert.equal(viaChannel.statement.length, 1);
      assert.equal(viaChannel.statement[0].nonWarrantyAmount, 300);
      assert.equal(viaChannel.statement[0].notInvoicedAmount, 300);
      const stageOnly = await invoiceService.ledger({
        stage: 'Paid',
        search: card.jobCardReference,
      });
      assert.equal(stageOnly.total, 1);
      const exported = await invoiceService.exportLedger(
        { search: card.jobCardReference },
        profileId,
        'billing-export',
      );
      assert.equal(exported.rows, 1);
      assert.match(exported.fileName, /^Billing_/);
      await pool.query(`DELETE FROM audit_events WHERE request_id = 'billing-export'`);
    } finally {
      for (const id of jobCardIds) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'service_job_card' AND target_id = $1`,
          [id],
        );
        await pool.query(`DELETE FROM service_job_cards WHERE id = $1`, [id]);
      }
      for (const id of appointmentIds) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'appointment' AND target_id = $1`,
          [id],
        );
        await pool.query(`DELETE FROM appointments WHERE id = $1`, [id]);
      }
      if (profileId) await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);
