-- Modification #265: a task can also follow up an issued AMC contract, Thomson quote or VAS
-- sale (the saved quotes of the quote calculators). Only the allowed record types change;
-- every existing task is unchanged.
ALTER TABLE roi_tasks DROP CONSTRAINT roi_tasks_record_type_check;
ALTER TABLE roi_tasks
  ADD CONSTRAINT roi_tasks_record_type_check CHECK (
    record_type IS NULL OR record_type IN (
      'quotation', 'inspection', 'job_card', 'amc_contract', 'thomson_sale', 'vas_sale'
    )
  );
