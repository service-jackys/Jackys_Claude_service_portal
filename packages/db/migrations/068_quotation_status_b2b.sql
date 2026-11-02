-- Quotations and inspections record the customer type and, for B2B, the branch / school
-- (same fields as the service job card). Quotations also get a status: only an Approved
-- (approval / LPO received) quotation can be turned into a service job card.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS customer_type text,
  ADD COLUMN IF NOT EXISTS b2b_branch_school text,
  ADD COLUMN IF NOT EXISTS quotation_status text NOT NULL DEFAULT 'Pending';

ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check CHECK (quotation_status IN ('Pending', 'Approved', 'Rejected')),
  ADD CONSTRAINT quotations_customer_type_check CHECK (customer_type IS NULL OR customer_type IN ('B2C', 'B2B', 'B2B-SalesChannel'));

-- A quotation that already has a service job card was clearly approved.
UPDATE quotations q
   SET quotation_status = 'Approved'
 WHERE EXISTS (SELECT 1 FROM service_job_cards j WHERE j.quotation_id = q.id);

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS customer_type text,
  ADD COLUMN IF NOT EXISTS b2b_branch_school text;

ALTER TABLE inspections
  ADD CONSTRAINT inspections_customer_type_check CHECK (customer_type IS NULL OR customer_type IN ('B2C', 'B2B', 'B2B-SalesChannel'));
