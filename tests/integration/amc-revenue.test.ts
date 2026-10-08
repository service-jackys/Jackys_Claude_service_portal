import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAmcContractService } from '../../apps/api/src/amc-contracts/service.js';
import { createAppointmentService } from '../../apps/api/src/appointments/service.js';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { actualRevenue } from '../../packages/db/src/budget-variance.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const plan = (planKey: string, planLabel: string, priceExclVat: number) => ({
  planKey,
  planLabel,
  annualVisits: 4,
  laborCost: 0,
  transportCost: 0,
  partsReserve: 0,
  directCost: 0,
  overhead: 0,
  priceExclVat,
  priceInclVat: Math.round(priceExclVat * 1.05 * 100) / 100,
});

test(
  'AMC sold plan and job-card billing feed the revenue actuals',
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
    const amcService = createAmcContractService(pool);
    const appointmentService = createAppointmentService(pool);
    const jobCardService = createServiceJobCardService(pool);
    let profileId: string | undefined;
    let amcId: string | undefined;
    let appointmentId: string | undefined;
    let jobCardId: string | undefined;

    const kindTotal = async (kind: string, portalJobCards: boolean) => {
      const client = await pool.connect();
      try {
        const rows = await actualRevenue(client, null, '2000-01-01', '2100-01-01', {
          portalJobCards,
        });
        return rows.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.revenue), 0);
      } finally {
        client.release();
      }
    };

    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'AMC revenue integration') RETURNING id`,
        [`amc-revenue-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;

      // A saved AMC record is a quote and counts for nothing.
      const amcBefore = await kindTotal('portal_amc', false);
      const created = await amcService.create(
        {
          clientName: 'AMC Revenue Client',
          appliances: [{ name: 'Chiller', qty: 2, price: 1000 }],
          totalCount: 2,
          totalValue: 2000,
          plans: [
            plan('basic-rm', 'Basic RM', 1000),
            plan('standard-pmc', 'Standard PMC', 1500),
            plan('premium-pmc', 'Premium PMC', 2200),
          ],
          commencementDate: dayOffset(0),
        },
        profileId,
        `amc-rev-create-${randomUUID()}`,
      );
      amcId = created.id;
      assert.equal(created.status, 'Quote');
      assert.equal(await kindTotal('portal_amc', false), amcBefore);

      // Picking the plan sold records its price ex-VAT and counts as revenue.
      await assert.rejects(
        amcService.setStatus(
          amcId,
          { status: 'Sold', planKey: 'standard-pmc' },
          profileId,
          'amc-rev-no-date',
        ),
      );
      const sold = await amcService.setStatus(
        amcId,
        { status: 'Sold', planKey: 'standard-pmc', soldDate: dayOffset(0), contractRef: 'AMC-C-1' },
        profileId,
        `amc-rev-sold-${randomUUID()}`,
      );
      assert.equal(sold.status, 'Sold');
      assert.equal(sold.soldPlanKey, 'standard-pmc');
      assert.equal(Number(sold.soldPriceExclVat), 1500);
      assert.equal(sold.contractRef, 'AMC-C-1');
      assert.equal((await kindTotal('portal_amc', false)) - amcBefore, 1500);

      // Lost or reopened takes it back out.
      const lost = await amcService.setStatus(
        amcId,
        { status: 'Lost', reason: 'Went with another vendor' },
        profileId,
        `amc-rev-lost-${randomUUID()}`,
      );
      assert.equal(lost.status, 'Lost');
      assert.equal(lost.soldPriceExclVat, null);
      assert.equal(await kindTotal('portal_amc', false), amcBefore);

      // Job-card billing counts only when the setting asks for it.
      const jobBefore = await kindTotal('portal_job_csijo', true);
      assert.equal(await kindTotal('portal_job_csijo', false), 0);
      const appointment = await appointmentService.create(
        {
          customerType: 'B2B',
          customerName: 'Revenue Customer',
          contactNumber: '0500000800',
          faultDescription: 'Revenue integration appointment',
          appointmentDate: dayOffset(70),
          jobWarranty: 'Out Warranty',
          b2bBranchSchool: 'Plain School',
        },
        profileId,
        `amc-rev-appt-${randomUUID()}`,
      );
      appointmentId = appointment.id;
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'In Progress' },
        profileId,
        `amc-rev-progress-${randomUUID()}`,
      );
      await appointmentService.changeStatus(
        appointment.id,
        { status: 'Completed', reason: 'Visit done' },
        profileId,
        `amc-rev-complete-${randomUUID()}`,
      );
      const card = await jobCardService.create(
        appointment.id,
        {},
        profileId,
        `amc-rev-card-${randomUUID()}`,
      );
      jobCardId = card.id;
      await jobCardService.updateContent(
        card.id,
        { serviceCharge: 300, jobFinalStatus: 'Repair Completed' },
        profileId,
        `amc-rev-repaired-${randomUUID()}`,
      );
      // Repaired but not yet invoiced or delivered: not revenue yet.
      assert.equal(await kindTotal('portal_job_csijo', true), jobBefore);
      await jobCardService.updateContent(
        card.id,
        { jobFinalStatus: 'Delivered' },
        profileId,
        `amc-rev-delivered-${randomUUID()}`,
      );
      assert.equal((await kindTotal('portal_job_csijo', true)) - jobBefore, 300);
      assert.equal(await kindTotal('portal_job_csijo', false), 0);
    } finally {
      if (jobCardId) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'service_job_card' AND target_id = $1`,
          [jobCardId],
        );
        await pool.query(`DELETE FROM service_job_cards WHERE id = $1`, [jobCardId]);
      }
      if (appointmentId) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'appointment' AND target_id = $1`,
          [appointmentId],
        );
        await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
      }
      if (amcId) {
        await pool.query(
          `DELETE FROM audit_events WHERE target_type = 'amc_contract' AND target_id = $1`,
          [amcId],
        );
        await pool.query(`DELETE FROM amc_contracts WHERE id = $1`, [amcId]);
      }
      if (profileId) await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      await pool.end();
    }
  },
);
