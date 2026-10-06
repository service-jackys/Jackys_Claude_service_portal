import type { Pool } from 'pg';
import {
  getDashboardSummary,
  type DashboardSummary,
} from '../../../../packages/db/src/dashboard.js';
import { getDashboardBoard } from '../../../../packages/db/src/dashboard-board.js';

export function createDashboardService(pool: Pool) {
  async function summary(): Promise<DashboardSummary> {
    const client = await pool.connect();
    try {
      return getDashboardSummary(client);
    } finally {
      client.release();
    }
  }

  async function board() {
    const client = await pool.connect();
    try {
      return await getDashboardBoard(client);
    } finally {
      client.release();
    }
  }

  return { summary, board };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
