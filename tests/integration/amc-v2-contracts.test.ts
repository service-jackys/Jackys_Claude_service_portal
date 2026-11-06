import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { amcContractWriteSchema } from '../../packages/contracts/src/index.js';
import { createAmcContractService } from '../../apps/api/src/amc-contracts/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

const plan = (planKey: string, planLabel: string, price: number) => ({
  planKey,
  planLabel,
  annualVisits: 1,
  laborCost: 0,
  transportCost: 0,
  partsReserve: 0,
  directCost: 0,
  overhead: 0,
  priceExclVat: price,
  priceInclVat: Math.round(price * 1.05 * 100) / 100,
  unitLines: [{ name: 'Built-in Oven', qty: 5, unitRate: price / 5 }],
  listTotal: price,
  discountPct: 0,
  discountAmount: 0,
  capApplied: false,
  perUnit: price / 5,
  callOutText: 'AED 80.00 handling charge if the appliance cannot be repaired.',
  ageBand: 'Year 4',
});

const quote = (client: string, pricingModel?: 'v1' | 'v2') => ({
  clientName: client,
  appliances: [{ name: 'Built-in Oven', qty: 5, price: 650, ref: true }],
  totalCount: 5,
  totalValue: 3250,
  plans: [plan('standard-pmc', 'Standard PMC', 500)],
  ...(pricingModel ? { pricingModel } : {}),
});

test('write schema accepts the new-quote fields and rejects a bad pricing model', () => {
  assert.doesNotThrow(() => amcContractWriteSchema.parse(quote('x', 'v2')));
  assert.throws(() => amcContractWriteSchema.parse({ ...quote('x'), pricingModel: 'v3' }));
});

test(
  'v2 quotes keep their rate lines, stay out of the v1 list and keep the model when revised',
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
    const ids: string[] = [];
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'AMC v2 contracts') RETURNING id`,
        [`amc-v2-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;
      const marker = `V2-${randomUUID()}`;

      const original = await service.create(quote(marker + ' old'), profileId);
      const fresh = await service.create(quote(marker + ' new', 'v2'), profileId);
      ids.push(original.id, fresh.id);
      assert.equal(original.pricingModel, 'v1');
      assert.equal(fresh.pricingModel, 'v2');
      assert.equal(fresh.plans[0]!.unitLines![0]!.unitRate, 100);
      assert.equal(fresh.plans[0]!.ageBand, 'Year 4');
      assert.match(fresh.plans[0]!.callOutText!, /handling charge/);

      const v2 = await service.list({ search: marker, pricingModel: 'v2' });
      assert.deepEqual(
        v2.items.map((c) => c.id),
        [fresh.id],
      );
      const v1 = await service.list({ search: marker, pricingModel: 'v1' });
      assert.deepEqual(
        v1.items.map((c) => c.id),
        [original.id],
      );
      assert.equal((await service.list({ search: marker })).items.length, 2);

      // Revising keeps the model it was issued with, even if the body says otherwise.
      const revised = await service.revise(
        fresh.id,
        { ...quote(marker + ' new', 'v1'), revisionNote: 'test' },
        profileId,
      );
      assert.equal(revised.pricingModel, 'v2');
      assert.equal(revised.revision, 2);
      assert.equal(revised.plans[0]!.unitLines![0]!.qty, 5);
    } finally {
      for (const id of ids) await pool.query(`DELETE FROM amc_contracts WHERE id = $1`, [id]);
      await pool.end();
    }
  },
);
