import type { PoolClient } from 'pg';

// Delivery & Installation jobs (migration 058). One job = one ERP delivery
// note. Lines carry the item facts as they were when the line was saved; the
// rate columns are filled (frozen) when the job is completed.

export type DiJobStatus = 'Draft' | 'Completed' | 'Cancelled';
export type DiLineType = 'CSIDI' | 'CSIDO' | 'CSIII';

export type DiJobLineRecord = {
  lineNo: number;
  itemCode: string;
  itemDesc: string | null;
  brand: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  qty: number;
  type: DiLineType;
  installable: boolean | null;
  pricingCategory: string | null;
  salesChannel: string | null;
  rateKind: string | null;
  baseRate: number | null;
  discountTier: string | null;
  discountRate: number | null;
  netRate: number | null;
  labour: number | null;
  transport: number | null;
  charge: number | null;
  revenue: number | null;
  rateNote: string | null;
};

export type DiJobRecord = {
  id: string;
  reference: string;
  serviceDate: string;
  status: DiJobStatus;
  custCode: string | null;
  customerName: string | null;
  salesman: string | null;
  salesChannel: string | null;
  region: string;
  deliveryNoteRef: string | null;
  erpInvNo: string | null;
  csoscNo: string | null;
  notes: string | null;
  totalCsidi: number;
  totalCsido: number;
  totalCsiii: number;
  totalRevenue: number;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

const jobColumns = `
  di_jobs.id,
  di_jobs.reference,
  to_char(di_jobs.service_date, 'YYYY-MM-DD') AS "serviceDate",
  di_jobs.status,
  di_jobs.cust_code AS "custCode",
  di_jobs.customer_name AS "customerName",
  di_jobs.salesman,
  di_jobs.sales_channel AS "salesChannel",
  di_jobs.region,
  di_jobs.delivery_note_ref AS "deliveryNoteRef",
  di_jobs.erp_inv_no AS "erpInvNo",
  di_jobs.csosc_no AS "csoscNo",
  di_jobs.notes,
  di_jobs.total_csidi::float8 AS "totalCsidi",
  di_jobs.total_csido::float8 AS "totalCsido",
  di_jobs.total_csiii::float8 AS "totalCsiii",
  di_jobs.total_revenue::float8 AS "totalRevenue",
  di_jobs.completed_at AS "completedAt",
  di_jobs.completed_by AS "completedBy",
  di_jobs.cancelled_at AS "cancelledAt",
  di_jobs.cancelled_by AS "cancelledBy",
  di_jobs.created_at AS "createdAt",
  di_jobs.updated_at AS "updatedAt",
  di_jobs.created_by AS "createdBy",
  di_jobs.updated_by AS "updatedBy"
`;

const lineColumns = `
  line_no AS "lineNo",
  item_code AS "itemCode",
  item_desc AS "itemDesc",
  brand,
  main_group AS "mainGroup",
  group_name AS "groupName",
  sub_group AS "subGroup",
  qty::float8 AS qty,
  txn_type AS type,
  installable,
  pricing_category AS "pricingCategory",
  sales_channel AS "salesChannel",
  rate_kind AS "rateKind",
  base_rate::float8 AS "baseRate",
  discount_tier AS "discountTier",
  discount_rate::float8 AS "discountRate",
  net_rate::float8 AS "netRate",
  labour::float8 AS labour,
  transport::float8 AS transport,
  charge::float8 AS charge,
  revenue::float8 AS revenue,
  rate_note AS "rateNote"
`;

export type DiJobHeaderInput = {
  serviceDate: string;
  custCode: string | null;
  customerName: string | null;
  salesman: string | null;
  salesChannel: string | null;
  region: string;
  deliveryNoteRef: string | null;
  erpInvNo: string | null;
  csoscNo: string | null;
  notes: string | null;
};

export type DiJobLineInput = Pick<
  DiJobLineRecord,
  | 'itemCode'
  | 'itemDesc'
  | 'brand'
  | 'mainGroup'
  | 'groupName'
  | 'subGroup'
  | 'qty'
  | 'type'
  | 'installable'
  | 'pricingCategory'
  | 'salesChannel'
> &
  Partial<
    Pick<
      DiJobLineRecord,
      | 'rateKind'
      | 'baseRate'
      | 'discountTier'
      | 'discountRate'
      | 'netRate'
      | 'labour'
      | 'transport'
      | 'charge'
      | 'revenue'
      | 'rateNote'
    >
  >;

export async function insertDiJob(
  client: PoolClient,
  reference: string,
  input: DiJobHeaderInput,
  profileId: string,
): Promise<DiJobRecord> {
  const result = await client.query<DiJobRecord>(
    `INSERT INTO di_jobs (
       reference, service_date, cust_code, customer_name, salesman, sales_channel, region,
       delivery_note_ref, erp_inv_no, csosc_no, notes, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING ${jobColumns}`,
    [
      reference,
      input.serviceDate,
      input.custCode,
      input.customerName,
      input.salesman,
      input.salesChannel,
      input.region,
      input.deliveryNoteRef,
      input.erpInvNo,
      input.csoscNo,
      input.notes,
      profileId,
    ],
  );
  return result.rows[0]!;
}

export async function updateDiJobHeader(
  client: PoolClient,
  id: string,
  input: DiJobHeaderInput,
  profileId: string,
): Promise<DiJobRecord | null> {
  const result = await client.query<DiJobRecord>(
    `UPDATE di_jobs SET
       service_date = $2, cust_code = $3, customer_name = $4, salesman = $5,
       sales_channel = $6, region = $7, delivery_note_ref = $8, erp_inv_no = $9,
       csosc_no = $10, notes = $11, updated_at = now(), updated_by = $12
     WHERE id = $1
     RETURNING ${jobColumns}`,
    [
      id,
      input.serviceDate,
      input.custCode,
      input.customerName,
      input.salesman,
      input.salesChannel,
      input.region,
      input.deliveryNoteRef,
      input.erpInvNo,
      input.csoscNo,
      input.notes,
      profileId,
    ],
  );
  return result.rows[0] ?? null;
}

/** Replaces every line of a job (lines are small and always saved together). */
export async function replaceDiJobLines(
  client: PoolClient,
  jobId: string,
  lines: DiJobLineInput[],
): Promise<void> {
  await client.query('DELETE FROM di_job_lines WHERE job_id = $1', [jobId]);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await client.query(
      `INSERT INTO di_job_lines (
         job_id, line_no, item_code, item_desc, brand, main_group, group_name, sub_group,
         qty, txn_type, installable, pricing_category, sales_channel,
         rate_kind, base_rate, discount_tier, discount_rate, net_rate,
         labour, transport, charge, revenue, rate_note
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
       )`,
      [
        jobId,
        lineNo,
        line.itemCode,
        line.itemDesc,
        line.brand,
        line.mainGroup,
        line.groupName,
        line.subGroup,
        line.qty,
        line.type,
        line.installable,
        line.pricingCategory,
        line.salesChannel,
        line.rateKind ?? null,
        line.baseRate ?? null,
        line.discountTier ?? null,
        line.discountRate ?? null,
        line.netRate ?? null,
        line.labour ?? null,
        line.transport ?? null,
        line.charge ?? null,
        line.revenue ?? null,
        line.rateNote ?? null,
      ],
    );
  }
}

