import type { Pool } from 'pg';
import { z } from 'zod';
import { auditFilterOptions, listAuditEvents } from '../../../../packages/db/src/audit.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date.');

export const auditQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  actorId: z.union([z.literal('none'), z.string().regex(/^\d{1,18}$/)]).optional(),
  module: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,60}$/)
    .optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.]{1,120}$/)
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export class AuditServiceError extends Error {
  constructor(
    public readonly code: 'invalid-range',
    message: string,
  ) {
    super(message);
  }
}

export function createAuditService(pool: Pool) {
  async function list(rawQuery: unknown) {
    const query = auditQuerySchema.parse(rawQuery);
    if (query.from && query.to && query.to < query.from) {
      throw new AuditServiceError(
        'invalid-range',
        'The To date must be on or after the From date.',
      );
    }
    const client = await pool.connect();
    try {
      const { items, total } = await listAuditEvents(
        client,
        {
          from: query.from,
          to: query.to,
          actorId: query.actorId,
          module: query.module,
          action: query.action,
          search: query.search,
        },
        { limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
      );
      return { items, total, page: query.page, pageSize: query.pageSize };
    } finally {
      client.release();
    }
  }

  async function filters() {
    const client = await pool.connect();
    try {
      return await auditFilterOptions(client);
    } finally {
      client.release();
    }
  }

  return { list, filters };
}

export type AuditService = ReturnType<typeof createAuditService>;
