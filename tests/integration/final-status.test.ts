import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
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

const code = (expected: string) => (error: unknown) =>
  error instanceof ServiceJobCardError && error.code === expected;

test(
  'BER, Rejected and Cancelled: charges, reasons, closure approval and sales channel',
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
    const branchNames: string[] = [];
    const salesmanNames: string[] = [];
    let profileId: string | undefined;
    let nextDay = 70;

    async function makeCard(overrides: Record<string, unknown>) {
      const appointment = await appointmentService.create(
        {
          customerType: 'B2C',
          customerName: 'Outcome Customer',
          contactNumber: '0500000900',
          faultDescription: 'Outcome integration appointment',
          appointmentDate: dayOffset(nextDay++),
          jobWarranty: 'Out Warranty',
          ...overrides,
        },
        profileId!,
        `outcome-appt-${randomUUID()}`,
      );
      appointmentIds.push(appointment.id);
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId!,
        `outcome-progress-${randomUUID()}`,
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId!,
        `outcome-complete-${randomUUID()}`,
      );
      const card = await jobCardService.create(
        appointment.id,
        {},
        profileId!,
        `outcome-card-${randomUUID()}`,
      );
      jobCardIds.push(card.id);
      return card;
    }

    const part = { partNo: 'P1', description: 'Fan', qty: 1, unitPrice: 100 };

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Outcome integration') RETURNING id`,
        [`outcome-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      // ---- B2C: charges are waived; spare parts need a manager's approval.
      const b2c = await makeCard({});
      const ber = await jobCardService.updateContent(
        b2c.id,
        { jobFinalStatus: 'BER', serviceCharge: 119, parts: [part] },
        profileId,
        'outcome-b2c-ber',
      );
      assert.equal(ber.jobFinalStatus, 'BER');
      assert.equal(Number(ber.serviceCharge), 0, 'B2C BER waives the service charge');
      assert.equal(Number(ber.amountChargeable), 0);

      // Delivered needs a reason first.
      await assert.rejects(
        jobCardService.updateContent(
          b2c.id,
          { finalStatus: 'Delivered' },
          profileId,
          'outcome-b2c-no-reason',
        ),
        code('reason-required'),
      );
      // With spare parts on the card it also needs a manager's approval.
      await assert.rejects(
        jobCardService.updateContent(
          b2c.id,
          { finalStatus: 'Delivered', finalStatusReason: 'Customer declined the quote' },
          profileId,
          'outcome-b2c-no-approval',
        ),
        code('closure-approval-required'),
      );
      // Removing the parts without approval is refused too.
      await assert.rejects(
        jobCardService.updateContent(b2c.id, { parts: [] }, profileId, 'outcome-b2c-remove'),
        code('closure-approval-required'),
      );
      const requested = await jobCardService.requestClosureApproval(
        b2c.id,
        profileId,
        'outcome-b2c-request',
      );
      assert.equal(requested.closureApprovalStatus, 'Pending');
      await assert.rejects(
        jobCardService.updateContent(b2c.id, { parts: [] }, profileId, 'outcome-b2c-pending'),
        code('closure-approval-required'),
      );
      const approved = await jobCardService.decideClosureApproval(
        b2c.id,
        { decision: 'Approved', note: 'Customer refused the quote' },
        profileId,
        'outcome-b2c-approve',
      );
      assert.equal(approved.closureApprovalStatus, 'Approved');
      // After approval the CCE removes the spares and delivers; BER stays BER.
      const delivered = await jobCardService.updateContent(
        b2c.id,
        { parts: [], finalStatus: 'Delivered', finalStatusReason: 'Customer declined the quote' },
        profileId,
        'outcome-b2c-deliver',
      );
      assert.equal(delivered.finalStatus, 'Delivered');
      assert.equal(delivered.jobFinalStatus, 'BER');
      assert.equal(delivered.status, 'Completed');
      assert.equal(Number(delivered.grandTotal), 0);
      const audits = await pool.query(
        `SELECT 1 FROM audit_events WHERE action = 'job_card.parts_removed' AND target_id = $1`,
        [b2c.id],
      );
      assert.equal(audits.rowCount, 1);

      // ---- B2B out of warranty: AED 60 to the sales channel; no approval needed.
      const b2b = await makeCard({
        customerType: 'B2B',
        b2bBranchSchool: 'GEMS Outcome Test School',
        salesman: 'Raneesh Jose',
      });
      const b2bBer = await jobCardService.updateContent(
        b2b.id,
        { jobFinalStatus: 'BER', parts: [part] },
        profileId,
        'outcome-b2b-ber',
      );
      assert.equal(Number(b2bBer.serviceCharge), 60);
      assert.equal(Number(b2bBer.amountChargeable), 60);
      assert.equal(b2bBer.paymentBy, 'Sales channel');
      assert.ok(b2bBer.billToChannel);
      const b2bDone = await jobCardService.updateContent(
        b2b.id,
        { finalStatus: 'Delivered', finalStatusReason: 'Parts fitted, written off' },
        profileId,
        'outcome-b2b-deliver',
      );
      assert.equal(b2bDone.finalStatus, 'Delivered');
      assert.equal(b2bDone.jobFinalStatus, 'BER');

      // ---- B2B, final warranty In Warranty: nothing is billed.
      const b2bWarranty = await makeCard({
        customerType: 'B2B',
        b2bBranchSchool: 'GEMS Outcome Test School',
        salesman: 'Raneesh Jose',
        jobWarranty: 'In Warranty',
      });
      const free = await jobCardService.updateContent(
        b2bWarranty.id,
        { jobFinalStatus: 'Rejected' },
        profileId,
        'outcome-b2b-warranty',
      );
      assert.equal(Number(free.amountChargeable), 0);

      // ---- Cancelled: never billed; delivered back with a reason.
      const cancelled = await makeCard({
        customerType: 'B2B',
        b2bBranchSchool: 'GEMS Outcome Test School',
        salesman: 'Raneesh Jose',
      });
      const cancelledJob = await jobCardService.updateContent(
        cancelled.id,
        { jobFinalStatus: 'Cancelled' },
        profileId,
        'outcome-cancel',
      );
      assert.equal(cancelledJob.status, 'Cancelled');
      assert.equal(Number(cancelledJob.amountChargeable), 0);
      const cancelledDone = await jobCardService.updateContent(
        cancelled.id,
        { finalStatus: 'Delivered', finalStatusReason: 'Duplicate job card' },
        profileId,
        'outcome-cancel-deliver',
      );
      assert.equal(cancelledDone.finalStatus, 'Delivered');
      assert.equal(cancelledDone.jobFinalStatus, 'Cancelled');

      // ---- Delivered is not allowed from WIP.
      // ---- A business job picks up the salesman from its B2B Branch / School and the
      // channel from that salesman (Salesmen & channels), not from the customer.
      const branchName = `Link Test School ${randomUUID().slice(0, 8)}`;
      const linkSalesman = `Link Test Salesman ${randomUUID().slice(0, 8)}`;
      await pool.query(
        `INSERT INTO salesmen (name, sales_channel) VALUES ($1, 'Link Test Channel')`,
        [linkSalesman],
      );
      salesmanNames.push(linkSalesman);
      await pool.query(
        `INSERT INTO b2b_branches (cust_code, branch_name, salesman, sales_channel)
         VALUES ($1, $2, $3, 'Ignored Customer Channel')`,
        [`LT-${randomUUID().slice(0, 8)}`, branchName, linkSalesman],
      );
      branchNames.push(branchName);
      const linked = await makeCard({ customerType: 'B2B', b2bBranchSchool: branchName });
      const saved = await jobCardService.updateContent(
        linked.id,
        { complaint: 'Linking check' },
        profileId,
        'outcome-link',
      );
      assert.equal(saved.salesman, linkSalesman);
      assert.equal(saved.salesChannel, 'Link Test Channel');

      const wip = await makeCard({});
      await assert.rejects(
        jobCardService.updateContent(
          wip.id,
          { finalStatus: 'Delivered' },
          profileId,
          'outcome-wip-deliver',
        ),
        code('invalid-transition'),
      );
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
      for (const name of branchNames) {
        await pool.query(`DELETE FROM b2b_branches WHERE branch_name = $1`, [name]);
      }
      for (const name of salesmanNames) {
        await pool.query(`DELETE FROM salesmen WHERE name = $1`, [name]);
      }
      if (profileId) await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);
