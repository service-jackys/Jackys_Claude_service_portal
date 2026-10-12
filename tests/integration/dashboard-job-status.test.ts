import assert from 'node:assert/strict';
import test from 'node:test';
import { createDbPool } from '../../packages/db/src/client.js';
import { getDashboardSummary } from '../../packages/db/src/dashboard.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'dashboard counts job cards by job status so WIP jobs appear',
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
    try {
      const before = await getDashboardSummary(client);
      const wipBefore = before.jobCards.byStatus['WIP'] ?? 0;
      const reference = `WJC-9${new Date().getFullYear() % 10}99-${String(Math.floor(Math.random() * 90000) + 10000)}`;
      await client.query(
        `INSERT INTO service_job_cards (job_card_reference, source_type, job_final_status, status)
         VALUES ($1, 'Walk-in', 'WIP', 'Open')`,
        [reference],
      );
      try {
        const after = await getDashboardSummary(client);
        assert.equal(after.jobCards.byStatus['WIP'], wipBefore + 1);
        assert.equal(after.jobCards.byStatus['Open'], undefined);
      } finally {
        await client.query(`DELETE FROM service_job_cards WHERE job_card_reference = $1`, [
          reference,
        ]);
      }
    } finally {
      client.release();
      await pool.end();
    }
  },
);
