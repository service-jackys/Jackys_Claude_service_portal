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
        // Day by day by job type (latest 240 dates of the workbook), so questions like
        // "how many CSIDI lines on 10 November?" can be answered. Counts and amounts only:
        // no customers, sales people, invoice or order numbers. Kept as an object keyed by date
        // (not a list) because the request cleaner keeps only the first 60 items of any list.
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
              AND order_date >= COALESCE((
                SELECT min(d) FROM (
                  SELECT DISTINCT order_date AS d FROM revenue_lines
                   WHERE batch_id = $1 AND order_date IS NOT NULL
                   ORDER BY d DESC LIMIT 240) latest), '1900-01-01')
            GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
          [revenueBatch.id],
        );
        const byDate: Record<string, Record<string, number[]>> = {};
        for (const r of daily.rows) {
          (byDate[r.day] ??= {})[r.job_type] = [
            Number(r.lines),
            Number(r.invoices),
            Number(r.qty),
            Math.round(Number(r.revenue) * 100) / 100,
          ];
        }
        out.revenueWorkbook = {
          uploaded: true,
          source: revenueBatch.fileName ?? undefined,
          totals: summary.totals,
          groupedBy: byDimension,
          dailyByJobType: {
            note: 'Latest 240 order dates of the workbook. Each date lists job types as [lines, invoices, units, revenue AED]. "lines" are workbook rows (what the dashboard calls jobs), "invoices" are distinct invoice/delivery numbers. CSIJO/CSIJW = repair jobs, CSIDI = delivery + installation lines, CSIDO = delivery only, CSIII = installation only. A date that is missing had no lines or is older than this table.',
            byDate,
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
