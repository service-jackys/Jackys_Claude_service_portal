import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createServiceJobCardService } from '../../apps/api/src/job-cards/service.js';
import { createQuotationService } from '../../apps/api/src/quotations/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'a multi-unit quotation stores each unit and charge, and the server works out VAT and the total',
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
    let profileId: string | undefined;
    let quotationId: string | undefined;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Quotation units') RETURNING id`,
        [`quotation-units-${suffix}@example.test`],
      );
      profileId = profile.rows[0].id;
      const unit = (key: string, location: string, complaint: string) => ({
        unitKey: key,
        partNo: '',
        description: 'Washing machine',
        brand: 'LG',
        serialNo: `SN-${key}`,
        warranty: 'No',
        location,
        complaint,
        diagnosis: '',
        qty: 1,
        unitPrice: 0,
      });
      const charge = (unitKey: string, type: string, qty: number, unitPrice: number) => ({
        unitKey,
        type,
        partNo: '',
        description: type,
        qty,
        unitPrice,
      });

      // A total sent by the client is refused outright: only the server computes it.
      await assert.rejects(
        () =>
          quotations.create(
            { customerName: `Units ${suffix}`, grandTotal: 1 },
            profileId as string,
            `units-bad-${suffix}`,
          ),
        { name: 'ZodError' },
      );

      const created = await quotations.create(
        {
          customerName: `Units ${suffix}`,
          products: [unit('u1', 'Villa 12', 'Drum noise'), unit('u2', 'Apartment 3', 'No spin')],
          parts: [
            charge('u1', 'Part', 2, 100),
            charge('u1', 'Labour', 1, 90),
            charge('u2', 'Service', 1, 120),
            charge('', 'Other', 1, 10),
          ],
          vatRate: 0.05,
        },
        profileId,
        `units-${suffix}`,
      );
      quotationId = created.id;
      assert.equal(Number(created.subtotalAmount), 420);
      assert.equal(Number(created.vatAmount), 21);
      assert.equal(Number(created.grandTotal), 441);
      assert.equal(Number(created.vatRate), 0.05);

      const read = await quotations.detail(created.id);
      assert.deepEqual(
        read.products.map((u: { unitKey: string; location: string; complaint: string }) => [
          u.unitKey,
          u.location,
          u.complaint,
        ]),
        [
          ['u1', 'Villa 12', 'Drum noise'],
          ['u2', 'Apartment 3', 'No spin'],
        ],
      );
      assert.equal(read.parts.length, 4);

      // Editing without VAT recalculates; the stored total never goes stale.
      // Status, customer type and B2B branch are stored; a Pending quotation cannot become a job card.
      const b2b = await quotations.update(
        created.id,
        { customerType: 'B2B', b2bBranchSchool: 'GEMS Wellington', quotationStatus: 'Pending' },
        profileId,
        `units-b2b-${suffix}`,
      );
      assert.equal(b2b.customerType, 'B2B');
      assert.equal(b2b.b2bBranchSchool, 'GEMS Wellington');
      assert.equal(b2b.quotationStatus, 'Pending');
      const jobs = createServiceJobCardService(pool);
      await assert.rejects(() => jobs.prefillFromQuotation(created.id), {
        code: 'quotation-ineligible',
      });
      const approved = await quotations.update(
        created.id,
        { quotationStatus: 'Approved' },
        profileId,
        `units-approve-${suffix}`,
      );
      assert.equal(approved.quotationStatus, 'Approved');
      const prefill = await jobs.prefillFromQuotation(created.id);
      assert.equal(prefill.content.customerType, 'B2B');
      assert.equal(prefill.content.b2bBranchSchool, 'GEMS Wellington');

      const edited = await quotations.update(
        created.id,
        { vatRate: 0, labourAmount: 30 },
        profileId,
        `units-edit-${suffix}`,
      );
      assert.equal(Number(edited.subtotalAmount), 450);
      assert.equal(Number(edited.vatAmount), 0);
      assert.equal(Number(edited.grandTotal), 450);
    } finally {
      if (quotationId) await pool.query('DELETE FROM quotations WHERE id = $1', [quotationId]);
      if (profileId) await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]);
      await pool.end();
    }
  },
);
