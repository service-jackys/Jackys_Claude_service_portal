import type { PoolClient } from 'pg';

export type RoiTaskRecord = {
  id: string;
  ownerProfileId: string;
  ownerName: string;
  title: string;
  notes: string | null;
  kind: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  percentComplete: number;
  remarks: string | null;
  completedAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RoiTaskWrite = {
  title?: string;
  notes?: string | null;
  kind?: string;
  status?: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  percentComplete?: number;
  remarks?: string | null;
  sortOrder?: number;
  ownerProfileId?: string;
  // Day (YYYY-MM-DD) a completed task was finished; defaults to today.
  completedOn?: string | null;
};

// Dates travel as plain YYYY-MM-DD strings, never as JS Dates, so a Dubai
// calendar day cannot shift by a timezone conversion.
const columns = `
  t.id, t.owner_profile_id AS "ownerProfileId", p.display_name AS "ownerName",
  t.title, t.notes, t.kind, t.status, t.priority,
  to_char(t.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(t.due_date, 'YYYY-MM-DD') AS "dueDate",
  t.percent_complete AS "percentComplete", t.remarks,
  t.completed_at AS "completedAt", t.sort_order AS "sortOrder",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"
`;
const from = `FROM roi_tasks t JOIN profiles p ON p.id = t.owner_profile_id`;

export type RoiTaskFilters = {
  owner: string | null; // null = every user (administrators only)
  status?: string;
  kind?: string;
  priority?: string;
  search?: string;
};

export async function listRoiTasks(
  client: PoolClient,
  filters: RoiTaskFilters,
): Promise<RoiTaskRecord[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.owner) where.push(`t.owner_profile_id = ${add(filters.owner)}`);
  if (filters.status) where.push(`t.status = ${add(filters.status)}`);
  if (filters.kind) where.push(`t.kind = ${add(filters.kind)}`);
  if (filters.priority) where.push(`t.priority = ${add(filters.priority)}`);
  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(t.title ILIKE ${like} OR t.remarks ILIKE ${like} OR t.notes ILIKE ${like})`);
  }
  const result = await client.query<RoiTaskRecord>(
    `SELECT ${columns} ${from}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.sort_order, t.id`,
    values,
  );
  return result.rows;
}

export async function findRoiTask(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<RoiTaskRecord | null> {
  const result = await client.query<RoiTaskRecord>(
    `SELECT ${columns} ${from} WHERE t.id = $1 ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

// Completing a task stamps completed_at and fills it to 100%; reopening a
// finished task clears the stamp so it moves back to the open objectives.
export async function insertRoiTask(
  client: PoolClient,
  ownerProfileId: string,
  input: RoiTaskWrite,
): Promise<string> {
  const status = input.status ?? 'not_started';
  const percent = status === 'completed' ? 100 : (input.percentComplete ?? 0);
  const result = await client.query<{ id: string }>(
    `INSERT INTO roi_tasks (owner_profile_id, title, notes, kind, status, priority, start_date,
                            due_date, percent_complete, remarks, completed_at, sort_order)
     VALUES ($1, $2, $3, COALESCE($4, 'task'), $5, COALESCE($6, 'medium'), $7::date, $8::date, $9,
             $10, CASE WHEN $5 = 'completed' THEN COALESCE($12::date + time '12:00', now()) END,
             COALESCE($11, (SELECT COALESCE(max(sort_order), 0) + 10 FROM roi_tasks
                            WHERE owner_profile_id = $1)))
     RETURNING id`,
    [
      ownerProfileId,
      input.title,
      input.notes ?? null,
      input.kind ?? null,
      status,
      input.priority ?? null,
      input.startDate ?? null,
      input.dueDate ?? null,
      percent,
      input.remarks ?? null,
      input.sortOrder ?? null,
      input.completedOn ?? null,
    ],
  );
  return result.rows[0].id;
}

export async function updateRoiTask(
  client: PoolClient,
  id: string,
  patch: RoiTaskWrite,
  current: RoiTaskRecord,
): Promise<void> {
  const next = { ...patch };
  // Moving the % drives the status: 100 completes, lowering a finished task
  // reopens it, and the first progress on an unstarted task starts it.
  if (next.status === undefined && next.percentComplete !== undefined) {
    if (next.percentComplete >= 100) next.status = 'completed';
    else if (current.status === 'completed') next.status = 'in_progress';
    else if (current.status === 'not_started' && next.percentComplete > 0)
      next.status = 'in_progress';
  }
  const finalStatus = next.status ?? current.status;
  if (finalStatus === 'completed') next.percentComplete = 100;
  const map: Array<[keyof RoiTaskWrite, string, string?]> = [
    ['title', 'title'],
    ['notes', 'notes'],
    ['kind', 'kind'],
    ['status', 'status'],
    ['priority', 'priority'],
    ['startDate', 'start_date', '::date'],
    ['dueDate', 'due_date', '::date'],
    ['percentComplete', 'percent_complete'],
    ['remarks', 'remarks'],
    ['sortOrder', 'sort_order'],
    ['ownerProfileId', 'owner_profile_id'],
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column, cast] of map) {
    if (next[key] === undefined) continue;
    values.push(next[key]);
    sets.push(`${column} = $${values.length}${cast ?? ''}`);
  }
  if (finalStatus === 'completed' && next.completedOn) {
    values.push(next.completedOn);
    sets.push(`completed_at = $${values.length}::date + time '12:00'`);
  } else if (finalStatus === 'completed' && current.status !== 'completed')
    sets.push('completed_at = now()');
  if (finalStatus !== 'completed' && current.status === 'completed')
    sets.push('completed_at = NULL');
  if (!sets.length) return;
  values.push(id);
  await client.query(
    `UPDATE roi_tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteRoiTask(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query('DELETE FROM roi_tasks WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function importRoiTasks(
  client: PoolClient,
  ownerProfileId: string,
  tasks: Array<{
    title: string;
    kind?: string;
    status?: string;
    priority?: string;
    percentComplete?: number;
    remarks?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    completedOn?: string | null;
  }>,
): Promise<number> {
  let added = 0;
  for (const task of tasks) {
    // Skip a title this owner already has, so the import can be re-run safely.
    const dup = await client.query(
      `SELECT 1 FROM roi_tasks WHERE owner_profile_id = $1 AND lower(title) = lower($2) LIMIT 1`,
      [ownerProfileId, task.title],
    );
    if (dup.rowCount) continue;
    const id = await insertRoiTask(client, ownerProfileId, task);
    if (task.completedOn && (task.status ?? 'not_started') === 'completed') {
      await client.query(
        `UPDATE roi_tasks SET completed_at = $2::date + time '12:00' WHERE id = $1`,
        [id, task.completedOn],
      );
    }
    added += 1;
  }
  return added;
}

export type RoiSettings = { toEmails: string[]; ccEmails: string[]; signature: string };

export async function readRoiSettings(
  client: PoolClient,
  profileId: string,
): Promise<RoiSettings | null> {
  const result = await client.query<RoiSettings>(
    `SELECT to_emails AS "toEmails", cc_emails AS "ccEmails", signature
     FROM roi_settings WHERE owner_profile_id = $1`,
    [profileId],
  );
  return result.rows[0] ?? null;
}

export async function saveRoiSettings(
  client: PoolClient,
  profileId: string,
  settings: RoiSettings,
): Promise<void> {
  await client.query(
    `INSERT INTO roi_settings (owner_profile_id, to_emails, cc_emails, signature)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_profile_id) DO UPDATE
       SET to_emails = EXCLUDED.to_emails, cc_emails = EXCLUDED.cc_emails,
           signature = EXCLUDED.signature, updated_at = now()`,
    [profileId, settings.toEmails, settings.ccEmails, settings.signature],
  );
}

export type RoiReportRecord = {
  id: string;
  weekYear: number;
  weekNumber: number;
  weekEnding: string;
  subject: string;
  toEmails: string[];
  ccEmails: string[];
  includesSummary: boolean;
  counts: Record<string, number>;
  source: string;
  createdAt: Date;
};

export async function insertRoiReport(
  client: PoolClient,
  ownerProfileId: string,
  input: {
    weekYear: number;
    weekNumber: number;
    weekEnding: string;
    subject: string;
    toEmails: string[];
    ccEmails: string[];
    includesSummary: boolean;
    counts: Record<string, number>;
    source: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO roi_reports (owner_profile_id, week_year, week_number, week_ending, subject,
                              to_emails, cc_emails, includes_summary, counts, source)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING id`,
    [
      ownerProfileId,
      input.weekYear,
      input.weekNumber,
      input.weekEnding,
      input.subject,
      input.toEmails,
      input.ccEmails,
      input.includesSummary,
      JSON.stringify(input.counts),
      input.source,
    ],
  );
  return result.rows[0].id;
}

export async function listRoiReports(
  client: PoolClient,
  ownerProfileId: string,
  limit = 20,
): Promise<RoiReportRecord[]> {
  const result = await client.query<RoiReportRecord>(
    `SELECT id, week_year AS "weekYear", week_number AS "weekNumber",
            to_char(week_ending, 'YYYY-MM-DD') AS "weekEnding", subject,
            to_emails AS "toEmails", cc_emails AS "ccEmails",
            includes_summary AS "includesSummary", counts, source, created_at AS "createdAt"
     FROM roi_reports WHERE owner_profile_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [ownerProfileId, limit],
  );
  return result.rows;
}

// Owners an administrator can pick from the Tasks tab.
export async function listRoiOwners(
  client: PoolClient,
): Promise<Array<{ id: string; name: string; email: string; tasks: number }>> {
  const result = await client.query(
    `SELECT p.id, p.display_name AS name, p.email,
            (SELECT count(*)::int FROM roi_tasks t WHERE t.owner_profile_id = p.id) AS tasks
     FROM profiles p WHERE p.active ORDER BY p.display_name`,
  );
  return result.rows;
}
