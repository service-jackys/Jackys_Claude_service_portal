-- Modification #49 (modification.md): Service Revenue Dashboard + Budget vs
-- Actual dashboard, fed from the master Excel workbooks until ERP gives us
-- an API or table access. An admin uploads
--   * the Service Dashboard master (.xlsm) -> its "Revenue Source" sheet
--     becomes revenue_lines (Excel-computed Revenue is kept verbatim; it is
--     the canonical figure), and
--   * the Service Budget workbook (.xlsx) -> its "P&L -YTD" sheet becomes
--     budget_lines (monthly budget by P&L line).
-- Every upload is a batch; the newest batch of each kind is the active one
-- the dashboards read. Older batches are kept (inactive) as an audit trail.

CREATE TABLE revenue_import_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  -- Rates / fiscal-year / sheet facts read from the workbook (shown on the
  -- dashboard as "data as of" context).
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  uploaded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_import_batches_kind_check CHECK (kind IN ('revenue', 'budget'))
);

CREATE INDEX revenue_import_batches_kind_idx ON revenue_import_batches (kind, is_active, uploaded_at DESC);

CREATE TABLE revenue_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES revenue_import_batches (id) ON DELETE CASCADE,
  source_row integer,
  job_type text NOT NULL,
  description text,
  inv_del_no text,
  csosc_order_no text,
  order_date date,
  year smallint,
  week_no smallint,
  month_no smallint,
  customer text,
  lpo_no text,
  csosc_status text,
  job_sheet_status text,
  sales_person text,
  qty numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  original_job_value numeric NOT NULL DEFAULT 0,
  billing_code text,
  sales_channel text,
  cost_status text,
  remarks text
);

CREATE INDEX revenue_lines_batch_idx ON revenue_lines (batch_id, year, month_no);
CREATE INDEX revenue_lines_job_type_idx ON revenue_lines (batch_id, job_type);

CREATE TABLE budget_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES revenue_import_batches (id) ON DELETE CASCADE,
  section text NOT NULL,
  line_item text NOT NULL,
  period date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT budget_lines_section_check CHECK (section IN ('volume', 'revenue', 'cost', 'opex', 'nop', 'below', 'np'))
);

CREATE INDEX budget_lines_batch_idx ON budget_lines (batch_id, sort_order, period);

INSERT INTO permissions (code, description)
VALUES
  ('revenue_dashboard.read', 'View the Service Revenue and Budget vs Actual dashboards'),
  ('revenue_dashboard.write', 'Upload the master revenue / budget workbooks that feed the dashboards')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'revenue_dashboard.read'
WHERE roles.code IN ('admin', 'management')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'revenue_dashboard.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
