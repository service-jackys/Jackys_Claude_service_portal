-- Quotations carry VAT like the old portal's "TOTAL PAYABLE (Incl. VAT)" (modification.md #182).
-- vat_rate: 0.05 for VAT-inclusive quotations, 0 for old portal-made ones that were saved without VAT.
-- subtotal_amount: all lines + labour, excluding VAT. vat_amount: the VAT on it. grand_total stays the
-- amount payable (subtotal + VAT), so the imported sheet totals (for example 514.50) keep their value.
ALTER TABLE quotations
  ADD COLUMN vat_rate numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN subtotal_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN vat_amount numeric NOT NULL DEFAULT 0,
  ADD CONSTRAINT quotations_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 0.25);

WITH lines AS (
  SELECT q.id,
         COALESCE((
           SELECT sum(COALESCE((e->>'qty')::numeric, 0) * COALESCE((e->>'unitPrice')::numeric, 0))
           FROM jsonb_array_elements(q.products || q.parts) AS e
         ), 0) + q.labour_amount AS subtotal
  FROM quotations q
)
UPDATE quotations q
SET subtotal_amount = round(l.subtotal, 2),
    vat_rate = CASE WHEN l.subtotal > 0 AND abs(q.grand_total - l.subtotal * 1.05) < 0.05 THEN 0.05 ELSE 0 END,
    vat_amount = CASE WHEN l.subtotal > 0 AND abs(q.grand_total - l.subtotal * 1.05) < 0.05
                      THEN round(q.grand_total - l.subtotal, 2) ELSE 0 END
FROM lines l
WHERE l.id = q.id;
