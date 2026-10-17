-- Modification #107: Tasks (ROI). A personal task manager under Records whose
-- tasks feed the weekly ROI email (Results / Objectives / Issues-Innovation).
-- Each user owns their own tasks; administrators can view and edit anyone's.
CREATE TABLE roi_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_profile_id bigint NOT NULL REFERENCES profiles (id),
  title text NOT NULL,
  notes text,
  -- 'task' feeds Result/Objective; the others feed the Issues / Innovation section.
  kind text NOT NULL DEFAULT 'task',
  status text NOT NULL DEFAULT 'not_started',
  priority text NOT NULL DEFAULT 'medium',
  start_date date,
  due_date date,
  percent_complete smallint NOT NULL DEFAULT 0,
  remarks text,
  completed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roi_tasks_title_check CHECK (length(trim(title)) BETWEEN 1 AND 500),
  CONSTRAINT roi_tasks_kind_check CHECK (kind IN ('task', 'issue', 'innovation', 'request')),
  CONSTRAINT roi_tasks_status_check CHECK (
    status IN ('not_started', 'in_progress', 'on_hold', 'completed')
  ),
  CONSTRAINT roi_tasks_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT roi_tasks_percent_check CHECK (percent_complete BETWEEN 0 AND 100),
  CONSTRAINT roi_tasks_dates_check CHECK (
    start_date IS NULL OR due_date IS NULL OR due_date >= start_date
  )
);

CREATE INDEX roi_tasks_owner_idx ON roi_tasks (owner_profile_id, status, sort_order);
CREATE INDEX roi_tasks_completed_idx ON roi_tasks (owner_profile_id, completed_at);

-- One row per ROI drafted from the portal, so there is a history by week.
CREATE TABLE roi_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_profile_id bigint NOT NULL REFERENCES profiles (id),
  week_year integer NOT NULL,
  week_number integer NOT NULL,
  week_ending date NOT NULL,
  subject text NOT NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  includes_summary boolean NOT NULL DEFAULT false,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'tasks',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roi_reports_week_check CHECK (week_number BETWEEN 1 AND 53),
  CONSTRAINT roi_reports_source_check CHECK (source IN ('tasks', 'revenue'))
);

CREATE INDEX roi_reports_owner_idx ON roi_reports (owner_profile_id, week_year DESC, week_number DESC);

-- Per-user ROI defaults: who it goes to and the signature block.
CREATE TABLE roi_settings (
  owner_profile_id bigint PRIMARY KEY REFERENCES profiles (id),
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  signature text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description)
VALUES ('tasks.use', 'Use the Tasks (ROI) tab: manage own tasks and send the weekly ROI')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'tasks.use'
WHERE roles.code = 'admin'
ON CONFLICT DO NOTHING;
