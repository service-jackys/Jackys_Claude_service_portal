-- Phase 5 (docs/DEVELOPMENT_PLAN.md): "Add inspection records and quotation
-- records." Field sets match the live system's HEADERS_BY_TYPE['quotation']
-- and HEADERS_BY_TYPE['inspection'] (docs/code.gs). Unlike service job cards,
-- neither of these has a workflow-lock status in the live system -- Prepared
-- By/Date and Approved By/Date (quotation) or Inspected/Reviewed By/Date
-- (inspection) are plain fields the CCE fills in, not an enforced state
-- machine, so these tables don't get a status column or a history table.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection'));

CREATE TABLE quotations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_reference text NOT NULL UNIQUE,
  -- Optional traceability link back to the appointment this quotation was
  -- prepared for. The live system doesn't record this relationship (a
  -- quotation there is a standalone document keyed by customer name/contact
  -- typed in by hand), so it's nullable and purely additive here.
  appointment_id bigint REFERENCES appointments (id) ON DELETE SET NULL,
  quotation_date date,
  customer_name text,
  contact_number text,
  project_name text,
  site_location text,
  date_of_collection date,
  technician_name text,
  customer_complaint text,
  technical_diagnosis text,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  labour_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  prepared_by text,
  prepared_date date,
  approved_by text,
  approved_date date,
  customer_signature text,
  signature_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT quotations_reference_check CHECK (quotation_reference ~ '^QO-[0-9]{4}-[0-9]{5}$')
);

CREATE INDEX quotations_updated_idx ON quotations (updated_at DESC);
CREATE INDEX quotations_appointment_idx ON quotations (appointment_id) WHERE appointment_id IS NOT NULL;

CREATE TABLE inspections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inspection_reference text NOT NULL UNIQUE,
  appointment_id bigint REFERENCES appointments (id) ON DELETE SET NULL,
  inspection_date date,
  customer_name text,
  contact_number text,
  project_name text,
  site_location text,
  date_of_collection date,
  technician_name text,
  customer_complaint text,
  visual_findings text,
  technical_diagnosis text,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  faulty_parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text,
  -- Free-text reference to a quotation number, matching the live system's
  -- "Ref. Quotation No." field -- not a foreign key there, so not one here
  -- either (a CCE can type a number for a quotation that predates this
  -- project, or one issued outside it).
  ref_quotation_no text,
  warranty_status text,
  est_repair_cost numeric,
  inspected_by text,
  inspected_date date,
  reviewed_by text,
  reviewed_date date,
  customer_signature text,
  signature_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT inspections_reference_check CHECK (inspection_reference ~ '^IR-[0-9]{4}-[0-9]{5}$')
);

CREATE INDEX inspections_updated_idx ON inspections (updated_at DESC);
CREATE INDEX inspections_appointment_idx ON inspections (appointment_id) WHERE appointment_id IS NOT NULL;

-- The quotation.read/write and inspection.read/write permission codes were
-- already seeded in 001_initial_schema.sql (Phase 1 planned ahead for this),
-- but only granted to 'admin' via its all-permissions cross join. Grant them
-- to the same roles that already get the other day-to-day service
-- permissions (management, sales), matching how service_job_card.* and the
-- rest were granted.
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'quotation.read',
  'quotation.write',
  'inspection.read',
  'inspection.write'
)
WHERE roles.code IN ('management', 'sales')
ON CONFLICT DO NOTHING;
