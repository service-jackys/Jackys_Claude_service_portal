-- Shared Appliance Master (one list of appliances for the AMC and Thomson
-- calculators). Only widens the allowed pricing domains: the master's first
-- value is built from the already-saved AMC and Thomson configurations the
-- first time it is read (see the pricing-config service), so no data is
-- copied here.
ALTER TABLE pricing_configs DROP CONSTRAINT IF EXISTS pricing_configs_domain_check;
ALTER TABLE pricing_configs ADD CONSTRAINT pricing_configs_domain_check CHECK (domain IN (
  'vas_price_bands',
  'vas_pricing_params',
  'rate_card',
  'dandi_pricing',
  'amc_pricing',
  'thomson_pricing',
  'appliance_master'
));
