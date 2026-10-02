import type { PoolClient } from 'pg';

export type RateCardSaleLineItem = {
  sectionLabel: string;
  activityName: string;
  rate: number;
  qty: number;
};

export type RateCardSaleRecord = {
  id: string;
  rateCardSaleReference: string;
  saleDate: string | null;
  clientName: string | null;
  contactNumber: string | null;
  siteLocation: string | null;
  lineItems: RateCardSaleLineItem[];
  totalValue: string;
  contractRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type RateCardSaleContent = {
  saleDate: string | null;
  clientName: string | null;
  contactNumber: string | null;
  siteLocation: string | null;
  lineItems: RateCardSaleLineItem[];
  totalValue: number;
  contractRef: string | null;
};

const columns = `
  id,
  rate_card_sale_reference AS "rateCardSaleReference",
  sale_date::text AS "saleDate",
  client_name AS "clientName",
  contact_number AS "contactNumber",
  site_location AS "siteLocation",
  line_items AS "lineItems",
  total_value AS "totalValue",
  contract_ref AS "contractRef",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertRateCardSale(
  client: PoolClient,
  input: { rateCardSaleReference: string; createdBy: string; content: RateCardSaleContent },
): Promise<RateCardSaleRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO rate_card_sales (
       rate_card_sale_reference, sale_date, client_name, contact_number,
       site_location, line_items, total_value, contract_ref,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6::jsonb, $7, $8,
       $9, $9
     )
     RETURNING id`,
    [
      input.rateCardSaleReference,
      c.saleDate,
      c.clientName,
      c.contactNumber,
      c.siteLocation,
      JSON.stringify(c.lineItems),
      c.totalValue,
      c.contractRef,
      input.createdBy,
    ],
  );
  const rateCardSale = await findRateCardSaleById(client, result.rows[0].id);
  if (!rateCardSale) throw new Error('The created Rate Card sale could not be loaded.');
  return rateCardSale;
}

export async function findRateCardSaleById(
  client: PoolClient,
  id: string,
): Promise<RateCardSaleRecord | null> {
  const result = await client.query<RateCardSaleRecord>(
    `SELECT ${columns} FROM rate_card_sales WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listRateCardSales(
  client: PoolClient,
  query: { search?: string; page: number; pageSize: number },
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
      `(rate_card_sale_reference ILIKE ${parameter} OR client_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR contract_ref ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM rate_card_sales ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<RateCardSaleRecord>(
    `SELECT ${columns} FROM rate_card_sales ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
