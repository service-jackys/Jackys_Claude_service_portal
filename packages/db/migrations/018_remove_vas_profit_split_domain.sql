-- Modification #29: the 'vas_profit_split' pricing_config domain was built
-- against the workbook's "VAS Sales-Service GP Split" sheet, which is a
-- management-reference calculator (it also pulls technician-cost inputs
-- from the AMC-PMC-RM sheet) -- not admin-editable pricing data. VAS admin
-- data lives entirely in the "VAS Pricing" sheet (vas_price_bands /
-- vas_pricing_params), with no dependency on any other sheet. Removing the
-- domain here to match its removal from packages/contracts and the
-- frontend.

DELETE FROM pricing_configs WHERE domain = 'vas_profit_split';

ALTER TABLE pricing_configs DROP CONSTRAINT pricing_configs_domain_check;

ALTER TABLE pricing_configs ADD CONSTRAINT pricing_configs_domain_check CHECK (domain IN (
  'vas_price_bands',
  'vas_pricing_params',
  'rate_card',
  'dandi_pricing',
  'amc_pricing',
  'thomson_pricing'
));
