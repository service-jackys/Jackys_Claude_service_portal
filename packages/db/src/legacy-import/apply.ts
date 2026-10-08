import type { PoolClient } from 'pg';
import {
  allocateInspectionReference,
  allocateJobCardReference,
  allocateQuotationReference,
  allocateThomsonSaleReference,
  allocateWalkInJobCardReference,
} from '../references.js';
import { type Plan, SOURCE_NAME } from './plan.js';

// Writes a plan to the database inside ONE transaction (the caller owns it), so
// a failure leaves nothing half imported. Safe to re-run: anything already
// recorded in legacy_references is skipped.

export type ApplyResult = {
  batchId: string;
  created: Record<string, number>;
  skippedExisting: Record<string, number>;
};

const ENTITY = {
  technician: 'technician',
  appointment: 'appointment',
  jobCard: 'job_card',
  quotation: 'quotation',
  inspection: 'inspection',
  thomson: 'thomson_proposal',
} as const;

const yearOf = (date: string) => date.slice(0, 4);

export async function applyPlan(
  client: PoolClient,
  plan: Plan,
  options: { profileId: string; sourceFile: string },
): Promise<ApplyResult> {
  const created: Record<string, number> = {};
  const skippedExisting: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  const batch = await client.query<{ id: string }>(
    `INSERT INTO import_batches (source_name, status, initiated_by) VALUES ($1, 'started', $2) RETURNING id`,
    [SOURCE_NAME, options.profileId],
  );
  const batchId = batch.rows[0].id;

  const existing = async (type: string, ref: string): Promise<string | null> => {
    const r = await client.query<{ entity_id: string }>(
      `SELECT entity_id::text FROM legacy_references WHERE source_name = $1 AND entity_type = $2 AND legacy_reference = $3`,
      [SOURCE_NAME, type, ref],
    );
    return r.rows[0]?.entity_id ?? null;
  };
  const record = async (type: string, ref: string, id: string, row: number) => {
    await client.query(
      `INSERT INTO legacy_references (source_name, entity_type, legacy_reference, entity_id, import_batch_id, source_row, reconciliation_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'matched')`,
      [SOURCE_NAME, type, ref, id, batchId, row > 0 ? row : null],
    );
  };

  // ---- Technicians: match by name, create only what is missing ------------
  const techIds = new Map<string, string>();
  for (const t of plan.technicians) {
    const found = await client.query<{ id: string }>(
      `SELECT id::text FROM technicians WHERE lower(name) = lower($1) LIMIT 1`,
      [t.name],
    );
    if (found.rows[0]) {
      techIds.set(t.name.toLowerCase(), found.rows[0].id);
      bump(skippedExisting, 'technicians');
      continue;
    }
    // The sheet gives every technician the same shared service mailbox, but the
    // portal keeps email unique per technician: only the first one gets it.
    const emailTaken = t.email
      ? (await client.query(`SELECT 1 FROM technicians WHERE lower(email) = lower($1)`, [t.email]))
          .rowCount
      : 0;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO technicians (name, region, phone, email, active) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
      [t.name, t.region, t.phone, emailTaken ? null : t.email, t.active],
    );
    techIds.set(t.name.toLowerCase(), ins.rows[0].id);
    await record(ENTITY.technician, t.legacyRef, ins.rows[0].id, t.row);
    bump(created, 'technicians');
  }

  // ---- Appointments: the sheet already uses the portal's APT reference ----
  const aptIds = new Map<string, string>();
  const maxSeq = new Map<string, number>(); // year -> highest sequence imported
  for (const a of plan.appointments) {
    const prior = await existing(ENTITY.appointment, a.legacyRef);
    if (prior) {
      aptIds.set(a.legacyRef, prior);
      bump(skippedExisting, 'appointments');
      continue;
    }
    const clash = await client.query(
      `SELECT 1 FROM appointments WHERE appointment_reference = $1`,
      [a.legacyRef],
    );
    if (clash.rowCount) {
      throw new Error(
        `Appointment reference ${a.legacyRef} already exists in the database and was not imported by this tool. Clear test data first.`,
      );
    }
    const techId = a.technicianName ? (techIds.get(a.technicianName.toLowerCase()) ?? null) : null;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO appointments (
         appointment_reference, technician_id, customer_type, customer_name, contact_number, customer_email,
         address, region, brand, model, item_code, fault_description, job_warranty, sales_order_number,
         appointment_date, status, closed_at, created_at, updated_at, created_by, updated_by,
         b2b_branch_school, school_contact_person, school_contact_number, customer_number, sub_group
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18, $19, $19,
         $20, $21, $22, $23, $24
       ) RETURNING id::text`,
      [
        a.legacyRef,
        techId,
        a.customerType,
        a.customerName,
        a.contactNumber,
        a.customerEmail,
        a.address,
        a.region,
        a.brand,
        a.model,
        a.itemCode,
        a.faultDescription,
        a.jobWarranty,
        a.salesOrderNumber,
        a.appointmentDate,
        a.status,
        a.closedAt,
        a.createdAt,
        options.profileId,
        a.b2bBranchSchool,
        a.schoolContactPerson,
        a.schoolContactNumber,
        a.customerNumber,
        a.subGroup,
      ],
    );
    const id = ins.rows[0].id;
    aptIds.set(a.legacyRef, id);
    await client.query(
      `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, $2, $3, 'Imported from Google Sheet')`,
      [id, a.status, options.profileId],
    );
    await record(ENTITY.appointment, a.legacyRef, id, a.row);
    bump(created, 'appointments');
    const m = /^APT-(\d{4})-(\d{5})$/.exec(a.legacyRef);
    if (m) maxSeq.set(m[1], Math.max(maxSeq.get(m[1]) ?? 0, Number(m[2])));
  }
  // Future portal-issued APT numbers continue after the imported ones.
  for (const [year, seq] of maxSeq) {
    await client.query(
      `INSERT INTO reference_counters (namespace, scope_date, next_value) VALUES ('appointment', $1, $2)
       ON CONFLICT (namespace, scope_date) DO UPDATE SET next_value = GREATEST(reference_counters.next_value, EXCLUDED.next_value), updated_at = now()`,
      [`${year}-01-01`, seq + 1],
    );
  }

  // ---- Quotations (before job cards and inspections that may refer to them)
  const quoIds = new Map<string, string>();
  const quoRefs = new Map<string, string>();
  for (const q of [...plan.quotations].sort((x, y) =>
    x.legacyRef.localeCompare(y.legacyRef, 'en', { numeric: true }),
  )) {
    const prior = await existing(ENTITY.quotation, q.legacyRef);
    if (prior) {
      quoIds.set(q.legacyRef, prior);
      bump(skippedExisting, 'quotations');
      continue;
    }
    const reference = await allocateQuotationReference(client, q.quotationDate);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO quotations (
         quotation_reference, quotation_date, customer_name, contact_number, project_name, site_location,
         date_of_collection, technician_name, customer_complaint, technical_diagnosis, products, parts,
         labour_amount, grand_total, prepared_by, prepared_date, approved_by, approved_date,
         customer_signature, signature_date, legacy_reference, created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,$23,$23)
       RETURNING id::text`,
      [
        reference,
        q.quotationDate,
        q.customerName,
        q.contactNumber,
        q.projectName,
        q.siteLocation,
        q.dateOfCollection,
        q.technicianName,
        q.customerComplaint,
        q.technicalDiagnosis,
        JSON.stringify(q.products),
        JSON.stringify(q.parts),
        q.labourAmount,
        q.grandTotal,
        q.preparedBy,
        q.preparedDate,
        q.approvedBy,
        q.approvedDate,
        q.customerSignature,
        q.signatureDate,
        q.legacyRef,
        q.createdAt,
        options.profileId,
      ],
    );
    quoIds.set(q.legacyRef, ins.rows[0].id);
    quoRefs.set(q.legacyRef, reference);
    await record(ENTITY.quotation, q.legacyRef, ins.rows[0].id, q.row);
    bump(created, 'quotations');
  }

  // ---- Inspections ----------------------------------------------------------
  for (const i of [...plan.inspections].sort((x, y) =>
    x.legacyRef.localeCompare(y.legacyRef, 'en', { numeric: true }),
  )) {
    const prior = await existing(ENTITY.inspection, i.legacyRef);
    if (prior) {
      bump(skippedExisting, 'inspections');
      continue;
    }
    const reference = await allocateInspectionReference(client, i.inspectionDate);
    const refQuotation = i.refQuotationNo
      ? (quoRefs.get(i.refQuotationNo) ?? i.refQuotationNo)
      : null;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO inspections (
         inspection_reference, inspection_date, customer_name, contact_number, project_name, site_location,
         date_of_collection, technician_name, customer_complaint, visual_findings, technical_diagnosis,
         products, faulty_parts, recommended_action, ref_quotation_no, warranty_status, est_repair_cost,
         inspected_by, inspected_date, reviewed_by, reviewed_date, customer_signature, signature_date,
         legacy_reference, created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25,$26,$26)
       RETURNING id::text`,
      [
        reference,
        i.inspectionDate,
        i.customerName,
        i.contactNumber,
        i.projectName,
        i.siteLocation,
        i.dateOfCollection,
        i.technicianName,
        i.customerComplaint,
        i.visualFindings,
        i.technicalDiagnosis,
        JSON.stringify(i.products),
        JSON.stringify(i.faultyParts),
        i.recommendedAction,
        refQuotation,
        i.warrantyStatus,
        i.estRepairCost,
        i.inspectedBy,
        i.inspectedDate,
        i.reviewedBy,
        i.reviewedDate,
        i.customerSignature,
        i.signatureDate,
        i.legacyRef,
        i.createdAt,
        options.profileId,
      ],
    );
    await record(ENTITY.inspection, i.legacyRef, ins.rows[0].id, i.row);
    bump(created, 'inspections');
  }

  // ---- Job cards --------------------------------------------------------------
  const aptByRef = new Map(plan.appointments.map((a) => [a.legacyRef, a]));
  const sortedJcs = [...plan.jobCards].sort((x, y) =>
    x.legacyRef.localeCompare(y.legacyRef, 'en', { numeric: true }),
  );
  for (const j of sortedJcs) {
    const prior = await existing(ENTITY.jobCard, j.legacyRef);
    if (prior) {
      bump(skippedExisting, 'jobCards');
      continue;
    }
    const appointment = j.appointmentRef ? aptByRef.get(j.appointmentRef) : undefined;
    const appointmentId = j.appointmentRef ? (aptIds.get(j.appointmentRef) ?? null) : null;
    const sourceType = appointmentId ? 'Scheduler' : 'Walk-in';
    const reference = appointmentId
      ? await allocateJobCardReference(client, j.jobCardDate)
      : await allocateWalkInJobCardReference(client, j.jobCardDate);

    const open = j.jobFinalStatus === 'WIP' || j.jobFinalStatus === 'Spare pending';
    const status = j.jobFinalStatus === 'Cancelled' ? 'Cancelled' : open ? 'Open' : 'Completed';
    const finalised = status === 'Completed' || status === 'Cancelled';
    const finalisedAt = finalised
      ? j.deliveryDate
        ? new Date(`${j.deliveryDate}T12:00:00+04:00`)
        : (j.periodTo ?? j.createdAt)
      : null;

    const notes: string[] = [];
    if (j.legacyAttachmentLinks.length)
      notes.push(`Legacy attachments (Google Drive): ${j.legacyAttachmentLinks.join(' ')}`);
    if (j.duplicateOf)
      notes.push(
        `Imported without an appointment link: ${j.sourceAppointmentRef} already had ${j.duplicateOf}.`,
      );

    const ins = await client.query<{ id: string }>(
      `INSERT INTO service_job_cards (
         job_card_reference, appointment_id, status, finalized_at, finalized_by, created_at, updated_at,
         created_by, updated_by, source_type, job_card_date, customer_name, customer_contact, customer_address,
         item_description, model_no, warranty_status, complaint, service_rendered, period_from, period_to,
         time_consumed_hours, parts, total_cost, service_charge, grand_total, amount_chargeable, invoice_no,
         delivery_date, technician_name, brand, job_final_status, school_contact_person, school_contact_number,
         customer_number, legacy_reference, customer_type, customer_email, region, b2b_branch_school,
         sales_order_number, item_code, sub_group, final_warranty_status, billing_job_type, condition_notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
         $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44
       ) RETURNING id::text`,
      [
        reference,
        appointmentId,
        status,
        finalisedAt,
        finalised ? options.profileId : null,
        j.createdAt,
        options.profileId,
        sourceType,
        j.jobCardDate,
        j.customerName,
        j.customerContact,
        j.customerAddress,
        j.itemDescription,
        j.modelNo,
        j.warrantyStatus,
        j.complaint,
        j.serviceRendered,
        j.periodFrom,
        j.periodTo,
        j.timeConsumedHours,
        JSON.stringify(j.parts),
        j.totalCost,
        j.serviceCharge,
        j.grandTotal,
        j.amountChargeable,
        j.invoiceNo,
        j.deliveryDate,
        j.technicianName,
        j.brand,
        j.jobFinalStatus,
        j.schoolContactPerson,
        j.schoolContactNumber,
        j.customerNumber,
        j.legacyRef,
        appointment?.customerType ?? null,
        appointment?.customerEmail ?? null,
        appointment?.region ?? null,
        appointment?.b2bBranchSchool ?? null,
        appointment?.salesOrderNumber ?? null,
        appointment?.itemCode ?? null,
        appointment?.subGroup ?? null,
        j.warrantyStatus,
        j.billingJobType,
        notes.length ? notes.join('\n') : null,
      ],
    );
    const id = ins.rows[0].id;
    await client.query(
      `INSERT INTO service_job_card_status_history (job_card_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, $2, $3, 'Imported from Google Sheet')`,
      [id, status, options.profileId],
    );
    await record(ENTITY.jobCard, j.legacyRef, id, j.row);
    bump(created, 'jobCards');
  }

  // ---- Thomson proposals -------------------------------------------------------
  for (const t of [...plan.thomson].sort((x, y) =>
    x.legacyRef.localeCompare(y.legacyRef, 'en', { numeric: true }),
  )) {
    const prior = await existing(ENTITY.thomson, t.legacyRef);
    if (prior) {
      bump(skippedExisting, 'thomson');
      continue;
    }
    const reference = await allocateThomsonSaleReference(client, t.saleDate);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO thomson_sales (
         thomson_sale_reference, sale_date, client_name, contact_number, site_location, transport_share_percent,
         line_items, total_price, total_cost, margin, created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$12) RETURNING id::text`,
      [
        reference,
        t.saleDate,
        t.clientName,
        t.contactNumber,
        t.siteLocation,
        t.transportSharePercent,
        JSON.stringify(t.lineItems),
        t.totalPrice,
        t.totalCost,
        t.margin,
        t.createdAt,
        options.profileId,
      ],
    );
    await record(ENTITY.thomson, t.legacyRef, ins.rows[0].id, t.row);
    bump(created, 'thomson');
  }

  await client.query(
    `UPDATE import_batches SET status = 'completed', completed_at = now() WHERE id = $1`,
    [batchId],
  );
  void yearOf;
  return { batchId, created, skippedExisting };
}

