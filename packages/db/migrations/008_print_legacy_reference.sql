-- Phase 5 (docs/DEVELOPMENT_PLAN.md): "Add print views and legacy-reference
-- preservation." Print views are a client-side feature (see apps/web/src/
-- app.js) and need no schema change. This migration adds the schema half:
-- an optional legacy_reference column on the three document types job cards/
-- quotations/inspections print, so a record that corresponds to (or
-- replaces) a document from the legacy Google Sheets/Apps Script system can
-- carry that original reference forward -- printed alongside this project's
-- own auto-generated reference so continuity is visible on paper, and ready
-- for Phase 7's historical import to populate automatically instead of by
-- hand. Free text (not a foreign key or a fixed format): the legacy system's
-- references pre-date this project's reference_counters allocator entirely.

ALTER TABLE service_job_cards ADD COLUMN legacy_reference text;
ALTER TABLE quotations ADD COLUMN legacy_reference text;
ALTER TABLE inspections ADD COLUMN legacy_reference text;
