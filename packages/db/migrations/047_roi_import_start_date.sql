-- Modification #112: the Dashboard kanban shows how many days each open Tasks
-- (ROI) item has been pending, counted from its start date. Tasks imported from
-- the weekly tracker before the import dialog asked for one have no start date,
-- so date them from the 15 Oct 2026 week. Only open tasks without a start date
-- are touched; a date someone has set is never overwritten.
UPDATE roi_tasks
SET start_date = DATE '2026-10-15', updated_at = now()
WHERE start_date IS NULL
  AND status <> 'completed';
