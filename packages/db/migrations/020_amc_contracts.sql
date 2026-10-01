-- Modification #38 (modification.md): "Issue an AMC Contract — Customer
-- Certificate" (docs/code.gs HEADERS_BY_TYPE['amc-contract'] / docs/
-- index_sep_15.html's AMC Contract tab). An AMC contract is a normalized
-- record of one of the 3 AMC plans (Basic RM / Standard PMC / Premium PMC)
-- actually sold against a specific appliance schedule -- it is what the
-- printed contract certificate is generated from, and what a certificate
-- can be reprinted from later. Mirrors the vas_sales table's shape
-- (019_vas_sales.sql) as closely as the domain allows.
--
-- Unlike VAS (one item, one plan, one price), an AMC contract covers a
-- whole appliance schedule (N appliances, each with its own qty/unit
-- value) priced as a single contract total -- so appliances is a JSONB
-- array ([{name, qty, price}, ...]) rather than flat columns, matching how
-- the AMC Quote Calculator (modification.md #32) already represents them
-- client-side.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale', 'amc_contract'));

CREATE TABLE amc_contracts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amc_contract_reference text NOT NULL UNIQUE,
  contract_date date,
  contract_period text,
  client_name text,
  attention_to text,
  site_location text,
  -- 'basic-rm' / 'standard-pmc' / 'premium-pmc' -- matches the plan keys
  -- the AMC Quote Calculator computes (apps/web/src/app.js renderAmcCalc)
  -- so the certificate's plan-specific coverage text (AMC_CONTRACT_PLANS)
  -- can be looked up exactly by key on any future reprint.
  plan_key text NOT NULL,
  plan_label text NOT NULL,
  coverage text,
  coverage_detail text,
  visits_text text,
  annual_visits numeric NOT NULL DEFAULT 0,
  -- [{ "name": "...", "qty": 1, "price": 0 }, ...] -- the appliance
  -- schedule this contract covers, as edited in the calculator.
  appliances jsonb NOT NULL,
  total_count numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  labor_cost numeric NOT NULL DEFAULT 0,
  transport_cost numeric NOT NULL DEFAULT 0,
  parts_reserve numeric NOT NULL DEFAULT 0,
  direct_cost numeric NOT NULL DEFAULT 0,
  overhead numeric NOT NULL DEFAULT 0,
  price_excl_vat numeric NOT NULL DEFAULT 0,
  price_incl_vat numeric NOT NULL DEFAULT 0,
  commencement_date date,
  -- Optional free-text override reference, same purpose as vas_sales'
  -- contract_ref: a customer-facing number distinct from this system's own
  -- amc_contract_reference.
  contract_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT amc_contracts_reference_check CHECK (amc_contract_reference ~ '^AC-[0-9]{4}-[0-9]{5}$'),
  CONSTRAINT amc_contracts_plan_key_check CHECK (plan_key IN ('basic-rm', 'standard-pmc', 'premium-pmc'))
);

CREATE INDEX amc_contracts_updated_idx ON amc_contracts (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('amc_contract.read', 'View issued AMC contracts and reprint certificates'),
  ('amc_contract.write', 'Issue an AMC contract and print its certificate')
ON CONFLICT (code) DO NOTHING;

-- Same roles as vas_sale/quotation/inspection read+write (management,
-- sales) -- issuing an AMC contract is a day-to-day sales action, not an
-- admin one (the admin pricing master behind it stays gated to
-- pricing_config.*).
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN ('amc_contract.read', 'amc_contract.write')
WHERE roles.code IN ('management', 'sales')
ON CONFLICT DO NOTHING;
