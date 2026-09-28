import type { Pool } from 'pg';
import {
  getDashboardSummary,
  type DashboardSummary,
} from '../../../../packages/db/src/dashboard.js';

export function createDashboardService(pool: Pool) {
  async function summary(): Promise<DashboardSummary> {
    const client = await pool.connect();
    try {
      return getDashboardSummary(client);
    } finally {
      client.release();
    }
  }

  return { summary };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