export async function findDiJob(
  client: PoolClient,
  id: string,
  options: { lock?: boolean } = {},
): Promise<(DiJobRecord & { lines: DiJobLineRecord[] }) | null> {
  const job = await client.query<DiJobRecord>(
    `SELECT ${jobColumns} FROM di_jobs WHERE di_jobs.id = $1${options.lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!job.rows[0]) return null;
  const lines = await client.query<DiJobLineRecord>(
    `SELECT ${lineColumns} FROM di_job_lines WHERE job_id = $1 ORDER BY line_no`,
    [id],
  );
  return { ...job.rows[0], lines: lines.rows };
}

/** Ids of the jobs (any status) whose delivery note or ERP Inv No is this number. */
export async function findDiJobIdsByNote(client: PoolClient, key: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM di_jobs
      WHERE upper(btrim(delivery_note_ref)) = upper(btrim($1))
         OR upper(btrim(erp_inv_no)) = upper(btrim($1))
      ORDER BY service_date, id`,
    [key],
  );
  return result.rows.map((row) => row.id);
}

export type DiJobTotals = {
  totalCsidi: number;
  totalCsido: number;
  totalCsiii: number;
  totalRevenue: number;
};

export async function markDiJobCompleted(
  client: PoolClient,
  id: string,
  totals: DiJobTotals,
  profileId: string,
): Promise<void> {
  await client.query(
    `UPDATE di_jobs SET status = 'Completed', completed_at = now(), completed_by = $2,
            cancelled_at = NULL, cancelled_by = NULL,
            total_csidi = $3, total_csido = $4, total_csiii = $5, total_revenue = $6,
            updated_at = now(), updated_by = $2
     WHERE id = $1`,
    [id, profileId, totals.totalCsidi, totals.totalCsido, totals.totalCsiii, totals.totalRevenue],
  );
}

