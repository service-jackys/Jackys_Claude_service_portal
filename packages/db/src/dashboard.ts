import type { PoolClient } from 'pg';

export type StatusCounts = Record<string, number>;

export type DashboardSummary = {
  complaints: { byStatus: StatusCounts; total: number };
  appointments: { byStatus: StatusCounts; total: number; today: number };
  jobCards: { byStatus: StatusCounts; total: number };
  quotations: { total: number; thisMonth: number };
  inspections: { total: number; thisMonth: number };
  warrantyApprovals: { byStatus: StatusCounts; total: number };
  // VAS sales issued (modification.md #36) -- same total/thisMonth shape as
  // quotations/inspections above.
  vasSales: { total: number; thisMonth: number };
  // AMC contracts issued (modification.md #38) -- same shape again.
  amcContracts: { total: number; thisMonth: number };
  // Rate Card sales issued (modification.md #43) -- same shape again.
  rateCardSales: { total: number; thisMonth: number };
};

async function statusCounts(
  client: PoolClient,
  table: string,
  statusColumn = 'status',
): Promise<{ byStatus: StatusCounts; total: number }> {
  const result = await client.query<{ status: string; count: string }>(
    `SELECT ${statusColumn} AS status, count(*)::text AS count FROM ${table} GROUP BY ${statusColumn}`,
  );
  const byStatus: StatusCounts = {};
  let total = 0;
  for (const row of result.rows) {
    const count = Number(row.count);
    byStatus[row.status] = count;
    total += count;
  }
  return { byStatus, total };
}

async function simpleTotal(client: PoolClient, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0].count);
}

async function monthToDateTotal(
  client: PoolClient,
  table: string,
  dateColumn: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}
     WHERE ${dateColumn} >= date_trunc('month', now())`,
  );
  return Number(result.rows[0].count);
}

/** Operational summary for the staff dashboard (Phase 5 -- docs/
 *  DEVELOPMENT_PLAN.md: "Add service reports and operational dashboard
 *  summaries"). Deliberately covers the day-to-day service workflows only --
 *  revenue/pricing reporting and reconciliation is Phase 6 scope. */
export async function getDashboardSummary(client: PoolClient): Promise<DashboardSummary> {
  const [
    complaints,
    appointments,
    appointmentsToday,
    jobCards,
    quotationsTotal,
    quotationsMonth,
    inspectionsTotal,
    inspectionsMonth,
    warrantyApprovals,
    vasSalesTotal,
    vasSalesMonth,
    amcContractsTotal,
    amcContractsMonth,
    rateCardSalesTotal,
    rateCardSalesMonth,
  ] = await Promise.all([
    statusCounts(client, 'complaints'),
    statusCounts(client, 'appointments'),
    client
      .query<{ count: string }>(
        `SELECT count(*)::text AS count FROM appointments WHERE appointment_date = current_date`,
      )
      .then((result) => Number(result.rows[0].count)),
    statusCounts(client, 'service_job_cards'),
    simpleTotal(client, 'quotations'),
    monthToDateTotal(client, 'quotations', 'created_at'),
    simpleTotal(client, 'inspections'),
    monthToDateTotal(client, 'inspections', 'created_at'),
    statusCounts(client, 'warranty_approvals'),
    simpleTotal(client, 'vas_sales'),
    monthToDateTotal(client, 'vas_sales', 'created_at'),
    simpleTotal(client, 'amc_contracts'),
    monthToDateTotal(client, 'amc_contracts', 'created_at'),
    simpleTotal(client, 'rate_card_sales'),
    monthToDateTotal(client, 'rate_card_sales', 'created_at'),
  ]);

  return {
    complaints,
    appointments: { ...appointments, today: appointmentsToday },
    jobCards,
    quotations: { total: quotationsTotal, thisMonth: quotationsMonth },
    inspections: { total: inspectionsTotal, thisMonth: inspectionsMonth },
    warrantyApprovals,
    vasSales: { total: vasSalesTotal, thisMonth: vasSalesMonth },
    amcContracts: { total: amcContractsTotal, thisMonth: amcContractsMonth },
    rateCardSales: { total: rateCardSalesTotal, thisMonth: rateCardSalesMonth },
  };
}
