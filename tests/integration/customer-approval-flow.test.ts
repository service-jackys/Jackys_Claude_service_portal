import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createQuotationService } from '../../apps/api/src/quotations/service.js';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createWarrantyApprovalService } from '../../apps/api/src/warranty-approvals/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'a job made from a quotation waits for customer approval and moves to WIP when it is approved',
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
    const suffix = randomUUID().slice(0, 8);
    const quotations = createQuotationService(pool);
    const jobs = createServiceJobCardService(pool);
    const approvals = createWarrantyApprovalService(pool);
    let profileId: string | undefined;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Approval flow') RETURNING id`,
        [`approval-flow-${suffix}@example.test`],
      );
      profileId = profile.rows[0].id;

      // Quotation A: customer approves through the link.
      const quotationA = await quotations.create(
        { customerName: `Flow A ${suffix}`, warrantyStatus: 'Out Warranty' },
        profileId,
        `flow-a-${suffix}`,
      );
      assert.equal(
        (await jobs.prefillFromQuotation(quotationA.id)).initialJobFinalStatus,
        'Customer approval pending',
      );
      const jobA = await jobs.createFromQuotation(
        quotationA.id,
        {},
        profileId,
        `flow-ja-${suffix}`,
      );
      assert.equal(jobA.jobFinalStatus, 'Customer approval pending');

      const approvalA = await approvals.create(
        { quotationId: quotationA.id },
        profileId,
        `flow-wa-${suffix}`,
      );
      assert.equal(approvalA.warrantyStatus, 'Out Warranty');
      assert.equal((await quotations.detail(quotationA.id)).approvalStatus, 'Pending');
      assert.equal((await jobs.detail(jobA.id)).approval?.status, 'Pending');

      await approvals.decide(
        approvalA.accessToken,
        { decision: 'Approved', decidedByName: 'Customer A' },
        `flow-da-${suffix}`,
      );
      const afterA = await jobs.detail(jobA.id);
      assert.equal(afterA.jobCard.jobFinalStatus, 'WIP');
      assert.equal(afterA.approval?.status, 'Approved');
      assert.equal(afterA.approval?.decisionMethod, 'Customer link');
      assert.equal((await quotations.detail(quotationA.id)).approvalStatus, 'Approved');

      // Quotation B: staff record a phone approval on the request.
      const quotationB = await quotations.create(
        { customerName: `Flow B ${suffix}` },
        profileId,
        `flow-b-${suffix}`,
      );
      const jobB = await jobs.createFromQuotation(
        quotationB.id,
        {},
        profileId,
        `flow-jb-${suffix}`,
      );
      const approvalB = await approvals.create({ quotationId: quotationB.id }, profileId);
      await approvals.recordDecision(
        approvalB.id,
        { decision: 'Approved', method: 'Phone', decisionNotes: 'Called the school' },
        profileId,
        'Staff',
      );
      assert.equal((await jobs.detail(jobB.id)).jobCard.jobFinalStatus, 'WIP');
      assert.equal((await jobs.detail(jobB.id)).approval?.decisionMethod, 'Phone');

      // Quotation C: moving to WIP by hand needs the approval method.
      const quotationC = await quotations.create(
        { customerName: `Flow C ${suffix}` },
        profileId,
        `flow-c-${suffix}`,
      );
      const jobC = await jobs.createFromQuotation(
        quotationC.id,
        {},
        profileId,
        `flow-jc-${suffix}`,
      );
      await assert.rejects(
        jobs.updateContent(jobC.id, { jobFinalStatus: 'WIP' }, profileId, `flow-uc1-${suffix}`),
        /Record how the customer approved/,
      );
      await jobs.updateContent(
        jobC.id,
        { jobFinalStatus: 'WIP', approvalMethod: 'Email', approvalNotes: 'Mail from principal' },
        profileId,
        `flow-uc2-${suffix}`,
      );
      const afterC = await jobs.detail(jobC.id);
      assert.equal(afterC.jobCard.jobFinalStatus, 'WIP');
      assert.equal(afterC.approval?.status, 'Approved');
      assert.equal(afterC.approval?.decisionMethod, 'Email');
      assert.ok(
        afterC.history.some((entry) => /Customer approved \(Email\)/.test(entry.reason ?? '')),
      );
    } finally {
      await pool.end();
    }
  },
);
