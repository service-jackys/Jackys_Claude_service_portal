import type { PoolClient } from 'pg';

export type AmcApplianceLine = {
  name: string;
  qty: number;
  price: number;
};

// One of the 3 plans computed for this contract's appliance schedule
// (modification.md #39). The saved record always carries all 3 -- which
// one to print is picked afterwards, per print.
export type AmcPlanComputation = {
  planKey: string;
  planLabel: string;
  coverage: string | null;
  coverageDetail: string | null;
  included: string | null;
  notIncluded: string | null;
  visitsText: string | null;
  annualVisits: number;
  laborCost: number;
  transportCost: number;
  partsReserve: number;
  directCost: number;
  overhead: number;
  priceExclVat: number;
  priceInclVat: number;
};

export type AmcContractRecord = {
  id: string;
  amcContractReference: string;
  contractDate: string | null;
  contractPeriod: string | null;
  clientName: string | null;
  attentionTo: string | null;
  siteLocation: string | null;
  appliances: AmcApplianceLine[];
  totalCount: string;
  totalValue: string;
  plans: AmcPlanComputation[];
  commencementDate: string | null;
  contractRef: string | null;
  status: 'Quote' | 'Sold' | 'Lost';
  soldPlanKey: string | null;
  soldPlanLabel: string | null;
  soldPriceExclVat: string | null;
  soldPriceInclVat: string | null;
  soldDate: string | null;
  soldAt: Date | null;
  lostReason: string | null;
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
  appliances: AmcApplianceLine[];
  totalCount: number;
  totalValue: number;
  plans: AmcPlanComputation[];
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
  appliances,
  total_count AS "totalCount",
  total_value AS "totalValue",
  plans,
  commencement_date::text AS "commencementDate",
  contract_ref AS "contractRef",
  status,
  sold_plan_key AS "soldPlanKey",
  sold_plan_label AS "soldPlanLabel",
  sold_price_excl_vat AS "soldPriceExclVat",
  sold_price_incl_vat AS "soldPriceInclVat",
  sold_date::text AS "soldDate",
  sold_at AS "soldAt",
  lost_reason AS "lostReason",
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
       site_location, appliances, total_count, total_value, plans,
       commencement_date, contract_ref,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7::jsonb, $8, $9, $10::jsonb,
       $11, $12,
       $13, $13
     )
     RETURNING id`,
    [
      input.amcContractReference,
      c.contractDate,
      c.contractPeriod,
      c.clientName,
      c.attentionTo,
      c.siteLocation,
      JSON.stringify(c.appliances),
      c.totalCount,
      c.totalValue,
      JSON.stringify(c.plans),
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
      `(amc_contract_reference ILIKE ${parameter} OR client_name ILIKE ${parameter} OR attention_to ILIKE ${parameter} OR contract_ref ILIKE ${parameter})`,
    );
  }
  if (query.status) {
    filters.push(`status = ${add(query.status)}`);
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

export type AmcStatusChange =
  | { status: 'Sold'; planKey: string; soldDate: string; contractRef: string | null }
  | { status: 'Lost'; reason: string | null }
  | { status: 'Quote' };

// Moves a saved AMC record between Quote, Sold and Lost. Sold copies the
// chosen plan's label and prices out of the stored plans so the sale value is
// fixed at that moment. Returns null when the record does not exist, and
// 'no-plan' when the record has no such plan.
export async function changeAmcContractStatus(
  client: PoolClient,
  id: string,
  change: AmcStatusChange,
  profileId: string,
): Promise<AmcContractRecord | 'no-plan' | null> {
  const current = await findAmcContractById(client, id);
  if (!current) return null;
  if (change.status === 'Sold') {
    const plan = current.plans.find((p) => p.planKey === change.planKey);
    if (!plan) return 'no-plan';
    await client.query(
      `UPDATE amc_contracts
       SET status = 'Sold', sold_plan_key = $2, sold_plan_label = $3,
           sold_price_excl_vat = $4, sold_price_incl_vat = $5, sold_date = $6::date,
           sold_at = now(), sold_by = $7, lost_reason = NULL,
           contract_ref = COALESCE($8, contract_ref),
           updated_at = now(), updated_by = $7
       WHERE id = $1`,
      [
        id,
        plan.planKey,
        plan.planLabel,
        plan.priceExclVat,
        plan.priceInclVat,
        change.soldDate,
        profileId,
        change.contractRef,
      ],
    );
  } else if (change.status === 'Lost') {
    await client.query(
      `UPDATE amc_contracts
       SET status = 'Lost', lost_reason = $2, sold_plan_key = NULL, sold_plan_label = NULL,
           sold_price_excl_vat = NULL, sold_price_incl_vat = NULL, sold_date = NULL,
           sold_at = NULL, sold_by = NULL, updated_at = now(), updated_by = $3
       WHERE id = $1`,
      [id, change.reason, profileId],
    );
  } else {
    await client.query(
      `UPDATE amc_contracts
       SET status = 'Quote', lost_reason = NULL, sold_plan_key = NULL, sold_plan_label = NULL,
           sold_price_excl_vat = NULL, sold_price_incl_vat = NULL, sold_date = NULL,
           sold_at = NULL, sold_by = NULL, updated_at = now(), updated_by = $2
       WHERE id = $1`,
      [id, profileId],
    );
  }
  return findAmcContractById(client, id);
}