export async function markDiJobCancelled(
  client: PoolClient,
  id: string,
  profileId: string,
): Promise<void> {
  await client.query(
    `UPDATE di_jobs SET status = 'Cancelled', cancelled_at = now(), cancelled_by = $2,
            updated_at = now(), updated_by = $2
     WHERE id = $1`,
    [id, profileId],
  );
}

/** Back to Draft: the frozen figures are cleared and will be recalculated on the next completion. */
export async function markDiJobReopened(
  client: PoolClient,
  id: string,
  profileId: string,
): Promise<void> {
  await client.query(
    `UPDATE di_jobs SET status = 'Draft', completed_at = NULL, completed_by = NULL,
            cancelled_at = NULL, cancelled_by = NULL,
            total_csidi = 0, total_csido = 0, total_csiii = 0, total_revenue = 0,
            updated_at = now(), updated_by = $2
     WHERE id = $1`,
    [id, profileId],
  );
  await client.query(
    `UPDATE di_job_lines SET rate_kind = NULL, base_rate = NULL, discount_tier = NULL,
            discount_rate = NULL, net_rate = NULL, labour = NULL, transport = NULL,
            charge = NULL, revenue = NULL, rate_note = NULL
     WHERE job_id = $1`,
    [id],
  );
}

export type DiJobListFilters = {
  status?: DiJobStatus;
  from?: string;
  to?: string;
  search?: string;
  page: number;
  pageSize: number;
};

export type DiJobListRow = DiJobRecord & { lineCount: number; totalQty: number };

