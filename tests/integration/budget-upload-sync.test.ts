import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createRevenueDashboardService } from '../../apps/api/src/revenue-dashboard/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { activeVersion, versionStreams } from '../../packages/db/src/budget-variance.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

async function budgetWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const pl = wb.addWorksheet('P&L -YTD');
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 6 + i, 1)));
  months.forEach((d, i) => (pl.getRow(2).getCell(3 + i).value = d));
  pl.getRow(4).getCell(2).value = 'REVENUE';
  months.forEach((_, i) => (pl.getRow(4).getCell(3 + i).value = i < 6 ? 30000 : 10000));
  const price = wb.addWorksheet('Service Price List');
  price.getRow(33).getCell(2).value = 'Proposed Revenue 2027';
  price.getRow(34).getCell(2).value = 'Revenue Stream';
  const rows: Array<[string, number, number]> = [
    ['Warranty Repairs', 100, 60000],
    ['Projects', 50, 90000],
    ['Premium PMC', 0, 30000],
  ];
  rows.forEach(([label, vol, rev], i) => {
    const r = price.getRow(35 + i);
    r.getCell(2).value = label;
    r.getCell(3).value = vol;
    r.getCell(5).value = rev;
  });
  price.getRow(38).getCell(2).value = 'Total  Revenue';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test(
  'a budget upload refreshes the budget version that Budget Variance reads',
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
    const service = createRevenueDashboardService(pool);
    let profileId: string | undefined;
    let batchId: string | undefined;
    let before: { id: string; phasing: unknown; notes: unknown; streams: unknown[] } | undefined;
    try {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO profiles (email, display_name) VALUES ($1, 'Budget sync') RETURNING id`,
        [`budget-sync-${randomUUID()}@example.test`],
      );
      profileId = profile.rows[0].id;
      const client = await pool.connect();
      try {
        const v = await activeVersion(client, 2026);
        assert.ok(v, 'an active 2026 budget version is seeded');
        before = {
          id: v.id,
          phasing: v.phasing,
          notes: v.notes,
          streams: await versionStreams(client, v.id),
        };
      } finally {
        client.release();
      }

      const buffer = await budgetWorkbook();
      const batch = (await service.importWorkbook(
        'budget',
        { originalname: 'budget-sync.xlsx', size: buffer.length, buffer },
        profileId,
      )) as { id: string; budgetVersion?: { versionId: string; streams: number } };
      batchId = batch.id;
      assert.equal(batch.budgetVersion?.versionId, before.id);
      assert.equal(batch.budgetVersion?.streams, 3);

      const client2 = await pool.connect();
      try {
        const streams = await versionStreams(client2, before.id);
        const by = Object.fromEntries(streams.map((s) => [s.streamCode, s]));
        assert.equal(Number(by.warranty.annualRevenue), 60000);
        assert.equal(Number(by.projects.annualRevenue), 90000);
        assert.equal(Number(by.amc.annualRevenue), 30000);
        assert.equal(by.amc.vatInclusive, true, 'the VAT setting on the version is kept');
        const v = await activeVersion(client2, 2026);
        const phasing = v!.phasing as number[];
        assert.equal(phasing.length, 12);
        assert.ok(Math.abs(phasing.reduce((a, b) => a + b, 0) - 1) < 1e-6);
        assert.ok(Math.abs(phasing[0]! - 30000 / 240000) < 1e-5);
      } finally {
        client2.release();
      }
    } finally {
      if (batchId) await pool.query(`DELETE FROM revenue_import_batches WHERE id = $1`, [batchId]);
      if (before) {
        await pool.query(
          `UPDATE budget_versions SET phasing = $2::jsonb, notes = $3 WHERE id = $1`,
          [before.id, JSON.stringify(before.phasing), before.notes],
        );
        await pool.query(`DELETE FROM budget_version_streams WHERE version_id = $1`, [before.id]);
        for (const s of before.streams as Array<Record<string, unknown>>) {
          await pool.query(
            `INSERT INTO budget_version_streams (version_id, stream_code, annual_revenue, annual_volume, vat_inclusive)
             VALUES ($1, $2, $3, $4, $5)`,
            [before.id, s.streamCode, s.annualRevenue, s.annualVolume, s.vatInclusive],
          );
        }
      }
      if (profileId) {
        await pool.query(`DELETE FROM audit_events WHERE actor_profile_id = $1`, [profileId]);
        await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
      }
      await pool.end();
    }
  },
);
