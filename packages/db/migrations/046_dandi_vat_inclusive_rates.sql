-- D+I standard (1-unit) rates became VAT-inclusive on 15 Oct 2026
-- (Pricing Logic Guide, workbook session log): Refrigerator / Washing Machine
-- 95.20 -> 100.00, Cooker 123.80 -> 120.00. A saved D+I Admin Entry override
-- keeps its own copy of the old figures, so move it to the new rates -- but
-- only where it still holds the old standard rate, so a value an admin has
-- typed since is never overwritten.
UPDATE pricing_configs
SET payload = jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{modes,dandi,rates,fridge,standard}', '100'::jsonb),
        '{modes,dandi,rates,washer,standard}', '100'::jsonb),
      '{modes,dandi,rates,cooker,standard}', '120'::jsonb),
    updated_at = now()
WHERE domain = 'dandi_pricing'
  AND (payload #>> '{modes,dandi,rates,fridge,standard}')::numeric = 95.2
  AND (payload #>> '{modes,dandi,rates,washer,standard}')::numeric = 95.2
  AND (payload #>> '{modes,dandi,rates,cooker,standard}')::numeric = 123.8;
