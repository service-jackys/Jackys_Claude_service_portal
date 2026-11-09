-- Modification #218 (modification.md): the Thomson Quote Calculator's Project
-- timeline. A saved Thomson quote keeps the schedule it was quoted on (work
-- mode, crew, working days, phases and waits) so a reprint always shows the
-- same plan. NULL on quotes issued before this change.
ALTER TABLE thomson_sales ADD COLUMN schedule jsonb;
