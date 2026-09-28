-- Phase 5 (docs/DEVELOPMENT_PLAN.md): "Add out-of-warranty approval flow and
-- customer-facing approval links." Unlike the other Phase 5 items, the live
-- Apps Script system has no equivalent workflow to mirror (warranty status
-- there is just a plain text field on the job card/inspection) -- this is
-- new functionality: when a job card or inspection is marked Out of
-- Warranty, staff can raise an approval request with an estimated cost, and
-- the customer approves or declines it themselves through a link that needs
-- no staff account (see apps/web/src/approve.html and the /api/public/
-- warranty-approvals/* routes).

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'warranty_approval'));

CREATE TABLE warranty_approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_reference text NOT NULL UNIQUE,
  -- Exactly one of these identifies what the customer is approving work on.
  job_card_id bigint REFERENCES service_job_cards (id) ON DELETE CASCADE,
  inspection_id bigint REFERENCES inspections (id) ON DELETE CASCADE,
  customer_name text,
  contact_number text,
  item_description text,
  warranty_status text,
  estimated_cost numeric,
  notes text,
  status text NOT NULL DEFAULT 'Pending',
  -- Opaque bearer token for the customer-facing link -- not a signed/expiring
  -- token like attachment downloads, since this link needs to stay usable
  -- for as long as the request is Pending (customers don't sign in).
  access_token text NOT NULL UNIQUE,
  decided_at timestamptz,
  decided_by_name text,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT warranty_approvals_reference_check CHECK (approval_reference ~ '^WA-[0-9]{4}-[0-9]{5}$'),
  CONSTRAINT warranty_approvals_status_check CHECK (status IN ('Pending', 'Approved', 'Declined')),
  CONSTRAINT warranty_approvals_source_check CHECK (
    (job_card_id IS NOT NULL AND inspection_id IS NULL)
    OR (job_card_id IS NULL AND inspection_id IS NOT NULL)
  )
);

CREATE INDEX warranty_approvals_job_card_idx ON warranty_approvals (job_card_id) WHERE job_card_id IS NOT NULL;
CREATE INDEX warranty_approvals_inspection_idx ON warranty_approvals (inspection_id) WHERE inspection_id IS NOT NULL;
CREATE INDEX warranty_approvals_updated_idx ON warranty_approvals (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('warranty_approval.read', 'View out-of-warranty approval requests'),
  ('warranty_approval.write', 'Create out-of-warranty approval requests')
ON CONFLICT (code) DO NOTHING;

-- admin's blanket CROSS JOIN grant in 001_initial_schema.sql only ran once,
-- against the permissions that existed at that time -- these two are new,
-- so admin needs an explicit grant here too, not just management/sales.
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'warranty_approval.read',
  'warranty_approval.write'
)
WHERE roles.code IN ('admin', 'management', 'sales')
ON CONFLICT DO NOTHING;
