import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Pool, PoolClient } from 'pg';
import {
  roiDefaultRecipients,
  roiImportSchema,
  roiReportLogSchema,
  roiSettingsSchema,
  roiTaskListQuerySchema,
  roiTaskPatchSchema,
  roiTaskWriteSchema,
} from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  deleteRoiTask,
  findRoiTask,
  importRoiTasks,
  insertRoiReport,
  insertRoiTask,
  listRoiOwners,
  listRoiReports,
  listRoiTasks,
  readRoiSettings,
  saveRoiSettings,
  updateRoiTask,
} from '../../../../packages/db/src/roi-tasks.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import type { ApplicationAuth } from '../auth/application-auth.js';

export class RoiServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'forbidden' | 'invalid-file' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

const isAdmin = (auth: ApplicationAuth) => auth.permissions.includes('*');

export type UploadedSheet = { originalname: string; size: number; buffer: Buffer };
export const MAX_ROI_IMPORT_BYTES = 8 * 1024 * 1024;

// ---- tracker workbook -> task rows (pure, unit-tested) ----------------------
export type ParsedTask = {
  title: string;
  kind: 'task';
  status: 'not_started' | 'in_progress' | 'on_hold' | 'completed';
  percentComplete: number;
  remarks: string | null;
};
export type ParsedSheet = { name: string; tasks: ParsedTask[] };

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
}

const clean = (text: string) =>
  text
    .replace(/[ ​]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

const firstNumber = (text: string) => {
  const match = /\d+/.exec(text);
  return match ? parseInt(match[0], 10) : NaN;
};

function statusFrom(text: string): ParsedTask['status'] {
  const t = text.toLowerCase();
  if (/complete|done|finish/.test(t)) return 'completed';
  if (/hold|block/.test(t)) return 'on_hold';
  if (/progress|ongoing|started|wip/.test(t) && !/not\s*started/.test(t)) return 'in_progress';
  return 'not_started';
}

// Reads the weekly tracker layout: "Task Description | Status | % | Remarks"
// (results) and "Task Description | Target | Status | Next Action" (objectives,
// where Target reads like "50% -> 100%"), several tables per sheet.
export async function parseTrackerWorkbook(buffer: Buffer): Promise<ParsedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new RoiServiceError('invalid-file', 'That file could not be read as an .xlsx workbook.');
  }
  const sheets: ParsedSheet[] = [];
  for (const sheet of workbook.worksheets) {
    const tasks: ParsedTask[] = [];
    let mode: 'result' | 'objective' | null = null;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [1, 2, 3, 4].map((i) => clean(cellText(row.getCell(i).value)));
      if (/^task description$/i.test(cells[0])) {
        mode = /target/i.test(cells[1]) ? 'objective' : /status/i.test(cells[1]) ? 'result' : null;
        return;
      }
      if (!mode || !cells[0]) return;
      if (mode === 'result') {
        const percent = firstNumber(cells[2]);
        const status = statusFrom(cells[1]);
        tasks.push({
          title: cells[0],
          kind: 'task',
          status,
          percentComplete:
            status === 'completed' ? 100 : Number.isFinite(percent) ? Math.min(percent, 100) : 0,
          remarks: cells[3] || null,
        });
      } else {
        const first = firstNumber(cells[1]);
        const status = statusFrom(cells[2]);
        tasks.push({
          title: cells[0],
          kind: 'task',
          status,
          percentComplete:
            status === 'completed' ? 100 : Number.isFinite(first) ? Math.min(first, 100) : 0,
          remarks: cells[3] || null,
        });
      }
    });
    if (tasks.length) sheets.push({ name: sheet.name, tasks });
  }
  return sheets;
}

