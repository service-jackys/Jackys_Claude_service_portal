import type { PoolClient } from 'pg';

// Kanban board for the dashboard: every appointment and service job card that
// is still moving through the service pipeline, one card per case, with its
// turnaround time (TAT) counted in Dubai calendar days from when the complaint
// was logged (else walk-in intake / booking date) -- the same definition the
// reports use. Thresholds are settings, not code (revenue_settings keys
// tat_target_days and tat_late_days).

export const BOARD_COLUMNS = [
  { key: 'scheduled', label: 'Scheduled', hint: 'Appointment booked' },
  { key: 'on_site', label: 'In progress on site', hint: 'Appointment in progress' },
  {
    key: 'awaiting_job_card',
    label: 'Awaiting job card',
    hint: 'Appointment completed, no job card yet',
  },
  { key: 'jc_open', label: 'Job card open', hint: 'Job card opened, work not started' },
  { key: 'jc_progress', label: 'Job card in progress', hint: 'Work under way' },
  { key: 'done', label: 'Completed (14 days)', hint: 'Job cards completed in the last 14 days' },
] as const;

export type BoardCard = {
  kind: 'appointment' | 'job_card';
  id: string;
  reference: string;
  column: string;
  customerName: string | null;
  item: string | null;
  customerType: string | null;
  warranty: string | null;
  technician: string | null;
  dueDate: string | null;
  ageDays: number;
  source: string | null;
  tat: 'on_track' | 'at_risk' | 'late';
};

export type BoardData = {
  thresholds: { target: number; late: number };
  columns: {
    key: string;
    label: string;
    hint: string;
    count: number;
    avgDays: number | null;
    late: number;
    cards: BoardCard[];
  }[];
  stats: {
    open: number;
    late: number;
    atRisk: number;
    avgTatDays: number | null;
    onTimePercent: number | null;
    completed30: number;
  };
};

const DAY = (expr: string) => `timezone('Asia/Dubai', ${expr})::date`;
const PER_COLUMN_LIMIT = 60;

