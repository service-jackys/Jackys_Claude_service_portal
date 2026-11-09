-- Edit and history for issued Thomson quotes (modification #224). Saving an
-- edit keeps the same reference and moves the version it replaces into
-- thomson_sale_revisions, so nothing that was ever saved is lost.

ALTER TABLE thomson_sales
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN revision_note text,
  -- What the calculator needs to reopen the quote exactly as it was built
  -- (lines, phases, crew, add-on switches). Older quotes have none.
  ADD COLUMN editor_state jsonb;

CREATE TABLE thomson_sale_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thomson_sale_id bigint NOT NULL REFERENCES thomson_sales (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  revision_note text,
  saved_at timestamptz NOT NULL,
  saved_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  superseded_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  UNIQUE (thomson_sale_id, revision)
);

CREATE INDEX thomson_sale_revisions_sale_idx
  ON thomson_sale_revisions (thomson_sale_id, revision DESC);

INSERT INTO permissions (code, description)
VALUES
  ('thomson_sale.revise', 'Reopen and edit an issued Thomson quote, and view its revision history')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'thomson_sale.revise'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
