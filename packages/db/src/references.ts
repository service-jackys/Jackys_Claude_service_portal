import type { PoolClient } from 'pg';

// These five reference formats (appointment/job-card/quotation/inspection/
// warranty-approval) all encode only the YEAR, e.g. "APT-2026-00001" -- but
// each counter used to be keyed by the *exact* scope date it was called
// with (the appointment date, job date, etc.). Two different calendar
// dates in the same year each counted from 1 independently, so their
// formatted references collided as soon as both reached the same sequence
// number (see migration 016 / modification.md #22). Normalizing every
// lookup here to 1 January of that year means all allocations within a
// year now share one counter, matching what the format actually encodes.
// (Complaint references are exempt: CMP-YYMMDD-NNN encodes the full date,
// so allocateComplaintReference below still scopes by the exact date.)
function yearScope(scopeDate: string): string {
  return `${scopeDate.slice(0, 4)}-01-01`;
}

export async function allocateAppointmentReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('appointment', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('Appointment reference counter exceeded the supported five-digit range.');
  }
  return `APT-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}

export async function allocateJobCardReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('job_card', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('Job-card reference counter exceeded the supported five-digit range.');
  }
  return `JBC-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}

export async function allocateQuotationReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('quotation', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('Quotation reference counter exceeded the supported five-digit range.');
  }
  return `QO-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}

export async function allocateInspectionReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('inspection', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('Inspection reference counter exceeded the supported five-digit range.');
  }
  return `IR-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}

export async function allocateWarrantyApprovalReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('warranty_approval', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('Warranty approval reference counter exceeded the supported five-digit range.');
  }
  return `WA-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}

export async function allocateComplaintReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('complaint', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [scopeDate],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 999) {
    throw new Error('Complaint reference counter exceeded the supported three-digit range.');
  }
  return `CMP-${scopeDate.replaceAll('-', '').slice(2)}-${String(nextValue).padStart(3, '0')}`;
}

export async function allocateVasSaleReference(
  client: PoolClient,
  scopeDate: string,
): Promise<string> {
  const result = await client.query<{ nextValue: string }>(
    `INSERT INTO reference_counters (namespace, scope_date, next_value)
     VALUES ('vas_sale', $1, 2)
     ON CONFLICT (namespace, scope_date)
     DO UPDATE SET next_value = reference_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS "nextValue"`,
    [yearScope(scopeDate)],
  );
  const nextValue = Number(result.rows[0].nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 99999) {
    throw new Error('VAS sale reference counter exceeded the supported five-digit range.');
  }
  return `VS-${scopeDate.slice(0, 4)}-${String(nextValue).padStart(5, '0')}`;
}