export async function listDiJobs(
  client: PoolClient,
  filters: DiJobListFilters,
): Promise<{ jobs: DiJobListRow[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.status) where.push(`di_jobs.status = ${add(filters.status)}`);
  if (filters.from) where.push(`di_jobs.service_date >= ${add(filters.from)}`);
  if (filters.to) where.push(`di_jobs.service_date <= ${add(filters.to)}`);
  if (filters.search) {
    const term = add(`%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(
      `(di_jobs.reference ILIKE ${term} ESCAPE '\\' OR di_jobs.customer_name ILIKE ${term} ESCAPE '\\'
        OR di_jobs.delivery_note_ref ILIKE ${term} ESCAPE '\\' OR di_jobs.erp_inv_no ILIKE ${term} ESCAPE '\\'
        OR di_jobs.csosc_no ILIKE ${term} ESCAPE '\\' OR di_jobs.salesman ILIKE ${term} ESCAPE '\\')`,
    );
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM di_jobs ${clause}`,
    values,
  );
  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const rows = await client.query<DiJobListRow>(
    `SELECT ${jobColumns},
            (SELECT count(*)::int FROM di_job_lines l WHERE l.job_id = di_jobs.id) AS "lineCount",
            (SELECT COALESCE(sum(l.qty), 0)::float8 FROM di_job_lines l WHERE l.job_id = di_jobs.id) AS "totalQty"
     FROM di_jobs ${clause}
     ORDER BY di_jobs.service_date DESC, di_jobs.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { jobs: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
}

/** Other jobs (not cancelled) already entered for the same ERP delivery note. A warning only. */
export async function findDuplicateDeliveryNotes(
  client: PoolClient,
  deliveryNoteRef: string,
  excludeId?: string,
): Promise<{ id: string; reference: string; status: DiJobStatus; serviceDate: string }[]> {
  const ref = deliveryNoteRef.trim();
  if (!ref) return [];
  const result = await client.query<{
    id: string;
    reference: string;
    status: DiJobStatus;
    serviceDate: string;
  }>(
    `SELECT id, reference, status, to_char(service_date, 'YYYY-MM-DD') AS "serviceDate"
     FROM di_jobs
     WHERE lower(btrim(delivery_note_ref)) = lower($1)
       AND status <> 'Cancelled'
       AND ($2::bigint IS NULL OR id <> $2::bigint)
     ORDER BY id`,
    [ref, excludeId ?? null],
  );
  return result.rows;
}

export type DiItemHit = {
  itemCode: string;
  itemDesc: string | null;
  brand: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  /** From the category mapping: true / false, or null when the item's group is not linked yet. */
  installable: boolean | null;
  pricingCategory: string | null;
};

/**
 * Item picker for D&I lines. Unlike the repair pickers it keeps 3PL items
 * (kettles and the like are delivered too) and only leaves out vouchers and
 * other charges. Each hit carries the category mapping result so the screen
 * can offer the right activity types.
 */
export async function searchDiItems(
  client: PoolClient,
  query: string,
  limit = 20,
): Promise<DiItemHit[]> {
  const term = query.trim();
  if (!term) return [];
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  const result = await client.query<DiItemHit>(
    `SELECT stock_master.item_code AS "itemCode",
            stock_master.item_desc AS "itemDesc",
            stock_master.brand,
            stock_master.main_group AS "mainGroup",
            stock_master.group_name AS "groupName",
            stock_master.sub_group AS "subGroup",
            category_mappings.installable,
            category_mappings.pricing_category AS "pricingCategory"
     FROM stock_master
     LEFT JOIN category_mappings
       ON category_mappings.active
      AND lower(trim(category_mappings.group_name)) = lower(trim(stock_master.group_name))
     WHERE COALESCE(stock_master.main_group, '') <> 'VOUCHERS & OTHER CHARGES'
       AND (stock_master.item_code ILIKE $2 ESCAPE '\\' OR stock_master.item_desc ILIKE $3 ESCAPE '\\')
     ORDER BY (upper(stock_master.item_code) = upper($1)) DESC,
              (stock_master.item_code ILIKE $2 ESCAPE '\\') DESC,
              stock_master.item_code
     LIMIT $4`,
    [term, `${escaped}%`, `%${escaped}%`, limit],
  );
  return result.rows;
}

export async function findDiItem(client: PoolClient, itemCode: string): Promise<DiItemHit | null> {
  const result = await client.query<DiItemHit>(
    `SELECT stock_master.item_code AS "itemCode",
            stock_master.item_desc AS "itemDesc",
            stock_master.brand,
            stock_master.main_group AS "mainGroup",
            stock_master.group_name AS "groupName",
            stock_master.sub_group AS "subGroup",
            category_mappings.installable,
            category_mappings.pricing_category AS "pricingCategory"
     FROM stock_master
     LEFT JOIN category_mappings
       ON category_mappings.active
      AND lower(trim(category_mappings.group_name)) = lower(trim(stock_master.group_name))
     WHERE lower(stock_master.item_code) = lower($1)
     LIMIT 1`,
    [itemCode.trim()],
  );
  return result.rows[0] ?? null;
}
