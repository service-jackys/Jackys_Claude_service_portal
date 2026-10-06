import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  actualRevenue,
  activeVersion,
  copyVersionStreams,
  getSettings,
  getVersion,
  insertVersion,
  jobTypeTotals,
  listMappings,
  listStreams,
  listVersions,
  makeVersionActive,
  replaceMappings,
  setSetting,
  settingsMap,
  updateVersionFields,
  upsertStream,
  upsertVersionStream,
  versionStreams,
} from '../../../../packages/db/src/budget-variance.js';
import { findActiveBatch } from '../../../../packages/db/src/revenue-dashboard.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

export class BudgetVarianceServiceError extends Error {
  constructor(
    public readonly code: 'invalid-input' | 'not-found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

const SOURCE_KINDS = [
  'excel_job_type',
  'portal_vas',
  'portal_amc',
  'portal_rate_card',
  'portal_thomson',
] as const;

const phasingSchema = z
  .array(z.number().min(0).max(1))
  .length(12)
  .refine((p) => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 0.005, {
    message: 'Monthly phasing must add up to 100%.',
  });

const configSchema = z.object({
  settings: z
    .object({
      fiscal_start_month: z.number().int().min(1).max(12).optional(),
      vat_rate: z.number().min(0).max(1).optional(),
      variance_months: z.enum(['closed', 'all']).optional(),
      amc_recognition: z.enum(['start']).optional(),
      compare_quantity: z.boolean().optional(),
    })
    .optional(),
  streams: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        name: z.string().min(1).max(80),
        sortOrder: z.number().int().min(0).max(999),
        isActive: z.boolean(),
        notes: z.string().max(500).nullable().optional(),
      }),
    )
    .optional(),
  mappings: z
    .array(
      z.object({
        sourceKind: z.enum(SOURCE_KINDS),
        matchValue: z.string().min(1).max(40),
        streamCode: z.string().min(1).max(41),
        notes: z.string().max(500).nullable().optional(),
      }),
    )
    .optional(),
});

const createVersionSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['original', 'revised', 'forecast']),
  fiscalYear: z.number().int().min(2020).max(2100),
  copyFromVersionId: z.string().regex(/^\d+$/).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const updateVersionSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  notes: z.string().max(1000).nullable().optional(),
  phasing: phasingSchema.optional(),
  status: z.enum(['draft', 'approved', 'archived']).optional(),
  makeActive: z.boolean().optional(),
  streams: z
    .array(
      z.object({
        streamCode: z.string().min(1).max(41),
        annualRevenue: z.number().min(0),
        annualVolume: z.number().min(0),
        vatInclusive: z.boolean(),
      }),
    )
    .optional(),
});

function invalid(error: z.ZodError): never {
  throw new BudgetVarianceServiceError(
    'invalid-input',
    error.issues.map((i) => i.message).join('; '),
  );
}

const EQUAL_PHASING = Array.from({ length: 12 }, () => 1 / 12);

/** Fiscal months for the year that starts in `fiscalYear`, e.g. Jul-26 .. Jun-27. */
export function fiscalMonths(fiscalYear: number, startMonth: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const zero = startMonth - 1 + i;
    const month = (zero % 12) + 1;
    const year = fiscalYear + Math.floor(zero / 12);
    return { fiscalMonth: i + 1, period: `${year}-${String(month).padStart(2, '0')}` };
  });
}

function dubaiPeriodNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}`;
}

export function createBudgetVarianceService(pool: Pool) {
  async function config() {
    const client = await pool.connect();
    try {
      const [streams, mappings, settings, versions, revenueBatch] = await Promise.all([
        listStreams(client),
        listMappings(client),
        getSettings(client),
        listVersions(client),
        findActiveBatch(client, 'revenue'),
      ]);
      const unmapped = revenueBatch
        ? (await jobTypeTotals(client, revenueBatch.id)).filter(
            (t) =>
              !mappings.some(
                (m) => m.sourceKind === 'excel_job_type' && m.matchValue === t.jobType,
              ),
          )
        : [];
      return { streams, mappings, settings, versions, unmappedJobTypes: unmapped };
    } finally {
      client.release();
    }
  }

  async function saveConfig(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) invalid(parsed.error);
    const data = parsed.data;
    return withTransaction(pool, async (client) => {
      for (const s of data.streams ?? []) {
        await upsertStream(client, {
          code: s.code,
          name: s.name,
          sortOrder: s.sortOrder,
          isActive: s.isActive,
          notes: s.notes ?? null,
        });
      }
      if (data.mappings) {
        const codes = new Set((await listStreams(client)).map((s) => s.code));
        for (const m of data.mappings) {
          if (!codes.has(m.streamCode)) {
            throw new BudgetVarianceServiceError(
              'invalid-input',
              `Unknown stream "${m.streamCode}".`,
            );
          }
        }
        const seen = new Set<string>();
        const rows = data.mappings.map((m) => ({
          sourceKind: m.sourceKind,
          matchValue: m.sourceKind === 'excel_job_type' ? m.matchValue.trim().toUpperCase() : '*',
          streamCode: m.streamCode,
          notes: m.notes ?? null,
        }));
        for (const r of rows) {
          const key = r.sourceKind + '|' + r.matchValue;
          if (seen.has(key)) {
            throw new BudgetVarianceServiceError(
              'conflict',
              `Duplicate mapping for ${r.matchValue}.`,
            );
          }
          seen.add(key);
        }
        await replaceMappings(client, rows);
      }
      for (const [key, value] of Object.entries(data.settings ?? {})) {
        if (value !== undefined) await setSetting(client, key, value, profileId);
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'budget_variance.config_saved',
        targetType: 'revenue_settings',
        metadata: {
          streams: data.streams?.length ?? 0,
          mappings: data.mappings?.length ?? 0,
          settings: Object.keys(data.settings ?? {}),
        },
        requestId,
      });
    });
  }

  async function versionDetail(id: string) {
    const client = await pool.connect();
    try {
      const version = await getVersion(client, id);
      if (!version) throw new BudgetVarianceServiceError('not-found', 'Budget version not found.');
      return { version, streams: await versionStreams(client, id) };
    } finally {
      client.release();
    }
  }

  async function createVersion(
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const parsed = createVersionSchema.safeParse(input);
    if (!parsed.success) invalid(parsed.error);
    const data = parsed.data;
    return withTransaction(pool, async (client) => {
      let phasing = EQUAL_PHASING;
      if (data.copyFromVersionId) {
        const from = await getVersion(client, data.copyFromVersionId);
        if (!from) throw new BudgetVarianceServiceError('not-found', 'Version to copy not found.');
        phasing = from.phasing;
      }
      const version = await insertVersion(client, {
        name: data.name,
        kind: data.kind,
        fiscalYear: data.fiscalYear,
        phasing,
        notes: data.notes ?? null,
        createdBy: profileId,
      });
      if (data.copyFromVersionId)
        await copyVersionStreams(client, data.copyFromVersionId, version.id);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'budget_variance.version_created',
        targetType: 'budget_version',
        targetId: version.id,
        metadata: { name: data.name, kind: data.kind, fiscalYear: data.fiscalYear },
        requestId,
      });
      return version;
    });
  }

  async function updateVersion(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const parsed = updateVersionSchema.safeParse(input);
    if (!parsed.success) invalid(parsed.error);
    const data = parsed.data;
    return withTransaction(pool, async (client) => {
      const version = await getVersion(client, id);
      if (!version) throw new BudgetVarianceServiceError('not-found', 'Budget version not found.');
      const editsNumbers = data.phasing !== undefined || data.streams !== undefined;
      if (version.status === 'approved' && editsNumbers) {
        throw new BudgetVarianceServiceError(
          'conflict',
          'An approved budget cannot be edited. Create a revised version instead.',
        );
      }
      if (version.status === 'archived' && (editsNumbers || data.makeActive)) {
        throw new BudgetVarianceServiceError('conflict', 'An archived budget is read-only.');
      }
      if (data.streams) {
        const codes = new Set((await listStreams(client)).map((s) => s.code));
        for (const s of data.streams) {
          if (!codes.has(s.streamCode)) {
            throw new BudgetVarianceServiceError(
              'invalid-input',
              `Unknown stream "${s.streamCode}".`,
            );
          }
          await upsertVersionStream(client, id, s);
        }
      }
      await updateVersionFields(
        client,
        id,
        {
          name: data.name,
          notes: data.notes,
          phasing: data.phasing,
          status: data.status,
        },
        profileId,
      );
      if (data.makeActive) await makeVersionActive(client, id, version.fiscalYear);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'budget_variance.version_updated',
        targetType: 'budget_version',
        targetId: id,
        metadata: {
          status: data.status ?? null,
          makeActive: data.makeActive ?? false,
          streams: data.streams?.length ?? 0,
          phasingChanged: data.phasing !== undefined,
        },
        requestId,
      });
      return getVersion(client, id);
    });
  }

  async function variance(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      const versionIdParam =
        typeof query.versionId === 'string' && /^\d+$/.test(query.versionId)
          ? query.versionId
          : null;
      const version = versionIdParam
        ? await getVersion(client, versionIdParam)
        : await activeVersion(client);
      if (!version) return { version: null };
      const [streams, mappings, settings, vStreams, revenueBatch] = await Promise.all([
        listStreams(client),
        listMappings(client),
        settingsMap(client),
        versionStreams(client, version.id),
        findActiveBatch(client, 'revenue'),
      ]);
      const startMonth = Number(settings.fiscal_start_month ?? 7);
      const vatRate = Number(settings.vat_rate ?? 0.05);
      const includeRunning = settings.variance_months === 'all';
      const months = fiscalMonths(version.fiscalYear, startMonth);
      const nowPeriod = dubaiPeriodNow();
      const monthRows = months.map((m) => ({
        ...m,
        closed: includeRunning ? m.period <= nowPeriod : m.period < nowPeriod,
        running: m.period === nowPeriod,
      }));
      const [fy, fm] = months[11]!.period.split('-').map(Number) as [number, number];
      const fromDate = months[0]!.period + '-01';
      const toDate = fm === 12 ? `${fy + 1}-01-01` : `${fy}-${String(fm + 1).padStart(2, '0')}-01`;
      const actual = await actualRevenue(client, revenueBatch?.id ?? null, fromDate, toDate);

      const mapIndex = new Map(
        mappings.map((m) => [m.sourceKind + '|' + m.matchValue, m.streamCode]),
      );
      const streamFor = (kind: string, value: string) =>
        mapIndex.get(kind + '|' + value) ?? mapIndex.get(kind + '|*') ?? null;

      type Cell = { budget: number; actual: number; budgetQty: number; actualQty: number };
      const cells = new Map<string, Cell[]>();
      const cellsFor = (code: string) => {
        if (!cells.has(code)) {
          cells.set(
            code,
            months.map(() => ({ budget: 0, actual: 0, budgetQty: 0, actualQty: 0 })),
          );
        }
        return cells.get(code)!;
      };
      for (const vs of vStreams) {
        const exVat = vs.vatInclusive
          ? Number(vs.annualRevenue) / (1 + vatRate)
          : Number(vs.annualRevenue);
        const row = cellsFor(vs.streamCode);
        version.phasing.forEach((p, i) => {
          row[i]!.budget = exVat * p;
          row[i]!.budgetQty = Number(vs.annualVolume) * p;
        });
      }
      const unmapped = new Map<string, { source: string; revenue: number }>();
      for (const a of actual) {
        const idx = months.findIndex((m) => m.period === a.period);
        if (idx < 0) continue;
        const code = streamFor(a.kind, a.matchValue);
        if (!code) {
          const key = a.kind + '|' + a.matchValue;
          const cur = unmapped.get(key) ?? {
            source: a.matchValue === '*' ? a.kind : a.matchValue,
            revenue: 0,
          };
          cur.revenue += Number(a.revenue);
          unmapped.set(key, cur);
          continue;
        }
        const cell = cellsFor(code)[idx]!;
        cell.actual += Number(a.revenue);
        cell.actualQty += Number(a.qty);
      }

      const rows = streams
        .filter((s) => s.isActive || cells.has(s.code))
        .map((s) => {
          const c = cellsFor(s.code);
          const closed = c.filter((_, i) => monthRows[i]!.closed);
          const sum = (arr: Cell[], k: keyof Cell) => arr.reduce((t, x) => t + x[k], 0);
          return {
            code: s.code,
            name: s.name,
            months: c,
            fullYear: { budget: sum(c, 'budget'), budgetQty: sum(c, 'budgetQty') },
            closed: {
              budget: sum(closed, 'budget'),
              actual: sum(closed, 'actual'),
              budgetQty: sum(closed, 'budgetQty'),
              actualQty: sum(closed, 'actualQty'),
            },
          };
        });
      return {
        version,
        settings: {
          fiscalStartMonth: startMonth,
          vatRate,
          includeRunning,
          compareQuantity: settings.compare_quantity !== false,
        },
        months: monthRows,
        streams: rows,
        unmapped: [...unmapped.values()],
        revenueBatch,
      };
    } finally {
      client.release();
    }
  }

  return { config, saveConfig, versionDetail, createVersion, updateVersion, variance };
}

export type BudgetVarianceService = ReturnType<typeof createBudgetVarianceService>;
