import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createCategoryMappingService } from '../../apps/api/src/category-mappings/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import {
  insertBillingRule,
  listActiveBillingRules,
  updateBillingRule,
} from '../../packages/db/src/billing-rules.js';
import { insertSalesChannel, updateSalesChannel } from '../../packages/db/src/sales-channels.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'Delivery & installation masters: category mapping, channel reporting name, brand billing rule',
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
    const tag = randomUUID().slice(0, 8).toUpperCase();
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'D&I masters test') RETURNING id`,
        [`dandi-${randomUUID()}@example.test`],
      );
      const profileId = profile.rows[0]!.id;

      // The migration seeds the four installable groups from the workbook.
      const service = createCategoryMappingService(pool);
      const initial = await service.list();
      const seeded = initial.categoryMappings.filter((m) =>
        ['FRIDGE', 'FREEZER', 'WASHING MACHINE', 'COOKER'].includes(m.groupName),
      );
      assert.equal(seeded.length, 4);
      assert.ok(seeded.every((m) => m.installable && m.pricingCategory));
      assert.deepEqual(initial.pricingCategories, [
        'Freestanding Refrigerator',
        'Freestanding Washing Machine',
        'Freestanding Cooker',
      ]);

      // Add, reject a duplicate (case-insensitive), reject an unknown pricing category.
      const group = `TEST GROUP ${tag}`;
      const created = await service.create(
        { groupName: group, installable: true, pricingCategory: 'Freestanding Cooker' },
        profileId,
      );
      assert.equal(created.installable, true);
      await assert.rejects(
        service.create({ groupName: group.toLowerCase(), installable: false }, profileId),
        /already mapped/,
      );
      await assert.rejects(
        service.create(
          { groupName: `X ${tag}`, installable: true, pricingCategory: 'Nope' },
          profileId,
        ),
        /pricing category must be one of/,
      );
      await assert.rejects(
        service.create({ groupName: `Y ${tag}`, installable: true }, profileId),
        /pricing category/i,
      );

      // A non-installable group drops its pricing category.
      const updated = await service.update(
        created.id,
        { groupName: group, installable: false, pricingCategory: 'Freestanding Cooker' },
        profileId,
      );
      assert.equal(updated.installable, false);
      assert.equal(updated.pricingCategory, null);
      await assert.rejects(
        service.update('999999999', { groupName: 'Z', installable: false }, profileId),
        /not found/,
      );

      // An unmapped stock group is listed until it is mapped.
      const itemCode = `DI-${tag}`;
      await pool.query(
        `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, brand)
         VALUES ($1, 'Test item', 'MDA', $2, 'TESTBRAND')`,
        [itemCode, `UNMAPPED ${tag}`],
      );
      assert.ok(
        (await service.list()).unmappedGroups.some((g) => g.groupName === `UNMAPPED ${tag}`),
      );
      await service.create({ groupName: `unmapped ${tag}`, installable: false }, profileId);
      assert.ok(
        !(await service.list()).unmappedGroups.some((g) => g.groupName === `UNMAPPED ${tag}`),
      );
      await pool.query('DELETE FROM stock_master WHERE item_code = $1', [itemCode]);

      // Channel reporting name: set, keep when omitted, clear with an empty string.
      const client = await pool.connect();
      try {
        const channel = await insertSalesChannel(client, {
          name: `CH-${tag}`,
          reportingName: 'HAA',
        });
        assert.equal(channel.reportingName, 'HAA');
        const kept = await updateSalesChannel(client, channel.id, { name: `CH-${tag}` });
        assert.equal(kept?.reportingName, 'HAA');
        const cleared = await updateSalesChannel(client, channel.id, {
          name: `CH-${tag}`,
          reportingName: '',
        });
        assert.equal(cleared?.reportingName, null);
        await client.query('DELETE FROM sales_channels WHERE id = $1', [channel.id]);

        // Brand billing rule: stored with is / is not and read back.
        const rule = await insertBillingRule(client, {
          salesman: `Tester ${tag}`,
          brand: 'VENUS',
          brandMatch: 'is_not',
          billToChannel: 'JER-C/INS',
        });
        assert.equal(rule.brand, 'VENUS');
        assert.equal(rule.brandMatch, 'is_not');
        const edited = await updateBillingRule(client, rule.id, {
          salesman: `Tester ${tag}`,
          brand: 'VENUS',
          brandMatch: 'is',
          billToChannel: 'JDI',
        });
        assert.equal(edited?.brandMatch, 'is');
        assert.ok((await listActiveBillingRules(client)).some((r) => r.id === rule.id));
        // A rule with no condition at all is still refused by the database.
        await assert.rejects(
          client.query(`INSERT INTO billing_rules (bill_to_channel) VALUES ('JDI')`),
          /billing_rules_has_condition/,
        );
        await client.query('DELETE FROM billing_rules WHERE id = $1', [rule.id]);
      } finally {
        client.release();
      }

      await pool.query(`DELETE FROM category_mappings WHERE group_name ILIKE $1`, [`%${tag}%`]);
      const audits = await pool.query(
        `SELECT count(*)::int AS n FROM audit_events WHERE actor_profile_id = $1 AND action LIKE 'category_mapping.%'`,
        [profileId],
      );
      assert.ok(audits.rows[0].n >= 3);
    } finally {
      await pool.end();
    }
  },
);
