-- Modification #39 (modification.md): redesign the AMC contract record to
-- match the Excel workflow -- a saved AMC "quote" carries the full set of
-- 3 computed plans (Basic RM / Standard PMC / Premium PMC) against the
-- user-entered appliance schedule, with no single plan chosen at save
-- time. Which plan to print is picked afterwards, per print, from the
-- "AMC Issued" tab -- so the single plan_key/plan_label/.../price_incl_vat
-- columns from 020_amc_contracts.sql are replaced by one `plans` jsonb
-- array holding all 3 plans' numbers.

ALTER TABLE amc_contracts
  DROP CONSTRAINT IF EXISTS amc_contracts_plan_key_check;

ALTER TABLE amc_contracts
  DROP COLUMN IF EXISTS plan_key,
  DROP COLUMN IF EXISTS plan_label,
  DROP COLUMN IF EXISTS coverage,
  DROP COLUMN IF EXISTS coverage_detail,
  DROP COLUMN IF EXISTS visits_text,
  DROP COLUMN IF EXISTS annual_visits,
  DROP COLUMN IF EXISTS labor_cost,
  DROP COLUMN IF EXISTS transport_cost,
  DROP COLUMN IF EXISTS parts_reserve,
  DROP COLUMN IF EXISTS direct_cost,
  DROP COLUMN IF EXISTS overhead,
  DROP COLUMN IF EXISTS price_excl_vat,
  DROP COLUMN IF EXISTS price_incl_vat;

-- [{ "planKey": "basic-rm", "planLabel": "Basic RM", "coverage": "...",
--    "coverageDetail": "...", "visitsText": "12 visits/year",
--    "annualVisits": 12, "laborCost": 0, "transportCost": 0,
--    "partsReserve": 0, "directCost": 0, "overhead": 0,
--    "priceExclVat": 0, "priceInclVat": 0 }, ...] -- always the 3 plans
-- computed from the saved appliance schedule, in Basic RM / Standard PMC
-- / Premium PMC order.
ALTER TABLE amc_contracts
  ADD COLUMN plans jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE amc_contracts
  ALTER COLUMN plans DROP DEFAULT;
