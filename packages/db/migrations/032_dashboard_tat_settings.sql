-- Modification #67 (modification.md): dashboard kanban TAT thresholds, kept as settings.
-- A case is "on track" up to tat_target_days, "late" from tat_late_days, and "at risk" between.
INSERT INTO revenue_settings (key, value, description) VALUES
  ('tat_target_days', '3'::jsonb, 'Dashboard board: turnaround target in days (on track up to this).'),
  ('tat_late_days', '5'::jsonb, 'Dashboard board: a case at or above this many days is late.')
ON CONFLICT (key) DO NOTHING;
