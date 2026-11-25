import type { PoolClient } from 'pg';

// The floating "My notes" panel (migration 113): one private note per user.
export const NOTE_COLORS = ['navy', 'slate', 'teal', 'plum', 'sand'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface UserNote {
  body: string;
  color: NoteColor;
  width: number;
  height: number;
  tabPosition: number;
  open: boolean;
  updatedAt: string | null;
}

export type UserNotePatch = Partial<Omit<UserNote, 'updatedAt'>>;

type Q = Pick<PoolClient, 'query'>;

const DEFAULT_NOTE: UserNote = {
  body: '',
  color: 'navy',
  width: 380,
  height: 340,
  tabPosition: 55,
  open: false,
  updatedAt: null,
};

export async function getUserNote(client: Q, profileId: string): Promise<UserNote> {
  const r = await client.query<UserNote>(
    `SELECT body, color, panel_width::int AS width, panel_height::int AS height,
            tab_position::int AS "tabPosition", is_open AS open, updated_at AS "updatedAt"
       FROM user_notes WHERE profile_id = $1`,
    [profileId],
  );
  return r.rows[0] ?? DEFAULT_NOTE;
}

// Saves only the fields sent, so typing never overwrites the panel size and
// moving the tab never overwrites the text.
export async function saveUserNote(
  client: Q,
  profileId: string,
  patch: UserNotePatch,
): Promise<UserNote> {
  const m = { ...DEFAULT_NOTE, ...patch };
  await client.query(
    `INSERT INTO user_notes
       (profile_id, body, color, panel_width, panel_height, tab_position, is_open, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (profile_id) DO UPDATE SET
       body = CASE WHEN $8 THEN $2 ELSE user_notes.body END,
       color = CASE WHEN $9 THEN $3 ELSE user_notes.color END,
       panel_width = CASE WHEN $10 THEN $4 ELSE user_notes.panel_width END,
       panel_height = CASE WHEN $10 THEN $5 ELSE user_notes.panel_height END,
       tab_position = CASE WHEN $11 THEN $6 ELSE user_notes.tab_position END,
       is_open = CASE WHEN $12 THEN $7 ELSE user_notes.is_open END,
       updated_at = now()`,
    [
      profileId,
      m.body,
      m.color,
      m.width,
      m.height,
      m.tabPosition,
      m.open,
      patch.body !== undefined,
      patch.color !== undefined,
      patch.width !== undefined || patch.height !== undefined,
      patch.tabPosition !== undefined,
      patch.open !== undefined,
    ],
  );
  return getUserNote(client, profileId);
}
