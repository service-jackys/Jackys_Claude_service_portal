import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { listServiceJobCards } from '../../packages/db/src/job-cards.js';
import { insertWarrantyApproval } from '../../packages/db/src/warranty-approvals.js';
import { allocateWarrantyApprovalReference } from '../../packages/db/src/references.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'approval requests accept a quotation source and the job picker lists only jobs awaiting customer approval',
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
    const client = await pool.connect();
    const suffix = String(Math.floor(Math.random() * 90000) + 10000);
    const pending = `WJC-2098-${suffix}`;
    const inProgress = `WJC-2097-${suffix}`;
    const quotationReference = `QO-2098-${suffix}`;
    try {
      await client.query(
        `INSERT INTO service_job_cards (job_card_reference, source_type, job_final_status, status)
         VALUES ($1, 'Walk-in', 'Customer approval pending', 'Open'), ($2, 'Walk-in', 'WIP', 'Open')`,
        [pending, inProgress],
      );
      const picker = await listServiceJobCards(client, {
        forApproval: true,
        page: 1,
        pageSize: 100,
      });
      const references = picker.items.map((row) => row.jobCardReference);
      assert.ok(references.includes(pending));
      assert.ok(!references.includes(inProgress));

      const allocated = await allocateWarrantyApprovalReference(client, '2098-01-01');
      assert.match(allocated, /^WA-2098-\d{5}$/);
      await client.query(
        `DELETE FROM reference_counters WHERE namespace = 'warranty_approval' AND scope_date = '2098-01-01'`,
      );
      const profile = await client.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'WA source test') RETURNING id`,
        [`wa-${suffix}@example.test`],
      );
      const quotation = await client.query<{ id: string }>(
        `INSERT INTO quotations (quotation_reference, customer_name) VALUES ($1, 'Beta School') RETURNING id`,
        [quotationReference],
      );
      const approval = await insertWarrantyApproval(client, {
        approvalReference: `WA-2098-${suffix}`,
        jobCardId: null,
        inspectionId: null,
        quotationId: quotation.rows[0].id,
        customerName: 'Beta School',
        contactNumber: null,
        itemDescription: null,
        warrantyStatus: null,
        estimatedCost: 1200,
        notes: null,
        accessToken: `tok-${suffix}`,
        createdBy: profile.rows[0].id,
      });
      assert.equal(approval.quotationReference, quotationReference);
      await client.query(`DELETE FROM warranty_approvals WHERE id = $1`, [approval.id]);
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quotation.rows[0].id]);
      await client.query(`DELETE FROM profiles WHERE id = $1`, [profile.rows[0].id]);
    } finally {
      await client.query(`DELETE FROM service_job_cards WHERE job_card_reference = ANY($1)`, [
        [pending, inProgress],
      ]);
      client.release();
      await pool.end();
    }
  },
);
