-- Date a quotation was marked Invoiced in ERP / ORION. It lets the LPO pending figure carry
-- forward: a quotation counts as pending in every month from its quotation month until the month
-- it was invoiced. The date is stamped by a trigger (Dubai date) when erp_status becomes
-- 'Invoiced' and cleared if it is set back. Quotations already Invoiced before this migration
-- stay blank (legacy), so history does not move.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS invoiced_at date;

CREATE OR REPLACE FUNCTION quotations_stamp_invoiced_at() RETURNS trigger AS $$
BEGIN
  IF NEW.erp_status = 'Invoiced' THEN
    IF TG_OP = 'INSERT' OR OLD.erp_status IS DISTINCT FROM 'Invoiced' THEN
      NEW.invoiced_at := (now() AT TIME ZONE 'Asia/Dubai')::date;
    END IF;
  ELSE
    NEW.invoiced_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_stamp_invoiced_at_trg ON quotations;
CREATE TRIGGER quotations_stamp_invoiced_at_trg
  BEFORE INSERT OR UPDATE OF erp_status ON quotations
  FOR EACH ROW EXECUTE FUNCTION quotations_stamp_invoiced_at();
