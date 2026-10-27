import type { PoolClient } from 'pg';

// Admin-managed rules deciding which sales channel is billed for a job (see
// migrations/034_job_billing.sql). A rule matches when the job's salesman
// equals the rule's salesman (blank = any) and the B2B branch / school name
// contains the rule's keyword (blank = any), and the item brand is (or is not)
// the rule's brand (blank = any). The most specific matching rule wins (most
// conditions filled in), oldest first when equally specific.
export type BillingRuleRecord = {
  id: string;
  salesman: string | null;
  branchKeyword: string | null;
  brand: string | null;
  brandMatch: 'is' | 'is_not';
  billToChannel: string;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const columns = `
  billing_rules.id,
  billing_rules.salesman,
  billing_rules.branch_keyword AS "branchKeyword",
  billing_rules.brand,
  billing_rules.brand_match AS "brandMatch",
  billing_rules.bill_to_channel AS "billToChannel",
  billing_rules.active,
  billing_rules.notes,
  billing_rules.created_at AS "createdAt",
  billing_rules.updated_at AS "updatedAt"
`;

export async function listBillingRules(client: PoolClient): Promise<BillingRuleRecord[]> {
  const result = await client.query<BillingRuleRecord>(
    `SELECT ${columns} FROM billing_rules ORDER BY billing_rules.id ASC`,
  );
  return result.rows;
}

export async function listActiveBillingRules(client: PoolClient): Promise<BillingRuleRecord[]> {
  const result = await client.query<BillingRuleRecord>(
    `SELECT ${columns} FROM billing_rules WHERE billing_rules.active ORDER BY billing_rules.id ASC`,
  );
  return result.rows;
}

export type BillingRuleInput = {
  salesman?: string | null;
  branchKeyword?: string | null;
  brand?: string | null;
  brandMatch?: 'is' | 'is_not';
  billToChannel: string;
  active?: boolean;
  notes?: string | null;
};

export async function insertBillingRule(
  client: PoolClient,
  input: BillingRuleInput,
): Promise<BillingRuleRecord> {
  const result = await client.query<BillingRuleRecord>(
    `INSERT INTO billing_rules (salesman, branch_keyword, bill_to_channel, active, notes, brand, brand_match)
     VALUES ($1, $2, $3, COALESCE($4, true), $5, $6, COALESCE($7, 'is'))
     RETURNING ${columns}`,
    [
      input.salesman ?? null,
      input.branchKeyword ?? null,
      input.billToChannel,
      input.active ?? null,
      input.notes ?? null,
      input.brand ?? null,
      input.brandMatch ?? null,
    ],
  );
  return result.rows[0];
}

export async function updateBillingRule(
  client: PoolClient,
  id: string,
  input: BillingRuleInput,
): Promise<BillingRuleRecord | null> {
  const result = await client.query<BillingRuleRecord>(
    `UPDATE billing_rules
     SET salesman = $2, branch_keyword = $3, bill_to_channel = $4,
         active = COALESCE($5, active), notes = $6, brand = $7,
         brand_match = COALESCE($8, brand_match), updated_at = now()
     WHERE id = $1
     RETURNING ${columns}`,
    [
      id,
      input.salesman ?? null,
      input.branchKeyword ?? null,
      input.billToChannel,
      input.active ?? null,
      input.notes ?? null,
      input.brand ?? null,
      input.brandMatch ?? null,
    ],
  );
  return result.rows[0] ?? null;
}