// Counts and money totals read back from the database for the imported rows,
// to set beside the plan. Any difference is a reconciliation failure.
export async function verifyParity(client: PoolClient, plan: Plan) {
  const count = async (type: string) =>
    Number(
      (
        await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM legacy_references WHERE source_name = $1 AND entity_type = $2`,
          [SOURCE_NAME, type],
        )
      ).rows[0].n,
    );
  const sum = async (sql: string) =>
    Number((await client.query<{ s: string }>(sql, [SOURCE_NAME])).rows[0].s ?? 0);
  const jcSum = (col: string) =>
    sum(`SELECT COALESCE(sum(j.${col}), 0)::text AS s FROM service_job_cards j
         JOIN legacy_references l ON l.entity_id = j.id AND l.entity_type = 'job_card' AND l.source_name = $1`);
  const planSum = (f: (j: Plan['jobCards'][number]) => number) =>
    plan.jobCards.reduce((s, j) => s + f(j), 0);
  const checks = [
    { name: 'Appointments', plan: plan.appointments.length, db: await count('appointment') },
    { name: 'Job cards', plan: plan.jobCards.length, db: await count('job_card') },
    { name: 'Quotations', plan: plan.quotations.length, db: await count('quotation') },
    { name: 'Inspections', plan: plan.inspections.length, db: await count('inspection') },
    { name: 'Thomson proposals', plan: plan.thomson.length, db: await count('thomson_proposal') },
    {
      name: 'Job card service charge (AED)',
      plan: planSum((j) => j.serviceCharge),
      db: await jcSum('service_charge'),
    },
    {
      name: 'Job card parts cost (AED)',
      plan: planSum((j) => j.totalCost),
      db: await jcSum('total_cost'),
    },
    {
      name: 'Job card grand total (AED)',
      plan: planSum((j) => j.grandTotal),
      db: await jcSum('grand_total'),
    },
    {
      name: 'Quotation grand total (AED)',
      plan: plan.quotations.reduce((s, q) => s + q.grandTotal, 0),
      db: await sum(`SELECT COALESCE(sum(q.grand_total), 0)::text AS s FROM quotations q
                     JOIN legacy_references l ON l.entity_id = q.id AND l.entity_type = 'quotation' AND l.source_name = $1`),
    },
    {
      name: 'Thomson total price (AED)',
      plan: plan.thomson.reduce((s, t) => s + t.totalPrice, 0),
      db: await sum(`SELECT COALESCE(sum(t.total_price), 0)::text AS s FROM thomson_sales t
                     JOIN legacy_references l ON l.entity_id = t.id AND l.entity_type = 'thomson_proposal' AND l.source_name = $1`),
    },
  ];
  return checks.map((c) => ({ ...c, ok: Math.abs(c.plan - c.db) < 0.005 }));
}
