import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAmcContractService } from '../../apps/api/src/amc-contracts/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

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

const quote = (price: number, client = 'Revise Test Client') => ({
  contractPeriod: '1 Year',
  clientName: client,
  appliances: [{ name: 'Built-in Oven', qty: 5, price: 650, ref: true }],
  totalCount: 5,
  totalValue: 3250,
  plans: [plan('basic-rm', 'Basic RM', price), plan('premium-pmc', 'Premium PMC', price * 2)],
});

test(
  'Admin revise keeps the reference, stores the old version, and locks Sold records',
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
    const service = createAmcContractService(pool);
    let profileId: string | undefined;
    let contractId: string | undefined;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Revise tester') RETURNING id`,
        [`amc-revise-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0]!.id;

      const created = await service.create(quote(1000), profileId);
      contractId = created.id;
      assert.equal(created.revision, 1);
      assert.deepEqual(await service.revisions(created.id), []);

      // Management price reduction: same reference, new prices, Rev 2.
      const revised = await service.revise(
        created.id,
        { ...quote(900, 'Renamed Client'), revisionNote: 'Management price reduction' },
        profileId,
      );
      assert.equal(revised.amcContractReference, created.amcContractReference);
      assert.equal(revised.revision, 2);
      assert.equal(revised.revisionNote, 'Management price reduction');
      assert.equal(revised.clientName, 'Renamed Client');
      assert.equal(revised.plans[0]!.priceExclVat, 900);
      assert.equal(revised.contractDate, created.contractDate);

      // The first version is kept exactly as it was saved.
      const history = await service.revisions(created.id);
      assert.equal(history.length, 1);
      assert.equal(history[0]!.revision, 1);
      assert.equal(history[0]!.snapshot.clientName, 'Revise Test Client');
      assert.equal(history[0]!.snapshot.plans[0]!.priceExclVat, 1000);
      assert.equal(history[0]!.savedByName, 'Revise tester');

      // A second revision stacks on top.
      const again = await service.revise(created.id, quote(850), profileId);
      assert.equal(again.revision, 3);
      assert.deepEqual(
        (await service.revisions(created.id)).map((r) => r.revision),
        [2, 1],
      );

      // Sold records are locked until reopened to Quote.
      await service.setStatus(
        created.id,
        { status: 'Sold', planKey: 'basic-rm', soldDate: '2026-11-01' },
        profileId,
      );
      await assert.rejects(
        () => service.revise(created.id, quote(800), profileId!),
        (error: Error & { code?: string }) => error.code === 'sold-locked',
      );
      await service.setStatus(created.id, { status: 'Quote' }, profileId);
      const reopened = await service.revise(created.id, quote(800), profileId);
      assert.equal(reopened.revision, 4);

      // Audit trail records old and new prices.
      const audit = await pool.query(
        `SELECT metadata FROM audit_events WHERE action = 'amc_contract.revised' AND target_id = $1 ORDER BY id`,
        [created.id],
      );
      assert.equal(audit.rows.length, 3);
      assert.equal(audit.rows[0]!.metadata.priceInclVatBefore['basic-rm'], 1050);
      assert.equal(audit.rows[0]!.metadata.priceInclVatAfter['basic-rm'], 945);

      await assert.rejects(
        () => service.revise('999999999', quote(1), profileId!),
        (error: Error & { code?: string }) => error.code === 'not-found',
      );
    } finally {
      if (contractId) await pool.query(`DELETE FROM amc_contracts WHERE id = $1`, [contractId]);
      await pool.end();
    }
  },
);
