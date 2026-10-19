-- Flat job-type rates (CSIJW, CSIJO, CSIDO, RWR / BER) are now entered in
-- Pricing Masters > D+I Admin Entry (#114), VAT-inclusive. A saved override
-- gets the current rates so Logic applied shows the same figures as before
-- (CSIJO 125 as instructed on 19 Oct 2026; the others as in the workbook).
UPDATE pricing_configs
SET payload = jsonb_set(
      payload,
      '{flatRates}',
      '{"CSIJW": 100, "CSIJO": 125, "CSIDO": 100, "RWR": 60}'::jsonb),
    updated_at = now()
WHERE domain = 'dandi_pricing'
  AND NOT (payload ? 'flatRates');
