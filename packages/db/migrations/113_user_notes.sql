-- Modification #318: floating "My notes" panel. One private note per signed-in
-- user, saved on the server so it follows them to any browser or computer.
CREATE TABLE IF NOT EXISTS user_notes (
  profile_id bigint PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  color text NOT NULL DEFAULT 'navy'
    CHECK (color IN ('navy', 'slate', 'teal', 'plum', 'sand')),
  panel_width smallint NOT NULL DEFAULT 380 CHECK (panel_width BETWEEN 300 AND 900),
  panel_height smallint NOT NULL DEFAULT 340 CHECK (panel_height BETWEEN 240 AND 900),
  -- Where the minimised tab sits on the right edge: 0 = top, 100 = bottom.
  tab_position smallint NOT NULL DEFAULT 55 CHECK (tab_position BETWEEN 0 AND 100),
  is_open boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
