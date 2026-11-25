import type { PoolClient } from 'pg';

// Walk-in job card settings (migration 112). Only the units-per-visit limit for now.
export const DEFAULT_MAX_UNITS_PER_VISIT = 10;

export interface WalkInSettings {
  maxUnitsPerVisit: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

type Q = Pick<PoolClient, 'query'>;

export async function getWalkInSettings(client: Q): Promise<WalkInSettings> {
  const r = await client.query<WalkInSettings>(
    `SELECT s.max_units_per_visit::int AS "maxUnitsPerVisit", s.updated_at AS "updatedAt",
            p.display_name AS "updatedByName"
       FROM walk_in_settings s LEFT JOIN profiles p ON p.id = s.updated_by
      WHERE s.id = 1`,
  );
  return (
    r.rows[0] ?? {
      maxUnitsPerVisit: DEFAULT_MAX_UNITS_PER_VISIT,
      updatedAt: null,
      updatedByName: null,
    }
  );
}

export async function saveWalkInSettings(
  client: Q,
  maxUnitsPerVisit: number,
  profileId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO walk_in_settings (id, max_units_per_visit, updated_by, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET max_units_per_visit = $1, updated_by = $2, updated_at = now()`,
    [maxUnitsPerVisit, profileId],
  );
}
