import type { PoolClient } from 'pg';

export type ThomsonSaleLineItem = {
  region: string;
  applianceName: string;
  qty: number;
  siteVisits: number;
  trainingSessions: number;
  unitRate: number;
  applianceSubtotal: number;
  addonRevenue: number;
  transportCost: number;
  totalPrice: number;
  totalCost: number;
  margin: number;
};

export type ThomsonSaleSchedule = Record<string, unknown>;

export type ThomsonSaleRecord = {
  id: string;
  thomsonSaleReference: string;
  saleDate: string | null;
  clientName: string | null;
  contactNumber: string | null;
  siteLocation: string | null;
  transportSharePercent: string;
  lineItems: ThomsonSaleLineItem[];
  totalPrice: string;
  totalCost: string;
  margin: string;
  contractRef: string | null;
  schedule: ThomsonSaleSchedule | null;
  status: 'Quote' | 'Sold' | 'Lost';
  soldDate: string | null;
  lostReason: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type ThomsonSaleContent = {
  saleDate: string | null;
  clientName: string | null;
  contactNumber: string | null;
  siteLocation: string | null;
  transportSharePercent: number;
  lineItems: ThomsonSaleLineItem[];
  totalPrice: number;
  totalCost: number;
  margin: number;
  contractRef: string | null;
  schedule: ThomsonSaleSchedule | null;
};

const columns = `
  id,
  thomson_sale_reference AS "thomsonSaleReference",
  sale_date::text AS "saleDate",
  client_name AS "clientName",
  contact_number AS "contactNumber",
  site_location AS "siteLocation",
  transport_share_percent AS "transportSharePercent",
  line_items AS "lineItems",
  total_price AS "totalPrice",
  total_cost AS "totalCost",
  margin,
  contract_ref AS "contractRef",
  schedule,
  status,
  sold_date::text AS "soldDate",
  lost_reason AS "lostReason",
  status_changed_at AS "statusChangedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertThomsonSale(
  client: PoolClient,
  input: { thomsonSaleReference: string; createdBy: string; content: ThomsonSaleContent },
): Promise<ThomsonSaleRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO thomson_sales (
       thomson_sale_reference, sale_date, client_name, contact_number,
       site_location, transport_share_percent, line_items, total_price,
       total_cost, margin, contract_ref, created_by, updated_by, schedule
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7::jsonb, $8,
       $9, $10, $11, $12, $12, $13::jsonb
     )
     RETURNING id`,
    [
      input.thomsonSaleReference,
      c.saleDate,
      c.clientName,
      c.contactNumber,
      c.siteLocation,
      c.transportSharePercent,
      JSON.stringify(c.lineItems),
      c.totalPrice,
      c.totalCost,
      c.margin,
      c.contractRef,
      input.createdBy,
      c.schedule ? JSON.stringify(c.schedule) : null,
    ],
  );
  const thomsonSale = await findThomsonSaleById(client, result.rows[0].id);
  if (!thomsonSale) throw new Error('The created Thomson sale could not be loaded.');
  return thomsonSale;
}

export async function findThomsonSaleById(
  client: PoolClient,
  id: string,
): Promise<ThomsonSaleRecord | null> {
  const result = await client.query<ThomsonSaleRecord>(
    `SELECT ${columns} FROM thomson_sales WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listThomsonSales(
  client: PoolClient,
  query: { search?: string; status?: string; page: number; pageSize: number },
) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.search) {
    const parameter = add(`%${query.search}%`);
    filters.push(
      `(thomson_sale_reference ILIKE ${parameter} OR client_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR contract_ref ILIKE ${parameter})`,
    );
  }
  if (query.status) filters.push(`status = ${add(query.status)}`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM thomson_sales ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<ThomsonSaleRecord>(
    `SELECT ${columns} FROM thomson_sales ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}

export type ThomsonSaleStatusChange =
  | { status: 'Sold'; soldDate: string }
  | { status: 'Lost'; reason: string | null }
  | { status: 'Quote' };

export async function changeThomsonSaleStatus(
  client: PoolClient,
  id: string,
  change: ThomsonSaleStatusChange,
  profileId: string,
): Promise<ThomsonSaleRecord | null> {
  const current = await findThomsonSaleById(client, id);
  if (!current) return null;
  await client.query(
    `UPDATE thomson_sales
     SET status = $2,
         sold_date = $3::date,
         lost_reason = $4,
         status_changed_at = now(),
         status_changed_by = $5,
         updated_at = now(),
         updated_by = $5
     WHERE id = $1`,
    [
      id,
      change.status,
      change.status === 'Sold' ? change.soldDate : null,
      change.status === 'Lost' ? change.reason : null,
      profileId,
    ],
  );
  return findThomsonSaleById(client, id);
}
