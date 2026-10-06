-- Modification #64 (modification.md): budget <-> activity dynamic link.
-- Everything finance may change later is DATA, not code:
--   revenue_streams       the budget streams (Warranty Repairs, Del + Install ...)
--   stream_mappings       which job type / portal record feeds which stream
--   revenue_settings      fiscal start month, VAT rate, which months count ...
--   budget_versions       original / revised / forecast budgets per fiscal year
--   budget_version_streams  annual revenue + volume per stream, per version
-- The budget workbook's P&L sheet only carries TOTAL revenue per month, so the
-- per-stream budget lives in a version and is phased across the fiscal year.

CREATE TABLE revenue_streams (
  code text PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  CONSTRAINT revenue_streams_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$')
);

CREATE TABLE stream_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- excel_job_type = revenue_lines.job_type from the master workbook;
  -- portal_* = records issued in this portal.
  source_kind text NOT NULL,
  match_value text NOT NULL DEFAULT '*',
  stream_code text NOT NULL REFERENCES revenue_streams (code) ON UPDATE CASCADE,
  notes text,
  CONSTRAINT stream_mappings_kind_check CHECK (
    source_kind IN ('excel_job_type', 'portal_vas', 'portal_amc', 'portal_rate_card', 'portal_thomson')
  ),
  CONSTRAINT stream_mappings_unique UNIQUE (source_kind, match_value)
);

CREATE TABLE revenue_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL
);

CREATE TABLE budget_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'original',
  -- Calendar year in which the fiscal year STARTS (2026 = Jul 2026 - Jun 2027).
  fiscal_year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT false,
  -- 12 fractions summing to ~1, fiscal month 1 (Jul) .. 12 (Jun).
  phasing jsonb NOT NULL,
  notes text,
  approved_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_versions_kind_check CHECK (kind IN ('original', 'revised', 'forecast')),
  CONSTRAINT budget_versions_status_check CHECK (status IN ('draft', 'approved', 'archived'))
);

-- One active version per fiscal year: the one variance reads by default.
CREATE UNIQUE INDEX budget_versions_one_active_idx ON budget_versions (fiscal_year) WHERE is_active;

CREATE TABLE budget_version_streams (
  version_id bigint NOT NULL REFERENCES budget_versions (id) ON DELETE CASCADE,
  stream_code text NOT NULL REFERENCES revenue_streams (code) ON UPDATE CASCADE,
  annual_revenue numeric NOT NULL DEFAULT 0,
  annual_volume numeric NOT NULL DEFAULT 0,
  -- true when annual_revenue includes VAT (the PMC budget does); variance
  -- restates it ex-VAT using the vat_rate setting.
  vat_inclusive boolean NOT NULL DEFAULT false,
  PRIMARY KEY (version_id, stream_code)
);

ALTER TABLE revenue_import_batches
  ADD COLUMN budget_version_id bigint REFERENCES budget_versions (id) ON DELETE SET NULL;

INSERT INTO revenue_streams (code, name, sort_order, notes) VALUES
  ('warranty', 'Warranty Repairs', 1, 'CSIJW. RWR/BER flat fee applies to CSIJW and CSIJO; billed to the channel (B2B) or the customer (B2C).'),
  ('non_warranty', 'Non-Warranty', 2, 'CSIJO. An original job value above zero marks a 3rd-party job (an expense today).'),
  ('del_install', 'Del + Install', 3, 'CSIDI.'),
  ('delivery_only', 'Delivery only', 4, 'CSIDO, derived from the CSIDI sheet; its own revenue stream, billed per trip. No budget yet.'),
  ('installation', 'Installation', 5, 'CSIII, same source sheet as CSIDI.'),
  ('inspections', 'Inspections / Visits', 6, 'New stream; will sit under a new "projects" job type.'),
  ('projects', 'Projects / Thomson', 7, 'New stream under the "projects" job type.'),
  ('amc', 'Standard PMC / AMC', 8, 'New stream under the "AMC" job type; counted at contract start.'),
  ('vas', 'VAS', 9, 'New stream under the "VAS" job type.');

INSERT INTO stream_mappings (source_kind, match_value, stream_code, notes) VALUES
  ('excel_job_type', 'CSIJW', 'warranty', NULL),
  ('excel_job_type', 'CSIJO', 'non_warranty', NULL),
  ('excel_job_type', 'CSIDI', 'del_install', NULL),
  ('excel_job_type', 'CSIDO', 'delivery_only', NULL),
  ('excel_job_type', 'CSIII', 'installation', NULL),
  ('excel_job_type', 'CSOSC', 'projects', 'Project orders'),
  ('portal_vas', '*', 'vas', 'Every VAS sale issued in the portal'),
  ('portal_amc', '*', 'amc', 'Every AMC contract issued in the portal'),
  ('portal_rate_card', '*', 'projects', 'Rate card sales; change to inspections if finance prefers'),
  ('portal_thomson', '*', 'projects', 'Thomson sales');

INSERT INTO revenue_settings (key, value, description) VALUES
  ('fiscal_start_month', '7'::jsonb, 'Month the fiscal year starts (7 = July, so FY runs Jul-Jun).'),
  ('vat_rate', '0.05'::jsonb, 'VAT rate used to restate VAT-inclusive budget figures ex-VAT.'),
  ('variance_months', '"closed"'::jsonb, 'closed = only completed months count in totals; all = include the running month.'),
  ('amc_recognition', '"start"'::jsonb, 'start = AMC value counted in the contract start month (commencement date).'),
  ('compare_quantity', 'true'::jsonb, 'Also compare invoiced quantity with budget volume.');

-- Original budget for FY Jul-26 .. Jun-27, as proposed (finance meeting
-- sheet). The monthly phasing is replaced from the budget workbook on upload.
INSERT INTO budget_versions (name, kind, fiscal_year, status, is_active, phasing, notes)
VALUES (
  'Original budget FY 2026-27', 'original', 2026, 'draft', true,
  '[0.08,0.1,0.1,0.1,0.1,0.1,0.08,0.08,0.08,0.06,0.06,0.06]'::jsonb,
  'Proposed from industry knowledge; replaced stream by stream as actual job types accrue.'
);

INSERT INTO budget_version_streams (version_id, stream_code, annual_revenue, annual_volume, vat_inclusive)
SELECT v.id, s.code, s.rev, s.vol, s.vat
FROM budget_versions v,
  (VALUES
    ('warranty', 57557.5, 515.7, false),
    ('non_warranty', 37647, 309.75, false),
    ('del_install', 162003.03, 1494.99, false),
    ('installation', 70963.2, 940.8, false),
    ('inspections', 6250, 75, false),
    ('projects', 920, 10, false),
    ('amc', 14587.02, 0, true)
  ) AS s(code, rev, vol, vat)
WHERE v.fiscal_year = 2026 AND v.kind = 'original';
