-- Modification #101: portal-generated tax invoices for service jobs that carry an
-- amount. The job keeps the customer TRN (optional, B2B or B2C), the portal invoice
-- number (SINV-YYYY-NNNNN) and a snapshot of what was invoiced. The older
-- invoice_no column now holds the optional ERP reference.
ALTER TABLE service_job_cards
  ADD COLUMN customer_trn text,
  ADD COLUMN portal_invoice_no text,
  ADD COLUMN portal_invoice_issued_at timestamptz,
  ADD COLUMN portal_invoice_issued_by bigint REFERENCES profiles (id),
  ADD COLUMN invoice_snapshot jsonb;

CREATE UNIQUE INDEX service_job_cards_portal_invoice_no_key
  ON service_job_cards (portal_invoice_no)
  WHERE portal_invoice_no IS NOT NULL;

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;
ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN (
    'complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale',
    'amc_contract', 'rate_card_sale', 'thomson_sale', 'walk_in_job_card', 'warranty_approval',
    'tax_invoice'
  ));
