-- Modification #51 (modification.md): keep the master workbook's CSIDI-sheet
-- pricing columns (appliance category, discount tier, rates, trips, transport,
-- before/after-fix revenue ...) with each CSIDI / CSIDO / CSIII revenue line so
-- the report export can show how every figure was calculated.
-- Existing batches simply have NULL here; re-upload the workbook to fill it.
ALTER TABLE revenue_lines ADD COLUMN pricing jsonb;
