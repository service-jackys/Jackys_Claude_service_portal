-- ERP / ORION invoice number of an Invoiced quotation. It is mandatory when a quotation is set to
-- Invoiced (quotations Invoiced before this change stay blank and are treated as legacy), and is
-- matched against the invoice number (inv_del_no) in the uploaded master workbook to prove the
-- invoice really exists in ERP.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS erp_invoice_no text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS quotations_erp_invoice_no_idx ON quotations (erp_invoice_no)
  WHERE erp_invoice_no <> '';

-- Days a quotation marked Invoiced may wait for its invoice to show up in the master workbook
-- before it is flagged red in Reports.
INSERT INTO revenue_settings (key, value, description)
VALUES ('invoice_check_grace_days', '7'::jsonb,
        'Days after a quotation is marked Invoiced before a missing invoice in the master workbook is flagged red.')
ON CONFLICT (key) DO NOTHING;
