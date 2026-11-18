-- Modification #278: repeat-customer lookup on New request. Phone matches on the last 9
-- digits (so 050 123 4567, +971 50 123 4567 and 0501234567 all find the same customer);
-- name matches on the start of the name. Both use an index, so the lookup stays cheap
-- however many appointments there are.
CREATE INDEX appointments_phone_tail_idx
  ON appointments ((right(regexp_replace(contact_number, '\D', '', 'g'), 9)));

CREATE INDEX appointments_customer_name_prefix_idx
  ON appointments ((lower(customer_name)) text_pattern_ops);
