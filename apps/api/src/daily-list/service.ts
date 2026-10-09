import type { Pool } from 'pg';
import { z } from 'zod';
import { listDailyAppointments } from '../../../../packages/db/src/daily-list.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date.');

export const dailyListQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((value) => value.to >= value.from, { message: 'The To date must not be before From.' })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 31 * 86_400_000, {
    message: 'Choose a range of 31 days or less.',
  });

export function createDailyListService(pool: Pool) {
  async function list(query: unknown) {
    const parsed = dailyListQuerySchema.parse(query);
    const client = await pool.connect();
    try {
      const result = await listDailyAppointments(client, parsed.from, parsed.to);
      return { from: parsed.from, to: parsed.to, ...result };
    } finally {
      client.release();
    }
  }
  return { list };
}

export type DailyListService = ReturnType<typeof createDailyListService>;
