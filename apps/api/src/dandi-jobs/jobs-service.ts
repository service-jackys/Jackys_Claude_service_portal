import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  searchB2bBranchesForStaff,
  findB2bBranchByCustCode,
} from '../../../../packages/db/src/b2b-branches.js';
import { listActiveBillingRules } from '../../../../packages/db/src/billing-rules.js';
import { settingsMap, setSetting } from '../../../../packages/db/src/budget-variance.js';
import {
  findDiItem,
  findDiJob,
  findDuplicateDeliveryNotes,
  insertDiJob,
  listDiJobs,
  markDiJobCancelled,
  markDiJobCompleted,
  markDiJobReopened,
  replaceDiJobLines,
  searchDiItems,
  updateDiJobHeader,
  type DiJobHeaderInput,
  type DiJobLineInput,
  type DiJobRecord,
  type DiJobStatus,
} from '../../../../packages/db/src/di-jobs.js';
import { allocateDiJobReference } from '../../../../packages/db/src/references.js';
import { findSalesmanByName } from '../../../../packages/db/src/salesmen.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { matchBillingRule } from '../job-cards/billing.js';
import { createPricingConfigService } from '../pricing-config/service.js';
import { engineMasterFromDandi } from './pricing-engine.js';
import { createDandiPricingService, priceNoteSchema, type PricedNote } from './service.js';

export const ERP_INV_SETTING = 'dandi_erp_inv_mandatory';

export class DiJobServiceError extends Error {
  constructor(
    public readonly code: 'not-found' | 'invalid' | 'conflict' | 'incomplete' | 'forbidden',
    message: string,
    public readonly messages: string[] = [],
  ) {
    super(message);
  }
}

const blankToNull = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim();
  return text ? text : null;
};

const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Enter a real date.');

