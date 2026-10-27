import type { PoolClient } from 'pg';

// The B2B customer master (table b2b_branches): uploaded as Excel by an admin,
// the same way as the stock master. One row per customer code.

type Queryable = Pick<PoolClient, 'query'>;

/** One customer row of the upload (the file's columns). */
export type B2bCustomer = {
  custCode: string;
  customerName: string;
  salesman: string | null;
  salesChannel: string | null;
  lastSalesOrderNumber: string | null;
  /** YYYY-MM-DD */
  lastInvoiceDate: string | null;
};

export type B2bCustomerChange = {
  custCode: string;
  fields: { field: string; from: string | null; to: string | null }[];
};

export type B2bUploadSummary = {
  id: string;
  fileName: string;
  rowCount: number;
  customerCount: number;
  newCustomers: number;
  changedCustomers: number;
  report: Record<string, unknown>;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: Date;
  hasFile: boolean;
};

const customerColumns = `
  cust_code AS "custCode",
  branch_name AS "customerName",
  salesman,
  sales_channel AS "salesChannel",
  last_sales_order_number AS "lastSalesOrderNumber",
  to_char(last_invoice_date, 'YYYY-MM-DD') AS "lastInvoiceDate"
`;

const FIELDS: { key: keyof B2bCustomer; label: string }[] = [
  { key: 'customerName', label: 'Customer' },
  { key: 'salesman', label: 'Salesman' },
  { key: 'salesChannel', label: 'Sales channel' },
  { key: 'lastSalesOrderNumber', label: 'Last sales order no' },
  { key: 'lastInvoiceDate', label: 'Last invoice date' },
];

const CHUNK = 500;

export type ReplaceB2bResult = {
  uploadId: string;
  newCustomers: number;
  changedCustomers: number;
  unchangedCustomers: number;
  changes: B2bCustomerChange[];
};

/**
 * Fold an uploaded customer list into the master: new customer codes are added,
 * known ones are updated to what the file says. A blank cell in the file keeps
 * the value already stored (so a column the file does not carry never wipes
 * data). Customers that are not in the file are kept; they simply stop being
 * refreshed ("not in the latest file").
 */
