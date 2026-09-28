-- Phase 5 (docs/DEVELOPMENT_PLAN.md): "Add job-card attachments using
-- private storage, size/MIME validation, signed URLs, and audit events."
--
-- Files themselves are NOT stored in Postgres or in this repo -- they live
-- on private local disk (apps/api/src/attachments/storage.ts), outside the
-- web server's static roots, addressed only by the opaque storage_key this
-- table holds. In staging/production (Phase 8) storage_key becomes the
-- object key in the Supabase Storage bucket already anticipated in
-- .env.example (SUPABASE_STORAGE_BUCKET) -- this table's shape doesn't need
-- to change for that swap.

CREATE TABLE job_card_attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_card_id bigint NOT NULL REFERENCES service_job_cards (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT job_card_attachments_size_check CHECK (size_bytes > 0 AND size_bytes <= 20971520)
);

CREATE INDEX job_card_attachments_job_card_idx
  ON job_card_attachments (job_card_id, uploaded_at ASC, id ASC);