export const diJobSaveSchema = z
  .object({
    serviceDate: dateText,
    custCode: z.string().trim().max(100).nullish(),
    salesman: z.string().trim().max(200).nullish(),
    region: z.string().trim().min(1).max(50),
    deliveryNoteRef: z.string().trim().max(100).nullish(),
    erpInvNo: z.string().trim().max(100).nullish(),
    csoscNo: z.string().trim().max(100).nullish(),
    notes: z.string().trim().max(1000).nullish(),
    lines: z
      .array(
        z
          .object({
            itemCode: z.string().trim().min(1).max(100),
            qty: z.number().positive().max(100000),
            type: z.enum(['CSIDI', 'CSIDO', 'CSIII']),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type DiJobSaveInput = z.infer<typeof diJobSaveSchema>;

export const diJobListQuerySchema = z
  .object({
    status: z.enum(['Draft', 'Completed', 'Cancelled']).optional(),
    from: dateText.optional(),
    to: dateText.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const diJobSettingsSchema = z.object({ erpInvMandatory: z.boolean() }).strict();

type Duplicate = { id: string; reference: string; status: DiJobStatus; serviceDate: string };

export function createDiJobService(pool: Pool) {
  const pricing = createDandiPricingService(pool);
  const pricingConfig = createPricingConfigService(pool);

  async function erpInvMandatory(client: PoolClient): Promise<boolean> {
    const settings = await settingsMap(client);
    return settings[ERP_INV_SETTING] === true;
  }

  /** Regions, salesmen with their channel, and the admin switch -- everything the form's dropdowns need. */
  async function options() {
    const dandi = (await pricingConfig.get('dandi_pricing')).payload as DandiPricingInput;
    const client = await pool.connect();
    try {
      const salesmen = await client.query<{ name: string; salesChannel: string | null }>(
        `SELECT name, sales_channel AS "salesChannel" FROM salesmen WHERE active ORDER BY name`,
      );
      return {
        regions: engineMasterFromDandi(dandi).transport.map((row) => row.region),
        salesmen: salesmen.rows,
        erpInvMandatory: await erpInvMandatory(client),
      };
    } finally {
      client.release();
    }
  }

  async function customers(query: string | undefined) {
    const client = await pool.connect();
    try {
      return { customers: await searchB2bBranchesForStaff(client, query) };
    } finally {
      client.release();
    }
  }

  async function items(query: string | undefined) {
    const term = (query ?? '').trim();
    if (term.length < 2) return { items: [] };
    const client = await pool.connect();
    try {
      return { items: await searchDiItems(client, term, 20) };
    } finally {
      client.release();
    }
  }

  async function price(input: unknown): Promise<PricedNote> {
    return pricing.price(priceNoteSchema.parse(input));
  }

  /** Customer (from the B2B master), salesman (master spelling) and the channel the salesman sells under. */
  async function resolveHeader(
    client: PoolClient,
    data: DiJobSaveInput,
  ): Promise<DiJobHeaderInput> {
    let custCode: string | null = null;
    let customerName: string | null = null;
    let branchSalesman: string | null = null;
    const wantedCode = blankToNull(data.custCode);
    if (wantedCode) {
      const branch = await findB2bBranchByCustCode(client, wantedCode);
      if (!branch) {
        throw new DiJobServiceError(
          'invalid',
          `Customer ${wantedCode} is not in the B2B customer list. Pick the customer from the list.`,
        );
      }
      custCode = branch.custCode;
      customerName = branch.branchName;
      branchSalesman = branch.salesman ?? null;
    }
    // The salesman defaults from the customer; the user can change it.
    const typedSalesman = blankToNull(data.salesman) ?? branchSalesman;
    let salesman = typedSalesman;
    let salesChannel: string | null = null;
    if (typedSalesman) {
      const record = await findSalesmanByName(client, typedSalesman);
      if (record) {
        salesman = record.name;
        salesChannel = record.salesChannel ?? null;
      }
    }
    return {
      serviceDate: data.serviceDate,
      custCode,
      customerName,
      salesman,
      salesChannel,
      region: data.region,
      deliveryNoteRef: blankToNull(data.deliveryNoteRef),
      erpInvNo: blankToNull(data.erpInvNo),
      csoscNo: blankToNull(data.csoscNo),
      notes: blankToNull(data.notes),
    };
  }

  /**
   * Copies the item facts and the category mapping result onto each line and
   * decides the line's sales channel: the channel of the salesman, unless a
   * billing rule (salesman + brand, for example) names another one.
   */
  async function resolveLines(
    client: PoolClient,
    header: DiJobHeaderInput,
    lines: DiJobSaveInput['lines'],
  ): Promise<DiJobLineInput[]> {
    const rules = await listActiveBillingRules(client);
    const out: DiJobLineInput[] = [];
    for (const line of lines) {
      const item = await findDiItem(client, line.itemCode);
      if (!item) {
        throw new DiJobServiceError(
          'invalid',
          `Item ${line.itemCode} is not in the stock master. Pick the item from the list.`,
        );
      }
      if (item.installable === false && line.type !== 'CSIDO') {
        throw new DiJobServiceError(
          'invalid',
          `${item.itemCode} is not installable, so it can only be Delivery only (CSIDO).`,
        );
      }
      const rule = matchBillingRule(rules, {
        salesman: header.salesman,
        b2bBranchSchool: header.customerName,
        brand: item.brand,
      });
      out.push({
        itemCode: item.itemCode,
        itemDesc: item.itemDesc,
        brand: item.brand,
        mainGroup: item.mainGroup,
        groupName: item.groupName,
        subGroup: item.subGroup,
        qty: line.qty,
        type: line.type,
        installable: item.installable,
        pricingCategory: item.pricingCategory,
        salesChannel: rule?.billToChannel ?? header.salesChannel,
      });
    }
    return out;
  }

  async function withDuplicates(client: PoolClient, id: string) {
    const job = await findDiJob(client, id);
    if (!job) throw new DiJobServiceError('not-found', 'Delivery & installation job not found.');
    const duplicates: Duplicate[] = job.deliveryNoteRef
      ? await findDuplicateDeliveryNotes(client, job.deliveryNoteRef, id)
      : [];
    return { job, duplicates };
  }

  async function list(query: unknown) {
    const filters = diJobListQuerySchema.parse(query ?? {});
    const client = await pool.connect();
    try {
      const result = await listDiJobs(client, filters);
      return { ...result, page: filters.page, pageSize: filters.pageSize };
    } finally {
      client.release();
    }
  }

  async function get(id: string) {
    const client = await pool.connect();
    try {
      return await withDuplicates(client, id);
    } finally {
      client.release();
    }
  }

  async function create(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = diJobSaveSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const header = await resolveHeader(client, data);
      const lines = await resolveLines(client, header, data.lines);
      const reference = await allocateDiJobReference(client, data.serviceDate);
      const job = await insertDiJob(client, reference, header, profileId);
      await replaceDiJobLines(client, job.id, lines);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.created',
        targetType: 'di_job',
        targetId: job.id,
        metadata: { reference, lines: lines.length, deliveryNoteRef: header.deliveryNoteRef },
        requestId,
      });
      return withDuplicates(client, job.id);
    });
  }

  async function update(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = diJobSaveSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const existing = await findDiJob(client, id, { lock: true });
      if (!existing)
        throw new DiJobServiceError('not-found', 'Delivery & installation job not found.');
      if (existing.status !== 'Draft') {
        throw new DiJobServiceError(
          'conflict',
          `${existing.reference} is ${existing.status}; only a Draft can be edited. Ask an administrator to reopen it.`,
        );
      }
      const header = await resolveHeader(client, data);
      const lines = await resolveLines(client, header, data.lines);
      await updateDiJobHeader(client, id, header, profileId);
      await replaceDiJobLines(client, id, lines);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.updated',
        targetType: 'di_job',
        targetId: id,
        metadata: { reference: existing.reference, lines: lines.length },
        requestId,
      });
      return withDuplicates(client, id);
    });
  }

  /**
   * Completing is the only point where a job becomes revenue: every required
   * field must be there, the price must be free of errors, and the figures are
   * frozen on the job and its lines.
   */
  async function complete(id: string, profileId: string, requestId: string = randomUUID()) {
    return withTransaction(pool, async (client) => {
      const mandatoryErp = await erpInvMandatory(client);
      const job = await findDiJob(client, id, { lock: true });
      if (!job) throw new DiJobServiceError('not-found', 'Delivery & installation job not found.');
      if (job.status !== 'Draft') {
        throw new DiJobServiceError('conflict', `${job.reference} is already ${job.status}.`);
      }
      const missing: string[] = [];
      if (!job.custCode) missing.push('Choose the customer (B2B).');
      if (!job.salesman) missing.push('Choose the salesman.');
      else if (!job.salesChannel) {
        missing.push(
          `Salesman ${job.salesman} has no sales channel. Contact the administrator to set it under Salesmen & channels.`,
        );
      }
      if (!job.deliveryNoteRef) missing.push('Enter the ERP delivery note (Ref Inv).');
      if (mandatoryErp && !job.erpInvNo) missing.push('Enter the ERP Inv No.');
      if (!job.lines.length) missing.push('Add at least one line.');
      if (missing.length) {
        throw new DiJobServiceError('incomplete', 'The job cannot be completed yet.', missing);
      }

      // Refresh the item facts and channels from the masters, then price.
      const header: DiJobHeaderInput = {
        serviceDate: job.serviceDate,
        custCode: job.custCode,
        customerName: job.customerName,
        salesman: job.salesman,
        salesChannel: job.salesChannel,
        region: job.region,
        deliveryNoteRef: job.deliveryNoteRef,
        erpInvNo: job.erpInvNo,
        csoscNo: job.csoscNo,
        notes: job.notes,
      };
      const lines = await resolveLines(
        client,
        header,
        job.lines.map((line) => ({ itemCode: line.itemCode, qty: line.qty, type: line.type })),
      );
      const priced = await pricing.price({
        region: job.region,
        lines: lines.map((line) => ({ itemCode: line.itemCode, qty: line.qty, type: line.type })),
      });
      if (!priced.ok) {
        throw new DiJobServiceError(
          'incomplete',
          'The price has errors, so the job cannot be completed.',
          priced.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message),
        );
      }
      const frozen = lines.map((line, i) => {
        const result = priced.lines[i]!;
        return {
          ...line,
          rateKind: result.rateKind,
          baseRate: result.baseRate,
          discountTier: result.discountTier,
          discountRate: result.discountRate,
          netRate: result.netRate,
          labour: result.labour,
          transport: result.transport,
          charge: result.charge,
          revenue: result.revenue,
          rateNote: result.note,
        };
      });
      await replaceDiJobLines(client, id, frozen);
      await markDiJobCompleted(
        client,
        id,
        {
          totalCsidi: priced.totals.CSIDI,
          totalCsido: priced.totals.CSIDO,
          totalCsiii: priced.totals.CSIII,
          totalRevenue: priced.totals.total,
        },
        profileId,
      );
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.completed',
        targetType: 'di_job',
        targetId: id,
        metadata: { reference: job.reference, totals: priced.totals },
        requestId,
      });
      return {
        ...(await withDuplicates(client, id)),
        warnings: priced.issues.filter((issue) => issue.level === 'warning'),
      };
    });
  }

  /** A Draft can be cancelled by whoever enters jobs; cancelling a Completed job removes revenue, so it needs the reopen right. */
  async function cancel(
    id: string,
    profileId: string,
    canReopen: boolean,
    requestId: string = randomUUID(),
  ) {
    return withTransaction(pool, async (client) => {
      const job = await findDiJob(client, id, { lock: true });
      if (!job) throw new DiJobServiceError('not-found', 'Delivery & installation job not found.');
      if (job.status === 'Cancelled') {
        throw new DiJobServiceError('conflict', `${job.reference} is already Cancelled.`);
      }
      if (job.status === 'Completed' && !canReopen) {
        throw new DiJobServiceError(
          'forbidden',
          `${job.reference} is Completed. Only an administrator can cancel a completed job.`,
        );
      }
      await markDiJobCancelled(client, id, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.cancelled',
        targetType: 'di_job',
        targetId: id,
        metadata: { reference: job.reference, wasStatus: job.status },
        requestId,
      });
      return withDuplicates(client, id);
    });
  }

  async function reopen(id: string, profileId: string, requestId: string = randomUUID()) {
    return withTransaction(pool, async (client) => {
      const job = await findDiJob(client, id, { lock: true });
      if (!job) throw new DiJobServiceError('not-found', 'Delivery & installation job not found.');
      if (job.status === 'Draft') {
        throw new DiJobServiceError('conflict', `${job.reference} is already a Draft.`);
      }
      await markDiJobReopened(client, id, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.reopened',
        targetType: 'di_job',
        targetId: id,
        metadata: {
          reference: job.reference,
          wasStatus: job.status,
          frozenTotal: job.totalRevenue,
        },
        requestId,
      });
      return withDuplicates(client, id);
    });
  }

  async function updateSettings(
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = diJobSettingsSchema.parse(input);
    return withTransaction(pool, async (client) => {
      await setSetting(client, ERP_INV_SETTING, data.erpInvMandatory, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'di_job.settings_changed',
        targetType: 'revenue_settings',
        metadata: { key: ERP_INV_SETTING, erpInvMandatory: data.erpInvMandatory },
        requestId,
      });
      return { erpInvMandatory: data.erpInvMandatory };
    });
  }

  return {
    options,
    customers,
    items,
    price,
    list,
    get,
    create,
    update,
    complete,
    cancel,
    reopen,
    updateSettings,
  };
}

export type DiJobService = ReturnType<typeof createDiJobService>;
export type { DiJobRecord };