export function createRoiService(pool: Pool) {
  async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async function list(auth: ApplicationAuth, input: unknown) {
    const query = roiTaskListQuerySchema.parse(input);
    let owner: string | null = auth.profileId;
    if (query.owner === 'all') {
      if (!isAdmin(auth))
        throw new RoiServiceError('forbidden', 'Only administrators can see every user.');
      owner = null;
    } else if (query.owner && query.owner !== auth.profileId) {
      if (!isAdmin(auth))
        throw new RoiServiceError('forbidden', 'You can only see your own tasks.');
      owner = query.owner;
    }
    return withClient((client) => listRoiTasks(client, { ...query, owner }));
  }

  async function owners(auth: ApplicationAuth) {
    if (!isAdmin(auth)) return [];
    return withClient((client) => listRoiOwners(client));
  }

  async function create(auth: ApplicationAuth, input: unknown) {
    const data = roiTaskWriteSchema.parse(input);
    let owner = auth.profileId;
    if (data.ownerProfileId && data.ownerProfileId !== auth.profileId) {
      if (!isAdmin(auth))
        throw new RoiServiceError('forbidden', 'You can only add tasks for yourself.');
      owner = data.ownerProfileId;
    }
    return withTransaction(pool, async (client) => {
      const id = await insertRoiTask(client, owner, data);
      return (await findRoiTask(client, id))!;
    });
  }

  async function update(auth: ApplicationAuth, id: string, input: unknown) {
    const patch = roiTaskPatchSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const current = await findRoiTask(client, id, true);
      if (!current || (!isAdmin(auth) && current.ownerProfileId !== auth.profileId)) {
        throw new RoiServiceError('not-found', 'The task was not found.');
      }
      if (
        patch.ownerProfileId &&
        patch.ownerProfileId !== current.ownerProfileId &&
        !isAdmin(auth)
      ) {
        throw new RoiServiceError('forbidden', 'Only administrators can reassign a task.');
      }
      if (
        (patch.startDate !== undefined || patch.dueDate !== undefined) &&
        (patch.startDate ?? current.startDate) &&
        (patch.dueDate ?? current.dueDate) &&
        (patch.dueDate ?? current.dueDate)! < (patch.startDate ?? current.startDate)!
      ) {
        throw new RoiServiceError('invalid', 'The end date cannot be before the start date.');
      }
      await updateRoiTask(client, id, patch, current);
      return (await findRoiTask(client, id))!;
    });
  }

  async function remove(auth: ApplicationAuth, id: string) {
    return withTransaction(pool, async (client) => {
      const current = await findRoiTask(client, id, true);
      if (!current || (!isAdmin(auth) && current.ownerProfileId !== auth.profileId)) {
        throw new RoiServiceError('not-found', 'The task was not found.');
      }
      await deleteRoiTask(client, id);
    });
  }

  async function settings(auth: ApplicationAuth) {
    const saved = await withClient((client) => readRoiSettings(client, auth.profileId));
    return (
      saved ?? {
        toEmails: [...roiDefaultRecipients.to],
        ccEmails: [...roiDefaultRecipients.cc],
        signature: auth.displayName,
      }
    );
  }

  async function saveSettings(auth: ApplicationAuth, input: unknown) {
    const data = roiSettingsSchema.parse(input);
    await withTransaction(pool, (client) => saveRoiSettings(client, auth.profileId, data));
    return data;
  }

  async function logReport(
    auth: ApplicationAuth,
    input: unknown,
    requestId: string = randomUUID(),
  ) {
    const data = roiReportLogSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const id = await insertRoiReport(client, auth.profileId, data);
      await insertAuditEvent(client, {
        actorProfileId: auth.profileId,
        action: 'roi.report_drafted',
        targetType: 'roi_report',
        targetId: id,
        metadata: {
          week: `${data.weekYear}-W${data.weekNumber}`,
          source: data.source,
          includesSummary: data.includesSummary,
          ...data.counts,
        },
        requestId,
      });
      return id;
    });
  }

  async function reports(auth: ApplicationAuth) {
    return withClient((client) => listRoiReports(client, auth.profileId));
  }

  async function previewImport(file: UploadedSheet) {
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new RoiServiceError('invalid-file', 'Upload an .xlsx tracker workbook.');
    }
    const sheets = await parseTrackerWorkbook(file.buffer);
    if (!sheets.length) {
      throw new RoiServiceError(
        'invalid-file',
        'No task tables were found. Expected columns: Task Description, Status, % Complete, Remarks.',
      );
    }
    return { sheets };
  }

  async function importTasks(
    auth: ApplicationAuth,
    input: unknown,
    requestId: string = randomUUID(),
  ) {
    const data = roiImportSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const added = await importRoiTasks(client, auth.profileId, data.tasks);
      await insertAuditEvent(client, {
        actorProfileId: auth.profileId,
        action: 'roi.tasks_imported',
        targetType: 'roi_task',
        metadata: { received: data.tasks.length, added },
        requestId,
      });
      return { received: data.tasks.length, added, skipped: data.tasks.length - added };
    });
  }

  return {
    list,
    owners,
    create,
    update,
    remove,
    settings,
    saveSettings,
    logReport,
    reports,
    previewImport,
    importTasks,
  };
}

export type RoiService = ReturnType<typeof createRoiService>;
