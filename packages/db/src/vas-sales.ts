import type { PoolClient } from 'pg';

export type VasSaleRecord = {
  id: string;
  vasSaleReference: string;
  saleDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  address: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  itemCode: string | null;
  itemDescription: string | null;
  planKey: string;
  vasProduct: string;
  sellingPrice: string;
  planFee: string;
  deductible: string;
  serviceFeeText: string | null;
  contractRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type VasSaleContent = {
  saleDate: string | null;
  customerName: string | null;
  contactNumber: string | null;
  address: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  itemCode: string | null;
  itemDescription: string | null;
  planKey: string;
  vasProduct: string;
  sellingPrice: number;
  planFee: number;
  deductible: number;
  serviceFeeText: string | null;
  contractRef: string | null;
};

const columns = `
  id,
  vas_sale_reference AS "vasSaleReference",
  sale_date::text AS "saleDate",
  customer_name AS "customerName",
  contact_number AS "contactNumber",
  address,
  invoice_number AS "invoiceNumber",
  purchase_date::text AS "purchaseDate",
  item_code AS "itemCode",
  item_description AS "itemDescription",
  plan_key AS "planKey",
  vas_product AS "vasProduct",
  selling_price AS "sellingPrice",
  plan_fee AS "planFee",
  deductible,
  service_fee_text AS "serviceFeeText",
  contract_ref AS "contractRef",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertVasSale(
  client: PoolClient,
  input: { vasSaleReference: string; createdBy: string; content: VasSaleContent },
): Promise<VasSaleRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO vas_sales (
       vas_sale_reference, sale_date, customer_name, contact_number, address,
       invoice_number, purchase_date, item_code, item_description,
       plan_key, vas_product, selling_price, plan_fee, deductible,
       service_fee_text, contract_ref, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16, $17, $17
     )
     RETURNING id`,
    [
      input.vasSaleReference,
      c.saleDate,
      c.customerName,
      c.contactNumber,
      c.address,
      c.invoiceNumber,
      c.purchaseDate,
      c.itemCode,
      c.itemDescription,
      c.planKey,
      c.vasProduct,
      c.sellingPrice,
      c.planFee,
      c.deductible,
      c.serviceFeeText,
      c.contractRef,
      input.createdBy,
    ],
  );
  const vasSale = await findVasSaleById(client, result.rows[0].id);
  if (!vasSale) throw new Error('The created VAS sale could not be loaded.');
  return vasSale;
}

export async function findVasSaleById(
  client: PoolClient,
  id: string,
): Promise<VasSaleRecord | null> {
  const result = await client.query<VasSaleRecord>(
    `SELECT ${columns} FROM vas_sales WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listVasSales(
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
      `(vas_sale_reference ILIKE ${parameter} OR customer_name ILIKE ${parameter} OR contact_number ILIKE ${parameter} OR contract_ref ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM vas_sales ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<VasSaleRecord>(
    `SELECT ${columns} FROM vas_sales ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
