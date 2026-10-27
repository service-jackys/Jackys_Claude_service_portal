-- Modification #163: the B2B customer master (b2b_branches) becomes an admin-managed
-- master like the stock master: upload an Excel to add / update customers, download
-- it back. The table itself is unchanged; this adds the upload log and a "last seen"
-- stamp so the page can say which customers are not in the latest file.
ALTER TABLE b2b_branches ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE b2b_uploads (
  id bigserial PRIMARY KEY,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL,
  customer_count integer NOT NULL,
  new_customers integer NOT NULL DEFAULT 0,
  changed_customers integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Only the newest upload keeps its original file (bounded storage).
  file_bytes bytea,
  uploaded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description)
VALUES ('b2b_master.write', 'Upload and download the B2B customer master')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'b2b_master.write'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