export async function upsertB2bCustomers(
  client: PoolClient,
  input: {
    fileName: string;
    fileSha256: string;
    rowCount: number;
    customers: Map<string, B2bCustomer>;
    uploadedBy: string | null;
  },
): Promise<ReplaceB2bResult> {
  const upload = await client.query<{ id: string }>(
    `INSERT INTO b2b_uploads (file_name, file_sha256, row_count, customer_count, uploaded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [input.fileName, input.fileSha256, input.rowCount, input.customers.size, input.uploadedBy],
  );
  const uploadId = upload.rows[0].id;

  const entries = [...input.customers.entries()];
  let newCustomers = 0;
  let changedCustomers = 0;
  let unchangedCustomers = 0;
  const changes: B2bCustomerChange[] = [];

  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const found = await client.query<B2bCustomer>(
      `SELECT ${customerColumns} FROM b2b_branches WHERE upper(btrim(cust_code)) = ANY($1::text[])`,
      [chunk.map(([upper]) => upper)],
    );
    const existing = new Map<string, B2bCustomer>();
    for (const row of found.rows) existing.set(row.custCode.trim().toUpperCase(), row);

    const codes: string[] = [];
    const names: string[] = [];
    const salesmen: (string | null)[] = [];
    const channels: (string | null)[] = [];
    const orders: (string | null)[] = [];
    const dates: (string | null)[] = [];
    for (const [upper, customer] of chunk) {
      const before = existing.get(upper);
      // Blank in the file keeps what is stored.
      const merged: B2bCustomer = {
        custCode: before?.custCode ?? customer.custCode,
        customerName: customer.customerName,
        salesman: customer.salesman ?? before?.salesman ?? null,
        salesChannel: customer.salesChannel ?? before?.salesChannel ?? null,
        lastSalesOrderNumber: customer.lastSalesOrderNumber ?? before?.lastSalesOrderNumber ?? null,
        lastInvoiceDate: customer.lastInvoiceDate ?? before?.lastInvoiceDate ?? null,
      };
      if (!before) {
        newCustomers += 1;
      } else {
        const fields = FIELDS.filter(
          ({ key }) => (before[key] ?? null) !== (merged[key] ?? null),
        ).map(({ key, label }) => ({
          field: label,
          from: before[key] ?? null,
          to: merged[key] ?? null,
        }));
        if (fields.length === 0) {
          unchangedCustomers += 1;
        } else {
          changedCustomers += 1;
          changes.push({ custCode: before.custCode, fields });
        }
      }
      codes.push(merged.custCode);
      names.push(merged.customerName);
      salesmen.push(merged.salesman);
      channels.push(merged.salesChannel);
      orders.push(merged.lastSalesOrderNumber);
      dates.push(merged.lastInvoiceDate);
    }
    await client.query(
      `INSERT INTO b2b_branches (cust_code, branch_name, salesman, sales_channel,
                                 last_sales_order_number, last_invoice_date, last_seen_at)
       SELECT code, name, salesman, channel, ord, dt::date, now()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
              AS t(code, name, salesman, channel, ord, dt)
       ON CONFLICT (cust_code) DO UPDATE SET
         branch_name = EXCLUDED.branch_name,
         salesman = EXCLUDED.salesman,
         sales_channel = EXCLUDED.sales_channel,
         last_sales_order_number = EXCLUDED.last_sales_order_number,
         last_invoice_date = EXCLUDED.last_invoice_date,
         last_seen_at = EXCLUDED.last_seen_at,
         updated_at = CASE
           WHEN (b2b_branches.branch_name, b2b_branches.salesman, b2b_branches.sales_channel,
                 b2b_branches.last_sales_order_number, b2b_branches.last_invoice_date)
                IS NOT DISTINCT FROM
                (EXCLUDED.branch_name, EXCLUDED.salesman, EXCLUDED.sales_channel,
                 EXCLUDED.last_sales_order_number, EXCLUDED.last_invoice_date)
           THEN b2b_branches.updated_at ELSE now() END`,
      [codes, names, salesmen, channels, orders, dates],
    );
  }

  await client.query(
    `UPDATE b2b_uploads SET new_customers = $2, changed_customers = $3 WHERE id = $1::bigint`,
    [uploadId, newCustomers, changedCustomers],
  );
  return { uploadId, newCustomers, changedCustomers, unchangedCustomers, changes };
}

export async function saveB2bUploadReport(
  client: PoolClient,
  uploadId: string,
  report: Record<string, unknown>,
): Promise<void> {
  await client.query(`UPDATE b2b_uploads SET report = $2::jsonb WHERE id = $1::bigint`, [
    uploadId,
    JSON.stringify(report),
  ]);
}

/** Keep the original file of the newest upload only. */
export async function saveB2bUploadFile(
  client: PoolClient,
  uploadId: string,
  bytes: Buffer,
): Promise<void> {
  await client.query(`UPDATE b2b_uploads SET file_bytes = $2 WHERE id = $1::bigint`, [
    uploadId,
    bytes,
  ]);
  await client.query(
    `UPDATE b2b_uploads SET file_bytes = NULL WHERE id <> $1::bigint AND file_bytes IS NOT NULL`,
    [uploadId],
  );
}

export type B2bUploadFile = {
  id: string;
  fileName: string;
  uploadedAt: Date;
  bytes: Buffer | null;
};

export async function latestB2bUploadFile(db: Queryable): Promise<B2bUploadFile | null> {
  const result = await db.query<B2bUploadFile>(
    `SELECT id::text AS id, file_name AS "fileName", uploaded_at AS "uploadedAt", file_bytes AS bytes
       FROM b2b_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export type B2bMasterRow = B2bCustomer & { lastSeenAt: Date; inLatestFile: boolean };

/** The whole customer master, for the rebuilt download. */
export async function b2bMasterRows(db: Queryable): Promise<B2bMasterRow[]> {
  const result = await db.query<B2bMasterRow>(
    `SELECT ${customerColumns}, last_seen_at AS "lastSeenAt",
            last_seen_at >= COALESCE((SELECT max(u.uploaded_at) FROM b2b_uploads u), '-infinity') AS "inLatestFile"
       FROM b2b_branches ORDER BY branch_name, cust_code`,
  );
  return result.rows;
}

export async function b2bStatus(db: Queryable): Promise<{
  lastUpload: B2bUploadSummary | null;
  totalCustomers: number;
  withoutSalesman: number;
  withoutChannel: number;
  notInFileCount: number;
  recentUploads: B2bUploadSummary[];
}> {
  const uploads = await db.query<B2bUploadSummary>(
    `SELECT u.id::text AS id, u.file_name AS "fileName", u.row_count AS "rowCount",
            u.customer_count AS "customerCount", u.new_customers AS "newCustomers",
            u.changed_customers AS "changedCustomers", u.report,
            u.uploaded_by::text AS "uploadedBy", p.display_name AS "uploadedByName",
            u.uploaded_at AS "uploadedAt", (u.file_bytes IS NOT NULL) AS "hasFile"
       FROM b2b_uploads u
       LEFT JOIN profiles p ON p.id = u.uploaded_by
      ORDER BY u.uploaded_at DESC, u.id DESC
      LIMIT 30`,
  );
  const totals = await db.query<{
    total: string;
    noSalesman: string;
    noChannel: string;
    notInFile: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE salesman IS NULL OR btrim(salesman) = '')::text AS "noSalesman",
            count(*) FILTER (WHERE sales_channel IS NULL OR btrim(sales_channel) = '')::text AS "noChannel",
            count(*) FILTER (
              WHERE last_seen_at < (SELECT max(u.uploaded_at) FROM b2b_uploads u)
            )::text AS "notInFile"
       FROM b2b_branches`,
  );
  return {
    lastUpload: uploads.rows[0] ?? null,
    totalCustomers: Number(totals.rows[0]?.total ?? 0),
    withoutSalesman: Number(totals.rows[0]?.noSalesman ?? 0),
    withoutChannel: Number(totals.rows[0]?.noChannel ?? 0),
    notInFileCount: Number(totals.rows[0]?.notInFile ?? 0),
    recentUploads: uploads.rows,
  };
}

/** Lower-cased salesman names / spellings and sales channels the masters know, to check an upload against. */
export async function b2bKnownNames(
  db: Queryable,
): Promise<{ salesmen: Set<string>; channels: Set<string> }> {
  const salesmen = new Set<string>();
  const channels = new Set<string>();
  const s = await db.query<{ name: string }>('SELECT lower(btrim(name)) AS name FROM salesmen');
  for (const row of s.rows) salesmen.add(row.name);
  const a = await db.query<{ name: string }>(
    'SELECT lower(btrim(alias)) AS name FROM salesman_aliases',
  );
  for (const row of a.rows) salesmen.add(row.name);
  const c = await db.query<{ name: string }>(
    'SELECT lower(btrim(name)) AS name FROM sales_channels',
  );
  for (const row of c.rows) channels.add(row.name);
  return { salesmen, channels };
}
