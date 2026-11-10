import type { Pool } from 'pg';
import {
  budgetVsActual,
  findActiveBatch,
  revenueGroup,
  revenueSummary,
  type RevenueFilters,
} from '../../../../packages/db/src/revenue-dashboard.js';

export interface WorkbookAccess {
  revenue: boolean;
  budget: boolean;
  can?: (permission: string) => boolean;
}

// What the Ask AI may read beyond the screen (modification #231): the
// summarised data of the workbooks uploaded to the portal. Never customers,
// sales people or individual lines. Each part needs the same permission the
// Finance pages need.
export async function buildWorkbookSnapshot(pool: Pool, access: WorkbookAccess) {
  const client = await pool.connect();
  try {
    const out: Record<string, unknown> = {};
    const revenueBatch = await findActiveBatch(client, 'revenue');
    if (access.revenue) {
      if (!revenueBatch) out.revenueWorkbook = { uploaded: false };
      else {
        const none = {} as RevenueFilters;
        const summary = await revenueSummary(client, revenueBatch.id, none);
        const byDimension: Record<string, unknown> = {};
        for (const dimension of [
          'period',
          'jobType',
          'channel',
          'costStatus',
          'jobStatus',
        ] as const) {
          const rows = (await revenueGroup(client, revenueBatch.id, none, dimension, 60)).rows;
          byDimension[dimension] =
            dimension === 'period' ? rows.sort((x, y) => x.key.localeCompare(y.key)) : rows;
        }
        // Day by day for the latest 45 days of the workbook, by job type, so questions like
        // "how many CSIDI lines on 10 November?" can be answered. Counts and amounts only:
        // no customers, sales people, invoice or order numbers.
        const daily = await client.query<{
          day: string;
          job_type: string;
          lines: string;
          invoices: string;
          qty: string;
          revenue: string;
        }>(
          `SELECT to_char(order_date, 'YYYY-MM-DD') AS day, job_type,
                  COUNT(*) AS lines, COUNT(DISTINCT inv_del_no) AS invoices,
                  COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(revenue), 0) AS revenue
             FROM revenue_lines
            WHERE batch_id = $1 AND order_date IS NOT NULL
              AND order_date >= (SELECT max(order_date) FROM revenue_lines WHERE batch_id = $1) - 45
            GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 600`,
          [revenueBatch.id],
        );
        out.revenueWorkbook = {
          uploaded: true,
          source: revenueBatch.fileName ?? undefined,
          totals: summary.totals,
          groupedBy: byDimension,
          dailyByJobType: {
            note: 'Latest 45 days of the workbook by order date and job type. "lines" are workbook rows (the "jobs" counts elsewhere are rows too), "invoices" are distinct invoice/delivery numbers, qty is units, revenue is AED. CSIJO/CSIJW = repair jobs, CSIDI = delivery + installation lines, CSIDO = delivery only, CSIII = installation only.',
            rows: daily.rows.map((r) => ({
              date: r.day,
              jobType: r.job_type,
              lines: Number(r.lines),
              invoices: Number(r.invoices),
              qty: Number(r.qty),
              revenue: Number(r.revenue),
            })),
          },
        };
      }
    }
    if (access.budget) {
      const budgetBatch = await findActiveBatch(client, 'budget');
      if (!budgetBatch) out.budgetWorkbook = { uploaded: false };
      else {
        const data = await budgetVsActual(client, budgetBatch.id, revenueBatch?.id ?? null);
        const lines = new Map<
          string,
          { section: string; lineItem: string; total: number; byPeriod: Record<string, number> }
        >();
        for (const row of data.budget) {
          const key = row.section + '|' + row.lineItem;
          const line = lines.get(key) ?? {
            section: row.section,
            lineItem: row.lineItem,
            total: 0,
            byPeriod: {},
          };
          const amount = Number(row.amount) || 0;
          line.total += amount;
          line.byPeriod[row.period] = (line.byPeriod[row.period] ?? 0) + amount;
          lines.set(key, line);
        }
        out.budgetWorkbook = {
          uploaded: true,
          source: budgetBatch.fileName ?? undefined,
          budgetLines: Array.from(lines.values()),
          actualRevenueByPeriod: data.actual.map((a) => ({
            period: a.period,
            revenue: Number(a.revenue) || 0,
            qty: Number(a.qty) || 0,
          })),
        };
      }
    }
    return out;
  } finally {
    client.release();
  }
}