async function thresholds(client: PoolClient) {
  const result = await client.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM revenue_settings WHERE key IN ('tat_target_days', 'tat_late_days')`,
  );
  const map = Object.fromEntries(result.rows.map((r) => [r.key, Number(r.value)]));
  const target = Number.isFinite(map.tat_target_days) ? map.tat_target_days! : 3;
  const late = Number.isFinite(map.tat_late_days) ? map.tat_late_days! : 5;
  return { target, late };
}

export async function getDashboardBoard(client: PoolClient): Promise<BoardData> {
  const limits = await thresholds(client);
  const rows = await client.query<{
    kind: 'appointment' | 'job_card';
    id: string;
    reference: string;
    col: string;
    customerName: string | null;
    item: string | null;
    customerType: string | null;
    warranty: string | null;
    technician: string | null;
    dueDate: string | null;
    ageDays: number;
    source: string | null;
  }>(
    `WITH appt AS (
       SELECT 'appointment'::text AS kind, a.id::text AS id, a.appointment_reference AS reference,
              CASE a.status WHEN 'Scheduled' THEN 'scheduled' WHEN 'In Progress' THEN 'on_site'
                ELSE 'awaiting_job_card' END AS col,
              a.customer_name AS "customerName",
              NULLIF(trim(concat_ws(' ', a.brand, a.model)), '') AS item,
              a.customer_type AS "customerType", a.job_warranty AS warranty,
              tech.name AS technician, a.appointment_date::text AS "dueDate",
              (${DAY('now()')} - ${DAY('COALESCE(c.submitted_at, a.created_at)')})::int AS "ageDays",
              NULL::text AS source
       FROM appointments a
       LEFT JOIN complaints c ON c.id = a.complaint_id
       LEFT JOIN technicians tech ON tech.id = a.technician_id
       WHERE a.status IN ('Scheduled', 'In Progress')
          OR (a.status = 'Completed'
              AND NOT EXISTS (SELECT 1 FROM service_job_cards j WHERE j.appointment_id = a.id))
     ), jc AS (
       SELECT 'job_card'::text, j.id::text, j.job_card_reference,
              CASE j.status WHEN 'Open' THEN 'jc_open' WHEN 'In Progress' THEN 'jc_progress'
                ELSE 'done' END,
              j.customer_name,
              COALESCE(NULLIF(j.item_description, ''),
                       NULLIF(trim(concat_ws(' ', j.brand, j.model_no)), '')),
              COALESCE(j.customer_type, a.customer_type), j.warranty_status,
              j.technician_name, j.delivery_date::text,
              ((CASE WHEN j.finalized_at IS NOT NULL THEN ${DAY('j.finalized_at')} ELSE ${DAY('now()')} END)
                - COALESCE(${DAY('c.submitted_at')}, ${DAY('j.intake_at')}, j.job_card_date,
                           ${DAY('j.created_at')}))::int,
              j.source_type
       FROM service_job_cards j
       LEFT JOIN appointments a ON a.id = j.appointment_id
       LEFT JOIN complaints c ON c.id = a.complaint_id
       WHERE j.status IN ('Open', 'In Progress')
          OR (j.status = 'Completed' AND j.finalized_at >= now() - interval '14 days')
     )
     SELECT * FROM appt UNION ALL SELECT * FROM jc
     ORDER BY "ageDays" DESC, reference`,
  );
  const tatOf = (days: number): BoardCard['tat'] =>
    days >= limits.late ? 'late' : days > limits.target ? 'at_risk' : 'on_track';
  const columns = BOARD_COLUMNS.map((def) => {
    const all = rows.rows.filter((r) => r.col === def.key);
    const cards: BoardCard[] = all.slice(0, PER_COLUMN_LIMIT).map((r) => ({
      kind: r.kind,
      id: r.id,
      reference: r.reference,
      column: r.col,
      customerName: r.customerName,
      item: r.item,
      customerType: r.customerType,
      warranty: r.warranty,
      technician: r.technician,
      dueDate: r.dueDate,
      ageDays: r.ageDays,
      source: r.source,
      tat:
        def.key === 'done' ? (r.ageDays > limits.target ? 'late' : 'on_track') : tatOf(r.ageDays),
    }));
    const days = all.map((r) => r.ageDays);
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      count: all.length,
      avgDays: days.length
        ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
        : null,
      late: def.key === 'done' ? 0 : all.filter((r) => tatOf(r.ageDays) === 'late').length,
      cards,
    };
  });
  const openColumns = columns.filter((c) => c.key !== 'done');
  const completed = await client.query<{ n: string; avg: string | null; ontime: string }>(
    `SELECT count(*)::text AS n,
            avg(t.days)::text AS avg,
            count(*) FILTER (WHERE t.days <= $1)::text AS ontime
     FROM (
       SELECT (${DAY('j.finalized_at')} - COALESCE(${DAY('c.submitted_at')}, ${DAY('j.intake_at')},
                j.job_card_date, ${DAY('j.created_at')}))::int AS days
       FROM service_job_cards j
       LEFT JOIN appointments a ON a.id = j.appointment_id
       LEFT JOIN complaints c ON c.id = a.complaint_id
       WHERE j.status = 'Completed' AND j.finalized_at >= now() - interval '30 days'
     ) t`,
    [limits.target],
  );
  const n = Number(completed.rows[0]!.n);
  return {
    thresholds: limits,
    columns,
    stats: {
      open: openColumns.reduce((t, c) => t + c.count, 0),
      late: openColumns.reduce((t, c) => t + c.late, 0),
      atRisk: rows.rows.filter((r) => r.col !== 'done' && tatOf(r.ageDays) === 'at_risk').length,
      avgTatDays: completed.rows[0]!.avg
        ? Math.round(Number(completed.rows[0]!.avg) * 10) / 10
        : null,
      onTimePercent: n ? Math.round((Number(completed.rows[0]!.ontime) / n) * 100) : null,
      completed30: n,
    },
  };
}
