-- Modification #128: a business job card takes its salesman, sales channel, customer
-- number and sales order from the B2B Branch / School master. Existing job cards that
-- were saved with those fields blank are filled in here (only when blank).
UPDATE service_job_cards j
   SET salesman = b.salesman
  FROM b2b_branches b
 WHERE lower(trim(b.branch_name)) = lower(trim(j.b2b_branch_school))
   AND j.customer_type IS DISTINCT FROM 'B2C'
   AND coalesce(trim(j.salesman), '') = ''
   AND coalesce(trim(b.salesman), '') <> '';

WITH fill AS (
  SELECT j.id,
         COALESCE(
           (SELECT s.sales_channel FROM salesmen s
             WHERE lower(trim(s.name)) = lower(trim(j.salesman)) AND s.sales_channel IS NOT NULL
             LIMIT 1),
           (SELECT b.sales_channel FROM b2b_branches b
             WHERE lower(trim(b.branch_name)) = lower(trim(j.b2b_branch_school))
               AND b.sales_channel IS NOT NULL LIMIT 1)) AS channel
    FROM service_job_cards j
   WHERE j.customer_type IS DISTINCT FROM 'B2C' AND coalesce(trim(j.sales_channel), '') = ''
)
UPDATE service_job_cards j SET sales_channel = fill.channel
  FROM fill WHERE fill.id = j.id AND fill.channel IS NOT NULL;

UPDATE service_job_cards j
   SET customer_number = CASE WHEN coalesce(trim(j.customer_number), '') = ''
                              THEN b.cust_code ELSE j.customer_number END,
       sales_order_number = CASE WHEN coalesce(trim(j.sales_order_number), '') = ''
                                 THEN b.last_sales_order_number ELSE j.sales_order_number END
  FROM b2b_branches b
 WHERE lower(trim(b.branch_name)) = lower(trim(j.b2b_branch_school))
   AND j.customer_type IS DISTINCT FROM 'B2C'
   AND (coalesce(trim(j.customer_number), '') = '' OR coalesce(trim(j.sales_order_number), '') = '');
