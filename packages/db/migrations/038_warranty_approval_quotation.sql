-- Modification #96: an out-of-warranty approval request can be raised from a
-- quotation (picked in the form) as well as from a job card. Inspection-linked
-- rows already saved stay valid; the form no longer offers inspections.
ALTER TABLE warranty_approvals
  ADD COLUMN quotation_id bigint REFERENCES quotations (id) ON DELETE RESTRICT;

ALTER TABLE warranty_approvals DROP CONSTRAINT warranty_approvals_source_check;
ALTER TABLE warranty_approvals ADD CONSTRAINT warranty_approvals_source_check CHECK (
  (job_card_id IS NOT NULL)::int
  + (inspection_id IS NOT NULL)::int
  + (quotation_id IS NOT NULL)::int = 1
);

CREATE INDEX warranty_approvals_quotation_idx ON warranty_approvals (quotation_id) WHERE quotation_id IS NOT NULL;
