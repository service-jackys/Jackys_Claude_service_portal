-- Modification #35 (modification.md): "Issue a VAS Sale — Customer
-- Certificate" (docs/index.html's VAS Sales tab / docs/code.gs
-- HEADERS_BY_TYPE['vas-sale']). A VAS sale is a normalized record of a plan
-- actually sold to a customer -- it is what the printed certificate is
-- generated from, and what a certificate can be reprinted from later.
--
-- Unlike the legacy Apps Script sheet (a single "Plan & Price" text column
-- plus a catch-all "DataJSON" blob), this table follows the normalized
-- typed-column style already used for quotations/inspections
-- (006_quotations_inspections.sql). It adds one column the legacy sheet
-- doesn't have -- plan_key ('ew1'/'ew2'/'di1'/'premium') -- so the
-- certificate's plan-specific legal text (app.js VAS_PLAN_CONTENT) can be
-- looked up exactly by key on any future reprint, rather than fuzzy-
-- matching the stored plan display label.

ALTER TABLE reference_counters
  DROP CONSTRAINT reference_counters_namespace_check;

ALTER TABLE reference_counters
  ADD CONSTRAINT reference_counters_namespace_check
  CHECK (namespace IN ('complaint', 'appointment', 'job_card', 'quotation', 'inspection', 'vas_sale'));

CREATE TABLE vas_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vas_sale_reference text NOT NULL UNIQUE,
  sale_date date,
  customer_name text,
  contact_number text,
  address text,
  invoice_number text,
  purchase_date date,
  item_code text,
  item_description text,
  -- 'ew1' / 'ew2' / 'di1' / 'premium' -- matches VAS_CALC_PLANS keys in
  -- apps/web/src/app.js (modification.md #34) and VAS_PLAN_CONTENT (#35).
  plan_key text NOT NULL,
  vas_product text NOT NULL,
  selling_price numeric NOT NULL DEFAULT 0,
  plan_fee numeric NOT NULL DEFAULT 0,
  deductible numeric NOT NULL DEFAULT 0,
  service_fee_text text,
  -- Optional free-text override of the auto-generated vas_sale_reference,
  -- matching the legacy "Contract Ref. No. (optional -- auto-generated if
  -- blank)" field. Kept separate from vas_sale_reference (which is always
  -- this system's own unique reference) so a certificate can still show a
  -- customer-facing contract number distinct from the internal reference.
  contract_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  updated_by bigint REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT vas_sales_reference_check CHECK (vas_sale_reference ~ '^VS-[0-9]{4}-[0-9]{5}$'),
  CONSTRAINT vas_sales_plan_key_check CHECK (plan_key IN ('ew1', 'ew2', 'di1', 'premium'))
);

CREATE INDEX vas_sales_updated_idx ON vas_sales (updated_at DESC);

INSERT INTO permissions (code, description)
VALUES
  ('vas_sale.read', 'View issued VAS sale certificates'),
  ('vas_sale.write', 'Issue a VAS sale and print its customer certificate')
ON CONFLICT (code) DO NOTHING;

-- Same roles as quotation/inspection read+write (management, sales) --
-- issuing a VAS sale is a day-to-day sales action, not an admin one (the
-- admin pricing masters behind it stay gated to pricing_config.*).
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN ('vas_sale.read', 'vas_sale.write')
WHERE roles.code IN ('management', 'sales')
ON CONFLICT DO NOTHING;
