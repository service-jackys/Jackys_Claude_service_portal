-- Customer code (Cust_Code) of a repair job (CSIJW / CSIJO), read from the master
-- workbook's own CSIJW / CSIJO sheets at upload. Delivery & Installation lines keep
-- theirs in the pricing detail; this column is for the lines that have none.
ALTER TABLE revenue_lines
  ADD COLUMN IF NOT EXISTS cust_code text;
