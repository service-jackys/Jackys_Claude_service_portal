import type { PoolClient } from 'pg';
import { applyPlan, type ApplyResult } from './apply.js';
import type { AppointmentPlan, JobCardPlan, Plan } from './plan.js';
import { SOURCE_NAME } from './plan.js';

// "Sync" mode: bring the portal level with the old Google Sheet for
// Schedules (appointments) and Service job cards ONLY, without replacing
// anything the portal has added since the earlier imports.
//
//   1. Records that are new in the sheet are created (same code as a normal import).
//   2. Records that already exist are changed only where a reviewed decision
//      file says "take the sheet" for that field. Everything else, in
//      particular delivery dates, Delivered status, charges, invoice numbers
//      and billing set in the portal, stays exactly as it is.
//   3. Quotations, inspections, Thomson, AMC, VAS, complaints etc. are never touched.

export type Decision = {
  record: 'Appointment' | 'Job card';
  reference: string;
  field: string;
  take: boolean;
};

export type SyncChange = {
  record: 'Appointment' | 'Job card';
  reference: string;
  field: string;
  before: string;
  after: string;
};

export type SyncResult = ApplyResult & {
  changes: SyncChange[];
  recordsUpdated: { appointments: number; jobCards: number };
  statusChanges: number;
};

const APPOINTMENT_FIELDS = [
  'customer',
  'fault',
  'model',
  'itemCode',
  'warranty',
  'brand',
  'date',
  'address',
  'custNo',
  'status',
] as const;
const JOB_CARD_FIELDS = [
  'customer',
  'complaint',
  'serviceRendered',
  'invoiceNo',
  'deliveryDate',
  'totalCost',
  'serviceCharge',
  'grandTotal',
  'parts',
  'address',
  'warranty',
  'itemDesc',
  'brand',
  'model',
  'jobStatus',
] as const;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Reads the reviewed migration_review.csv. The decision sits in the "Group" column.
export function parseDecisions(csvText: string): Decision[] {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''));
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (n: string) => head.indexOf(n);
  const [iRec, iRef, iGroup, iField] = [
    col('record'),
    col('reference'),
    col('group'),
    col('field'),
  ];
  if ([iRec, iRef, iGroup, iField].some((i) => i < 0))
    throw new Error('The decision file needs the columns Record, Reference, Group and Field.');
  const out: Decision[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, n) => {
    const where = `decision file line ${n + 2}`;
    const record = r[iRec].trim();
    if (record !== 'Appointment' && record !== 'Job card')
      throw new Error(`${where}: Record must be Appointment or Job card, found "${record}".`);
    const field = r[iField].trim();
    const allowed: readonly string[] =
      record === 'Appointment' ? APPOINTMENT_FIELDS : JOB_CARD_FIELDS;
    if (!allowed.includes(field))
      throw new Error(`${where}: unknown field "${field}" for ${record}.`);
    const g = r[iGroup].trim().toLowerCase();
    const take = g.startsWith('take');
    if (!take && !g.startsWith('keep'))
      throw new Error(
        `${where}: Group must say "take the sheet" or "keep the portal", found "${r[iGroup]}".`,
      );
    const key = `${record}|${r[iRef].trim()}|${field}`;
    if (seen.has(key)) throw new Error(`${where}: ${r[iRef].trim()} ${field} appears twice.`);
    seen.add(key);
    out.push({ record, reference: r[iRef].trim(), field, take });
  });
  return out;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const day = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    return `${y}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
};

export async function applySync(
  client: PoolClient,
  plan: Plan,
  decisions: Decision[],
  options: { profileId: string; sourceFile: string },
): Promise<SyncResult> {
  // 1. New records only. Quotations, inspections and Thomson are left out on purpose.
  const narrowed: Plan = { ...plan, quotations: [], inspections: [], thomson: [] };
  const base = await applyPlan(client, narrowed, options);

  // 2. Reviewed field-by-field updates on records that already existed.
  const changes: SyncChange[] = [];
  const updatedApt = new Set<string>();
  const updatedJc = new Set<string>();
  let statusChanges = 0;
  const reason = 'Updated from Google Sheet (migration sync)';
  const aptByRef = new Map(plan.appointments.map((a) => [a.legacyRef, a]));
  const jcByLegacy = new Map(plan.jobCards.map((j) => [j.legacyRef, j]));

  // Appointments (portal reference = legacy reference).
  const aptDecisions = decisions.filter((d) => d.record === 'Appointment' && d.take);
  for (const refName of [...new Set(aptDecisions.map((d) => d.reference))]) {
    const a: AppointmentPlan | undefined = aptByRef.get(refName);
    if (!a) throw new Error(`${refName} is not in the sheet.`);
    const cur = await client.query(
      `SELECT ap.id::text, ap.customer_name, ap.fault_description, ap.model, ap.item_code, ap.job_warranty,
              ap.brand, ap.appointment_date, ap.address, ap.customer_number, ap.status
         FROM appointments ap
         JOIN legacy_references l ON l.entity_type = 'appointment' AND l.entity_id = ap.id AND l.source_name = $2
        WHERE ap.appointment_reference = $1`,
      [refName, SOURCE_NAME],
    );
    const r = cur.rows[0];
    if (!r)
      throw new Error(
        `${refName} is not an imported appointment in this database; nothing changed.`,
      );
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (field: string, col: string, before: string, after: unknown) => {
      if (!aptDecisions.some((d) => d.reference === refName && d.field === field)) return;
      if (before === text(after)) return;
      vals.push(after);
      sets.push(`${col} = $${vals.length}`);
      changes.push({
        record: 'Appointment',
        reference: refName,
        field,
        before,
        after: text(after),
      });
    };
    set('customer', 'customer_name', text(r.customer_name), a.customerName);
    set('fault', 'fault_description', text(r.fault_description), a.faultDescription);
    set('model', 'model', text(r.model), a.model);
    set('itemCode', 'item_code', text(r.item_code), a.itemCode);
    set('warranty', 'job_warranty', text(r.job_warranty), a.jobWarranty);
    set('brand', 'brand', text(r.brand), a.brand);
    set('date', 'appointment_date', day(r.appointment_date), a.appointmentDate);
    set('address', 'address', text(r.address), a.address);
    set('custNo', 'customer_number', text(r.customer_number), a.customerNumber);
    const statusChanged =
      aptDecisions.some((d) => d.reference === refName && d.field === 'status') &&
      r.status !== a.status;
    if (statusChanged) {
      vals.push(a.status);
      sets.push(`status = $${vals.length}`);
      vals.push(a.status === 'Scheduled' ? null : a.closedAt);
      sets.push(`closed_at = $${vals.length}`);
      changes.push({
        record: 'Appointment',
        reference: refName,
        field: 'status',
        before: text(r.status),
        after: a.status,
      });
    }
    if (!sets.length) continue;
    vals.push(options.profileId);
    sets.push(`updated_by = $${vals.length}`, 'updated_at = now()');
    vals.push(r.id);
    await client.query(
      `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals,
    );
    if (statusChanged) {
      statusChanges++;
      await client.query(
        `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.id, r.status, a.status, options.profileId, reason],
      );
    }
    updatedApt.add(refName);
  }

  // Job cards (the review file lists the portal reference JBC-/WJC-; the plan uses the sheet's JC-).
  const jcDecisions = decisions.filter((d) => d.record === 'Job card' && d.take);
  for (const refName of [...new Set(jcDecisions.map((d) => d.reference))]) {
    const cur = await client.query(
      `SELECT j.id::text, j.status, j.final_status, j.finalized_at, l.legacy_reference,
              j.customer_name, j.complaint, j.service_rendered, j.invoice_no, j.delivery_date,
              j.total_cost, j.service_charge, j.grand_total, j.parts, j.customer_address,
              j.warranty_status, j.final_warranty_status, j.item_description, j.brand, j.model_no,
              j.job_final_status, j.period_to, j.created_at
         FROM service_job_cards j
         JOIN legacy_references l ON l.entity_type = 'job_card' AND l.entity_id = j.id AND l.source_name = $2
        WHERE j.job_card_reference = $1`,
      [refName, SOURCE_NAME],
    );
    const r = cur.rows[0];
    if (!r)
      throw new Error(`${refName} is not an imported job card in this database; nothing changed.`);
    const j: JobCardPlan | undefined = jcByLegacy.get(r.legacy_reference);
    if (!j) throw new Error(`${refName} (${r.legacy_reference}) is not in the sheet.`);
    const wants = (field: string) =>
      jcDecisions.some((d) => d.reference === refName && d.field === field);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (field: string, col: string, before: string, after: unknown, cast = '') => {
      if (!wants(field)) return;
      const afterText =
        typeof after === 'object' && after !== null ? JSON.stringify(after) : text(after);
      if (before === afterText) return;
      vals.push(typeof after === 'object' && after !== null ? JSON.stringify(after) : after);
      sets.push(`${col} = $${vals.length}${cast}`);
      changes.push({ record: 'Job card', reference: refName, field, before, after: afterText });
    };
    const money = (v: unknown) =>
      v === null || v === undefined ? '' : String(Math.round(Number(v) * 100) / 100);
    set('customer', 'customer_name', text(r.customer_name), j.customerName);
    set('complaint', 'complaint', text(r.complaint), j.complaint);
    set('serviceRendered', 'service_rendered', text(r.service_rendered), j.serviceRendered);
    set('invoiceNo', 'invoice_no', text(r.invoice_no), j.invoiceNo);
    set('deliveryDate', 'delivery_date', day(r.delivery_date), j.deliveryDate);
    set('totalCost', 'total_cost', money(r.total_cost), j.totalCost);
    set('serviceCharge', 'service_charge', money(r.service_charge), j.serviceCharge);
    set('grandTotal', 'grand_total', money(r.grand_total), j.grandTotal);
    set('address', 'customer_address', text(r.customer_address), j.customerAddress);
    set('itemDesc', 'item_description', text(r.item_description), j.itemDescription);
    set('brand', 'brand', text(r.brand), j.brand);
    set('model', 'model_no', text(r.model_no), j.modelNo);
    const sheetParts = JSON.stringify(
      j.parts.map((p) => ({
        partNo: p.partNo,
        description: p.description,
        qty: p.qty,
        unitPrice: p.unitPrice,
      })),
    );
    if (wants('parts')) {
      const dbParts = JSON.stringify(
        (Array.isArray(r.parts) ? r.parts : []).map((p: Record<string, unknown>) => ({
          partNo: p.partNo,
          description: p.description,
          qty: p.qty,
          unitPrice: p.unitPrice,
        })),
      );
      if (dbParts !== sheetParts) {
        vals.push(JSON.stringify(j.parts));
        sets.push(`parts = $${vals.length}::jsonb`);
        changes.push({
          record: 'Job card',
          reference: refName,
          field: 'parts',
          before: dbParts,
          after: sheetParts,
        });
      }
    }
    if (wants('warranty') && text(r.warranty_status) !== text(j.warrantyStatus)) {
      vals.push(j.warrantyStatus);
      sets.push(`warranty_status = $${vals.length}`);
      // The final warranty status follows unless the portal already set it differently.
      if (text(r.final_warranty_status) === text(r.warranty_status) || !r.final_warranty_status)
        sets.push(`final_warranty_status = $${vals.length}`);
      changes.push({
        record: 'Job card',
        reference: refName,
        field: 'warranty',
        before: text(r.warranty_status),
        after: text(j.warrantyStatus),
      });
    }
    let newStatus: string | null = null;
    if (wants('jobStatus') && r.job_final_status !== j.jobFinalStatus) {
      vals.push(j.jobFinalStatus);
      sets.push(`job_final_status = $${vals.length}`);
      changes.push({
        record: 'Job card',
        reference: refName,
        field: 'jobStatus',
        before: text(r.job_final_status),
        after: j.jobFinalStatus,
      });
      // Same rule the import uses: still open until the job is closed.
      const open =
        r.final_status === null &&
        ['WIP', 'Spare pending', 'Customer approval pending'].includes(j.jobFinalStatus);
      const status = j.jobFinalStatus === 'Cancelled' ? 'Cancelled' : open ? 'Open' : 'Completed';
      if (status !== r.status) {
        newStatus = status;
        vals.push(status);
        sets.push(`status = $${vals.length}`);
        const stamp =
          status === 'Open' ? null : (r.finalized_at ?? j.periodTo ?? r.period_to ?? new Date());
        vals.push(stamp);
        sets.push(`finalized_at = $${vals.length}`);
        vals.push(status === 'Open' ? null : options.profileId);
        sets.push(`finalized_by = $${vals.length}`);
      }
    }
    if (!sets.length) continue;
    vals.push(options.profileId);
    sets.push(`updated_by = $${vals.length}`, 'updated_at = now()');
    vals.push(r.id);
    await client.query(
      `UPDATE service_job_cards SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals,
    );
    if (newStatus) {
      statusChanges++;
      await client.query(
        `INSERT INTO service_job_card_status_history (job_card_id, from_status, to_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.id, r.status, newStatus, options.profileId, reason],
      );
    }
    updatedJc.add(refName);
  }

  return {
    ...base,
    changes,
    recordsUpdated: { appointments: updatedApt.size, jobCards: updatedJc.size },
    statusChanges,
  };
}
