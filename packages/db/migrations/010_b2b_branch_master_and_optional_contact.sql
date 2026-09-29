-- Modification #1 (see modification.md): B2B Branch / School master list on
-- the public customer complaint form, plus making the contact number
-- optional for a B2B/B2B-SalesChannel submission (a corporate account
-- rarely has one relevant mobile number to collect on a public form; site
-- contact person/number already cover that case).
--
-- The master list is seeded from the last 365 days of sales invoice data
-- (Cust_Code, Customer, Salesman, Inv/Del No) via
-- scripts/import-b2b-branches.mjs and packages/db/seed/b2b_branches.json --
-- run that script after this migration to populate the table.

CREATE TABLE b2b_branches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cust_code text NOT NULL UNIQUE,
  branch_name text NOT NULL,
  salesman text,
  last_sales_order_number text,
  last_invoice_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX b2b_branches_name_idx ON b2b_branches (branch_name);

-- Linked from a complaint (and, once an appointment/job card is created
-- from it, carried forward the same way b2b_branch_school already is) when
-- the customer picked a recognized branch from the form's autocomplete.
-- Free text with no match leaves this null -- staff identify and link the
-- branch later.
ALTER TABLE complaints ADD COLUMN b2b_branch_cust_code text
  REFERENCES b2b_branches (cust_code) ON DELETE SET NULL;
CREATE INDEX complaints_b2b_branch_cust_code_idx ON complaints (b2b_branch_cust_code)
  WHERE b2b_branch_cust_code IS NOT NULL;

-- A B2B/B2B-SalesChannel complaint may now be submitted with no contact
-- number at all (see packages/contracts/src/index.ts, publicComplaintSchema).
-- The existing complaints_contact_check / appointments_contact_check CHECK
-- constraints only run against non-null values, so they still apply
-- correctly once a number is provided -- nothing to change there.
ALTER TABLE complaints ALTER COLUMN contact_number DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN contact_number DROP NOT NULL;
