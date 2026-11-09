-- Modification #221 (modification.md): Thomson Issued quotes get an outcome like
-- AMC Issued (New): Quote (default) -> Sold or Lost. Existing quotes stay
-- 'Quote'. Revenue is unchanged except that a quote marked Lost is no longer
-- counted (budget vs actual).
ALTER TABLE thomson_sales
  ADD COLUMN status text NOT NULL DEFAULT 'Quote',
  ADD COLUMN sold_date date,
  ADD COLUMN lost_reason text,
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN status_changed_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  ADD CONSTRAINT thomson_sales_status_check CHECK (status IN ('Quote', 'Sold', 'Lost'));

CREATE INDEX thomson_sales_status_idx ON thomson_sales (status);
