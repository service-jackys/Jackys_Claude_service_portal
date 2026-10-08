-- Warranty and billing for service job cards.
--
-- Warranty status is captured when the request is registered (complaints
-- already carry warranty_classification). On the job card the technician
-- records a FINAL warranty status; billing follows the final status, and a
-- different final status needs a reason (for example customer-induced damage
-- voids the warranty).
--
-- Billing: In Warranty = CSIJW, billed to the sales channel. Out of Warranty =
-- CSIJO, billed to the customer or the sales channel (user's choice). A job
-- with an amount payable by the customer cannot be Delivered until the
-- payment is confirmed.
ALTER TABLE service_job_cards
  ADD COLUMN final_warranty_status text,
  ADD COLUMN warranty_override_reason text,
  ADD COLUMN payment_by text,
  ADD COLUMN bill_to_channel text,
  ADD COLUMN bill_to_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN billing_job_type text,
  ADD COLUMN invoice_date date,
  ADD COLUMN payment_mode text,
  ADD COLUMN payment_reference text,
  ADD COLUMN payment_confirmed_at timestamptz,
  ADD COLUMN payment_confirmed_by bigint REFERENCES profiles (id) ON DELETE SET NULL;

ALTER TABLE service_job_cards
  ADD CONSTRAINT service_job_cards_final_warranty_check
    CHECK (final_warranty_status IS NULL OR final_warranty_status IN ('In Warranty', 'Out Warranty')),
  ADD CONSTRAINT service_job_cards_payment_by_check
    CHECK (payment_by IS NULL OR payment_by IN ('Sales channel', 'Customer')),
  ADD CONSTRAINT service_job_cards_billing_job_type_check
    CHECK (billing_job_type IS NULL OR billing_job_type IN ('CSIJW', 'CSIJO')),
  ADD CONSTRAINT service_job_cards_payment_mode_check
    CHECK (payment_mode IS NULL OR payment_mode IN ('Cash', 'Online', 'Bank transfer', 'Card'));

-- Admin-managed rules that decide which sales channel is billed. A rule matches
-- when the job's salesman equals the rule's salesman (blank = any) and the
-- B2B branch / school name contains the keyword (blank = any).
CREATE TABLE billing_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  salesman text,
  branch_keyword text,
  bill_to_channel text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_rules_channel_check CHECK (length(trim(bill_to_channel)) BETWEEN 1 AND 200),
  CONSTRAINT billing_rules_has_condition CHECK (salesman IS NOT NULL OR branch_keyword IS NOT NULL)
);

INSERT INTO billing_rules (salesman, branch_keyword, bill_to_channel, notes)
VALUES ('Raneesh Jose', 'GEMS', 'JDI', 'GEMS schools handled by Raneesh Jose are billed to JDI.');

INSERT INTO sales_channels (name)
SELECT 'JDI' WHERE NOT EXISTS (SELECT 1 FROM sales_channels WHERE lower(name) = 'jdi');
