-- Delivery & Installation, phase 4: the revenue feed, the salesman alias list
-- and the Portal vs master-Excel comparison.

-- Completed D&I jobs as a revenue source for Budget Variance. Each activity is
-- mapped to the same stream as its workbook job type (copied from the mapping
-- as it stands now, so a changed mapping is respected).
ALTER TABLE stream_mappings DROP CONSTRAINT stream_mappings_kind_check;
ALTER TABLE stream_mappings
  ADD CONSTRAINT stream_mappings_kind_check CHECK (
    source_kind IN (
      'excel_job_type', 'portal_vas', 'portal_amc', 'portal_rate_card', 'portal_thomson',
      'portal_job_csijw', 'portal_job_csijo',
      'portal_dandi_csidi', 'portal_dandi_csido', 'portal_dandi_csiii'
    )
  );

INSERT INTO stream_mappings (source_kind, match_value, stream_code, notes)
SELECT 'portal_dandi_' || lower(match_value), '*', stream_code,
       'Completed ' || match_value || ' jobs entered in the portal'
FROM stream_mappings
WHERE source_kind = 'excel_job_type' AND match_value IN ('CSIDI', 'CSIDO', 'CSIII')
ON CONFLICT (source_kind, match_value) DO NOTHING;

-- Off by default (decision D1: one-month parallel run). When on, CSIDI / CSIDO /
-- CSIII revenue comes from Completed portal jobs and those job types in the
-- workbook upload are ignored, so nothing is counted twice.
INSERT INTO revenue_settings (key, value, description) VALUES
  ('portal_dandi_revenue', 'false'::jsonb,
   'true = CSIDI / CSIDO / CSIII revenue comes from Completed Delivery & Installation jobs in the portal instead of the workbook upload.')
ON CONFLICT (key) DO NOTHING;

-- Other spellings of a salesman (the B2B list and the master workbook spell some
-- names differently, e.g. RENEESH JOSE for Raneesh Jose).
CREATE TABLE salesman_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias text NOT NULL,
  salesman_id bigint NOT NULL REFERENCES salesmen (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT salesman_aliases_alias_check CHECK (btrim(alias) <> '')
);

CREATE UNIQUE INDEX salesman_aliases_alias_idx ON salesman_aliases (lower(btrim(alias)));

INSERT INTO permissions (code, description)
VALUES
  ('di_jobs.compare', 'Delivery & Installation: compare the portal with the master Excel upload')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'di_jobs.compare'
WHERE r.code IN ('admin', 'management')
ON CONFLICT DO NOTHING;
