-- Modification #98: quotations record the service job warranty status
-- (In Warranty / Out Warranty), as inspections already do.
ALTER TABLE quotations
  ADD COLUMN warranty_status text,
  ADD CONSTRAINT quotations_warranty_status_check CHECK (
    warranty_status IS NULL OR warranty_status IN ('In Warranty', 'Out Warranty')
  );
