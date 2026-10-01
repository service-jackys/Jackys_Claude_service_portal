import type { PoolClient } from 'pg';

export type AmcApplianceLine = {
  name: string;
  qty: number;
  price: number;
};

export type AmcContractRecord = {
  id: string;
  amcContractReference: string;
  contractDate: string | null;
  contractPeriod: string | null;
  clientName: string | null;
  attentionTo: string | null;
  siteLocation: string | null;
  planKey: string;
  planLabel: string;
  coverage: string | null;
  coverageDetail: string | null;
  visitsText: string | null;
  annualVisits: string;
  appliances: AmcApplianceLine[];
  totalCount: string;
  totalValue: string;
  laborCost: string;
  transportCost: string;
  partsReserve: string;
  directCost: string;
  overhead: string;
  priceExclVat: string;
  priceInclVat: string;
  commencementDate: string | null;
  contractRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type AmcContractContent = {
  contractDate: string | null;
  contractPeriod: string | null;
  clientName: string | null;
  attentionTo: string | null;
  siteLocation: string | null;
  planKey: string;
  planLabel: string;
  coverage: string | null;
  coverageDetail: string | null;
  visitsText: string | null;
  annualVisits: number;
  appliances: AmcApplianceLine[];
  totalCount: number;
  totalValue: number;
  laborCost: number;
  transportCost: number;
  partsReserve: number;
  directCost: number;
  overhead: number;
  priceExclVat: number;
  priceInclVat: number;
  commencementDate: string | null;
  contractRef: string | null;
};

const columns = `
  id,
  amc_contract_reference AS "amcContractReference",
  contract_date::text AS "contractDate",
  contract_period AS "contractPeriod",
  client_name AS "clientName",
  attention_to AS "attentionTo",
  site_location AS "siteLocation",
  plan_key AS "planKey",
  plan_label AS "planLabel",
  coverage,
  coverage_detail AS "coverageDetail",
  visits_text AS "visitsText",
  annual_visits AS "annualVisits",
  appliances,
  total_count AS "totalCount",
  total_value AS "totalValue",
  labor_cost AS "laborCost",
  transport_cost AS "transportCost",
  parts_reserve AS "partsReserve",
  direct_cost AS "directCost",
  overhead,
  price_excl_vat AS "priceExclVat",
  price_incl_vat AS "priceInclVat",
  commencement_date::text AS "commencementDate",
  contract_ref AS "contractRef",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

export async function insertAmcContract(
  client: PoolClient,
  input: { amcContractReference: string; createdBy: string; content: AmcContractContent },
): Promise<AmcContractRecord> {
  const c = input.content;
  const result = await client.query<{ id: string }>(
    `INSERT INTO amc_contracts (
       amc_contract_reference, contract_date, contract_period, client_name, attention_to,
       site_location, plan_key, plan_label, coverage, coverage_detail,
       visits_text, annual_visits, appliances, total_count, total_value,
       labor_cost, transport_cost, parts_reserve, direct_cost, overhead,
       price_excl_vat, price_incl_vat, commencement_date, contract_ref,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13::jsonb, $14, $15,
       $16, $17, $18, $19, $20,
       $21, $22, $23, $24,
       $25, $25
     )
     RETURNING id`,
    [
      input.amcContractReference,
      c.contractDate,
      c.contractPeriod,
      c.clientName,
      c.attentionTo,
      c.siteLocation,
      c.planKey,
      c.planLabel,
      c.coverage,
      c.coverageDetail,
      c.visitsText,
      c.annualVisits,
      JSON.stringify(c.appliances),
      c.totalCount,
      c.totalValue,
      c.laborCost,
      c.transportCost,
      c.partsReserve,
      c.directCost,
      c.overhead,
      c.priceExclVat,
      c.priceInclVat,
      c.commencementDate,
      c.contractRef,
      input.createdBy,
    ],
  );
  const amcContract = await findAmcContractById(client, result.rows[0].id);
  if (!amcContract) throw new Error('The created AMC contract could not be loaded.');
  return amcContract;
}

export async function findAmcContractById(
  client: PoolClient,
  id: string,
): Promise<AmcContractRecord | null> {
  const result = await client.query<AmcContractRecord>(
    `SELECT ${columns} FROM amc_contracts WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listAmcContracts(
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
      `(amc_contract_reference ILIKE ${parameter} OR client_name ILIKE ${parameter} OR attention_to ILIKE ${parameter} OR contract_ref ILIKE ${parameter})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM amc_contracts ${where}`,
    values,
  );
  const limit = add(query.pageSize);
  const offset = add((query.page - 1) * query.pageSize);
  const result = await client.query<AmcContractRecord>(
    `SELECT ${columns} FROM amc_contracts ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { items: result.rows, total: Number(count.rows[0].total) };
}
