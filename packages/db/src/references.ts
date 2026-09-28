import type { PoolClient } from 'pg';

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
    [scopeDate],
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
    [scopeDate],
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
    [scopeDate],
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
    [scopeDate],
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
    [scopeDate],
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
