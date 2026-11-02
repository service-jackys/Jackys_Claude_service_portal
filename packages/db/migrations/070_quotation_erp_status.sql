-- ERP / ORION status of a quotation: 'Pending invoice' or 'Invoiced'. Existing quotations start
-- blank and are set by hand. A quotation marked Invoiced already sits inside that month's revenue,
-- so it is left out of the "LPO pending" visibility figure on the revenue dashboard.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS erp_status text NOT NULL DEFAULT '';

ALTER TABLE quotations
  ADD CONSTRAINT quotations_erp_status_check CHECK (erp_status IN ('', 'Pending invoice', 'Invoiced'));
