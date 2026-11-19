-- Delivery & Installation jobs can now be for a B2C customer (a person) as well as a
-- B2B customer (a branch from the B2B customer list). Every existing job stays B2B.
-- B2C jobs carry the typed customer name and phone; cust_code stays empty.
ALTER TABLE di_jobs
  ADD COLUMN customer_type text NOT NULL DEFAULT 'B2B',
  ADD COLUMN customer_phone text,
  ADD COLUMN technician_name text,
  ADD CONSTRAINT di_jobs_customer_type_check CHECK (customer_type IN ('B2B', 'B2C'));
