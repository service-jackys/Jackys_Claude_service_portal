import type { PoolClient } from 'pg';
import { findActiveBatch } from './revenue-dashboard.js';

// Role-specific data blocks for the weekly ROI email (modification #298). Every figure is a
// count or a quantity: no AED value is ever read here, so a block cannot expose revenue.
export type RoiBlockTable = {
  title: string;
  head: string[];
  rows: (string | number)[][];
  // Bold last row (for example "Total").
  totalRow?: boolean;
  // Shown instead of the table when there is nothing to show.
  empty?: string;
};
export type RoiBlock = {
  key: 'customer_care' | 'field_ops';
  title: string;
  source: string;
  tables: RoiBlockTable[];
};

const TZ = 'Asia/Dubai';

/** Monday and Sunday (YYYY-MM-DD) of an ISO week. */
export function isoWeekRange(year: number, week: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

const num = (value: unknown) => Number(value ?? 0);
const fmt = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });

type Workbook = { batchId: string; fileName: string; uploadedAt: string } | null;

async function activeWorkbook(client: PoolClient): Promise<Workbook> {
  const batch = await findActiveBatch(client, 'revenue');
  if (!batch) return null;
  return {
    batchId: String(batch.id),
    fileName: batch.fileName || 'workbook',
    uploadedAt: batch.uploadedAt ? new Date(batch.uploadedAt).toISOString().slice(0, 10) : '',
  };
}

/** Quantity pivot: one row per `rowExpr`, one column per job type in `types`. */
async function pivot(
  client: PoolClient,
  workbook: NonNullable<Workbook>,
  year: number,
  week: number,
  rowExpr: string,
  types: string[],
  title: string,
  rowLabel: string,
  emptyText: string,
): Promise<RoiBlockTable> {
  const result = await client.query<{ k: string; job_type: string; qty: string }>(
    `SELECT ${rowExpr} AS k, upper(job_type) AS job_type, COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines
     WHERE batch_id = $1 AND year = $2 AND week_no = $3 AND upper(job_type) = ANY($4::text[])
     GROUP BY 1, 2 ORDER BY 1`,
    [workbook.batchId, year, week, types],
  );
  const rows = new Map<string, Record<string, number>>();
  for (const r of result.rows) {
    const row = rows.get(r.k) ?? {};
    row[r.job_type] = num(r.qty);
    rows.set(r.k, row);
  }
  if (!rows.size) return { title, head: [], rows: [], empty: emptyText };
  const body: (string | number)[][] = [];
  const totals: number[] = types.map(() => 0);
  for (const [key, values] of rows) {
    const cells = types.map((t) => values[t] ?? 0);
    cells.forEach((v, i) => (totals[i] += v));
    body.push([key, ...cells.map((v) => (v ? fmt(v) : '')), fmt(cells.reduce((a, b) => a + b, 0))]);
  }
  body.push([
    'Total',
    ...totals.map((v) => (v ? fmt(v) : '0')),
    fmt(totals.reduce((a, b) => a + b, 0)),
  ]);
  return { title, head: [rowLabel, ...types, 'Total'], rows: body, totalRow: true };
}

