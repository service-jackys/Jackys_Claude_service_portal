-- Delivery & Installation jobs (CSIDI / CSIDO / CSIII), captured on the portal
-- after the physical job. One job = one ERP delivery note. A job counts as
-- revenue only once it is Completed, and its figures are frozen at that moment
-- (see the plan in the project docs, decisions D1-D10).

ALTER TABLE reference_counters DROP CONSTRAINT reference_counters_namespace_check;
ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN (
    'complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale',
    'amc_contract', 'rate_card_sale', 'thomson_sale', 'walk_in_job_card', 'warranty_approval',
    'tax_invoice', 'di_job'
  ));

CREATE TABLE di_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  service_date date NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  cust_code text,
  customer_name text,
  salesman text,
  sales_channel text,
  region text NOT NULL DEFAULT 'Dubai',
  delivery_note_ref text,
  erp_inv_no text,
  csosc_no text,
  notes text,
  total_csidi numeric(14, 2) NOT NULL DEFAULT 0,
  total_csido numeric(14, 2) NOT NULL DEFAULT 0,
  total_csiii numeric(14, 2) NOT NULL DEFAULT 0,
  total_revenue numeric(14, 2) NOT NULL DEFAULT 0,
  completed_at timestamptz,
  completed_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT di_jobs_reference_check CHECK (reference ~ '^DIJ-[0-9]{4}-[0-9]{5}$'),
  CONSTRAINT di_jobs_status_check CHECK (status IN ('Draft', 'Completed', 'Cancelled'))
);

CREATE INDEX di_jobs_service_date_idx ON di_jobs (service_date DESC);
CREATE INDEX di_jobs_status_idx ON di_jobs (status);
CREATE INDEX di_jobs_delivery_note_idx ON di_jobs (lower(btrim(delivery_note_ref)));

-- Lines: item + quantity + the activity type the user chose. The item facts and
-- the category mapping result are copied onto the line so later master changes
-- never rewrite a completed job; the rate columns are filled when the job is
-- completed (frozen) and stay empty on a draft.
CREATE TABLE di_job_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES di_jobs (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_code text NOT NULL,
  item_desc text,
  brand text,
  main_group text,
  group_name text,
  sub_group text,
  qty numeric(12, 2) NOT NULL,
  txn_type text NOT NULL,
  installable boolean,
  pricing_category text,
  sales_channel text,
  rate_kind text,
  base_rate numeric(12, 2),
  discount_tier text,
  discount_rate numeric(8, 4),
  net_rate numeric(12, 2),
  labour numeric(14, 2),
  transport numeric(14, 2),
  charge numeric(14, 2),
  revenue numeric(14, 2),
  rate_note text,
  UNIQUE (job_id, line_no),
  CONSTRAINT di_job_lines_type_check CHECK (txn_type IN ('CSIDI', 'CSIDO', 'CSIII')),
  CONSTRAINT di_job_lines_qty_check CHECK (qty > 0)
);

CREATE INDEX di_job_lines_job_idx ON di_job_lines (job_id);

-- Admin switch: is the ERP Inv No (the zero-value CSIDI document) required to
-- complete a job? Off to start with; the admin turns it on after testing.
INSERT INTO revenue_settings (key, value, description) VALUES
  ('dandi_erp_inv_mandatory', 'false'::jsonb,
   'Delivery & Installation: true = the ERP Inv No is required before a job can be completed.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (code, description)
VALUES
  ('di_jobs.read', 'Delivery & Installation: view jobs'),
  ('di_jobs.write', 'Delivery & Installation: enter, complete and cancel jobs'),
  ('di_jobs.reopen', 'Delivery & Installation: reopen a completed or cancelled job (audited)'),
  ('di_jobs.configure', 'Delivery & Installation: settings such as whether the ERP Inv No is required')
ON CONFLICT (code) DO NOTHING;

-- Whoever can see / enter service job cards can see / enter D&I jobs; only an
-- administrator can reopen a completed job or change the settings.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'service_job_card.read'
JOIN permissions p ON p.code = 'di_jobs.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions base ON base.id = rp.permission_id AND base.code = 'service_job_card.write'
JOIN permissions p ON p.code = 'di_jobs.write'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('di_jobs.reopen', 'di_jobs.configure')
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
