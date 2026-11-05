-- Modification #197: AMC pricing v2 (per-appliance annual rates) is a new
-- pricing domain that sits next to the original AMC pricing. Its saved values
-- live in pricing_configs like every other domain; until an admin saves one,
-- the built-in defaults apply. Saved AMC quotes are tagged with the pricing
-- model that produced them so the old and the new calculators keep separate
-- AMC Issued lists.
ALTER TABLE pricing_configs DROP CONSTRAINT IF EXISTS pricing_configs_domain_check;
ALTER TABLE pricing_configs ADD CONSTRAINT pricing_configs_domain_check CHECK (domain IN (
  'vas_price_bands',
  'vas_pricing_params',
  'rate_card',
  'dandi_pricing',
  'amc_pricing',
  'amc_pricing_v2',
  'thomson_pricing',
  'appliance_master'
));

ALTER TABLE amc_contracts
  ADD COLUMN pricing_model text NOT NULL DEFAULT 'v1',
  ADD CONSTRAINT amc_contracts_pricing_model_check CHECK (pricing_model IN ('v1', 'v2'));
