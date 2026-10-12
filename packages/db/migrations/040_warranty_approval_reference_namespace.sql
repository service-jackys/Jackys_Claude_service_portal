-- Modification #99: warranty approval requests could not be created because
-- the 'warranty_approval' reference counter namespace was never allowed by the
-- reference_counters check constraint.
ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;
ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN (
    'complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale',
    'amc_contract', 'rate_card_sale', 'thomson_sale', 'walk_in_job_card', 'warranty_approval'
  ));
