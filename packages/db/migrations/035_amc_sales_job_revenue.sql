-- Modification #76: AMC quote -> sold contract with the plan sold, and
-- portal job-card billing as a revenue source.
--
-- A saved AMC record stays a quote (all 3 plans stored) until someone marks it
-- Sold and picks the plan the customer took. The sold price is copied from the
-- chosen plan at that moment so later edits to pricing never move revenue.
ALTER TABLE amc_contracts
  ADD COLUMN status text NOT NULL DEFAULT 'Quote',
  ADD COLUMN sold_plan_key text,
  ADD COLUMN sold_plan_label text,
  ADD COLUMN sold_price_excl_vat numeric,
  ADD COLUMN sold_price_incl_vat numeric,
  ADD COLUMN sold_date date,
  ADD COLUMN sold_at timestamptz,
  ADD COLUMN sold_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  ADD COLUMN lost_reason text;

ALTER TABLE amc_contracts
  ADD CONSTRAINT amc_contracts_status_check CHECK (status IN ('Quote', 'Sold', 'Lost')),
  ADD CONSTRAINT amc_contracts_sold_plan_check CHECK (
    sold_plan_key IS NULL OR sold_plan_key IN ('basic-rm', 'standard-pmc', 'premium-pmc')
  ),
  ADD CONSTRAINT amc_contracts_sold_fields_check CHECK (
    status <> 'Sold'
    OR (sold_plan_key IS NOT NULL AND sold_price_excl_vat IS NOT NULL AND sold_date IS NOT NULL)
  );

CREATE INDEX amc_contracts_status_idx ON amc_contracts (status, sold_date);

-- Job-card billing as a revenue source: CSIJW and CSIJO job cards, each mapped
-- to a stream like any other source.
ALTER TABLE stream_mappings DROP CONSTRAINT stream_mappings_kind_check;
ALTER TABLE stream_mappings
  ADD CONSTRAINT stream_mappings_kind_check CHECK (
    source_kind IN (
      'excel_job_type', 'portal_vas', 'portal_amc', 'portal_rate_card', 'portal_thomson',
      'portal_job_csijw', 'portal_job_csijo'
    )
  );

INSERT INTO stream_mappings (source_kind, match_value, stream_code, notes) VALUES
  ('portal_job_csijw', '*', 'warranty', 'Warranty job cards billed in the portal'),
  ('portal_job_csijo', '*', 'non_warranty', 'Non-warranty job cards billed in the portal');

-- Off by default so nothing is counted twice while the workbook upload still
-- carries CSIJW / CSIJO. When on, those two job types come from job cards and
-- the workbook rows for them are ignored.
INSERT INTO revenue_settings (key, value, description) VALUES
  ('portal_job_card_revenue', 'false'::jsonb,
   'true = CSIJW / CSIJO revenue comes from portal job-card billing (invoice date) instead of the workbook upload.');