async function serviceDashboard(
  client: PoolClient,
  range: { start: string; end: string },
): Promise<RoiBlockTable> {
  const day = (column: string) =>
    `(${column} AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;
  const one = async (sql: string, params: unknown[] = []) =>
    num((await client.query<{ n: string }>(sql, params)).rows[0]?.n);
  const p = [range.start, range.end];
  const [apptCreated, apptDone, jcCreated, jcDone, apptAll, apptDoneAll, jcAll, jcDoneAll, jcOpen] =
    await Promise.all([
      one(`SELECT count(*) AS n FROM appointments WHERE ${day('created_at')}`, p),
      one(
        `SELECT count(*) AS n FROM appointments WHERE status = 'Completed' AND ${day('closed_at')}`,
        p,
      ),
      one(`SELECT count(*) AS n FROM service_job_cards WHERE ${day('created_at')}`, p),
      one(
        `SELECT count(*) AS n FROM service_job_cards WHERE status = 'Completed' AND ${day('finalized_at')}`,
        p,
      ),
      one(`SELECT count(*) AS n FROM appointments`),
      one(`SELECT count(*) AS n FROM appointments WHERE status = 'Completed'`),
      one(`SELECT count(*) AS n FROM service_job_cards`),
      one(`SELECT count(*) AS n FROM service_job_cards WHERE status = 'Completed'`),
      one(`SELECT count(*) AS n FROM service_job_cards WHERE status IN ('Open', 'In Progress')`),
    ]);
  return {
    title: 'Service dashboard',
    head: [
      '',
      'Appointments created',
      'Appointments completed',
      'Job cards created',
      'Job cards completed',
      'Job cards open / WIP',
    ],
    rows: [
      ['This week', apptCreated, apptDone, jcCreated, jcDone, jcOpen],
      ['Overall', apptAll, apptDoneAll, jcAll, jcDoneAll, jcOpen],
    ],
  };
}

async function channelDetail(
  client: PoolClient,
  workbook: NonNullable<Workbook>,
  year: number,
  week: number,
): Promise<RoiBlockTable> {
  const result = await client.query<{ k: string; jobs: string; qty: string }>(
    `SELECT COALESCE(NULLIF(sales_channel, ''), 'UNASSIGNED') AS k, count(*) AS jobs,
            COALESCE(SUM(qty), 0) AS qty
     FROM revenue_lines WHERE batch_id = $1 AND year = $2 AND week_no = $3
     GROUP BY 1 ORDER BY count(*) DESC, 1`,
    [workbook.batchId, year, week],
  );
  const title = 'Channel detail, jobs and quantity';
  if (!result.rows.length)
    return { title, head: [], rows: [], empty: `No workbook rows for week ${week} yet.` };
  const rows: (string | number)[][] = result.rows.map((r) => [r.k, num(r.jobs), fmt(num(r.qty))]);
  rows.push([
    'Total',
    result.rows.reduce((a, r) => a + num(r.jobs), 0),
    fmt(result.rows.reduce((a, r) => a + num(r.qty), 0)),
  ]);
  return { title, head: ['Sales channel', 'Jobs', 'Qty'], rows, totalRow: true };
}

const CHANNEL = `COALESCE(NULLIF(sales_channel, ''), 'UNASSIGNED')`;

export async function customerCareBlock(
  client: PoolClient,
  year: number,
  week: number,
): Promise<RoiBlock> {
  const range = isoWeekRange(year, week);
  const workbook = await activeWorkbook(client);
  const noBook = 'No revenue workbook has been uploaded yet.';
  const none = `No workbook rows for week ${week} yet.`;
  const tables: RoiBlockTable[] = workbook
    ? [
        await pivot(
          client,
          workbook,
          year,
          week,
          `COALESCE(NULLIF(billing_code, ''), 'UNKNOWN')`,
          ['CSIDI', 'CSIJO', 'CSIJW'],
          'By billing code',
          'Billing code',
          none,
        ),
        await pivot(
          client,
          workbook,
          year,
          week,
          CHANNEL,
          ['CSIDI', 'CSIDO', 'CSIII'],
          'Delivery and installation, by sales channel',
          'Sales channel',
          none,
        ),
        await pivot(
          client,
          workbook,
          year,
          week,
          CHANNEL,
          ['CSIJW', 'CSIJO'],
          'Repair services, by sales channel',
          'Sales channel',
          none,
        ),
        await channelDetail(client, workbook, year, week),
      ]
    : [{ title: 'Workbook quantities', head: [], rows: [], empty: noBook }];
  tables.push(await serviceDashboard(client, range));
  return {
    key: 'customer_care',
    title: `Customer care activity, week ${week}`,
    source: workbook
      ? `Service Revenue Dashboard workbook (${workbook.fileName}${workbook.uploadedAt ? ', uploaded ' + workbook.uploadedAt : ''}), quantities only, and portal records`
      : 'Portal records',
    tables,
  };
}

export async function fieldOpsBlock(
  client: PoolClient,
  year: number,
  week: number,
): Promise<RoiBlock> {
  const workbook = await activeWorkbook(client);
  const none = `No workbook rows for week ${week} yet.`;
  const tables: RoiBlockTable[] = workbook
    ? [
        await pivot(
          client,
          workbook,
          year,
          week,
          CHANNEL,
          ['CSIDI', 'CSIDO', 'CSIII'],
          'Deliveries and installations done, by sales channel',
          'Sales channel',
          none,
        ),
        await pivot(
          client,
          workbook,
          year,
          week,
          `'Repairs attended'`,
          ['CSIJW', 'CSIJO'],
          'Repairs attended this week (warranty, out of warranty)',
          '',
          none,
        ),
      ]
    : [
        {
          title: 'Workbook quantities',
          head: [],
          rows: [],
          empty: 'No revenue workbook has been uploaded yet.',
        },
      ];
  const one = async (sql: string) => num((await client.query<{ n: string }>(sql)).rows[0]?.n);
  const [deliverBack, apptOut, apptWar, apptOther, nextWeek] = await Promise.all([
    one(
      `SELECT count(*) AS n FROM service_job_cards WHERE final_status IS NULL AND job_final_status = 'Repair Completed'`,
    ),
    one(
      `SELECT count(*) AS n FROM appointments WHERE status IN ('Scheduled', 'In Progress') AND job_warranty ILIKE '%out%'`,
    ),
    one(
      `SELECT count(*) AS n FROM appointments WHERE status IN ('Scheduled', 'In Progress') AND job_warranty ILIKE '%warr%' AND job_warranty NOT ILIKE '%out%'`,
    ),
    one(
      `SELECT count(*) AS n FROM appointments WHERE status IN ('Scheduled', 'In Progress') AND (job_warranty IS NULL OR job_warranty NOT ILIKE '%warr%')`,
    ),
    one(
      `SELECT count(*) AS n FROM appointments WHERE status = 'Scheduled' AND appointment_date BETWEEN (now() AT TIME ZONE '${TZ}')::date AND (now() AT TIME ZONE '${TZ}')::date + 7`,
    ),
  ]);
  tables.push({
    title: 'Pending, as at today',
    head: [],
    rows: [
      [
        'Service units pending to deliver back to customer (repair completed, not delivered)',
        deliverBack,
      ],
      ['Appointments pending to attend, warranty', apptWar],
      ['Appointments pending to attend, out of warranty', apptOut],
      ['Appointments pending to attend, warranty not stated', apptOther],
      ['Appointments scheduled for the next 7 days', nextWeek],
    ],
  });
  return {
    key: 'field_ops',
    title: `Field operations, week ${week}`,
    source: workbook
      ? `Service Revenue Dashboard workbook (${workbook.fileName}${workbook.uploadedAt ? ', uploaded ' + workbook.uploadedAt : ''}), quantities only, and portal records`
      : 'Portal records',
    tables,
  };
}
