import type { PoolClient } from 'pg';

// Delivery & Installation transport rules (own copy of the 2-trip daily cap settings, migration 097).
// The Service Revenue Dashboard keeps its own row in revenue_transport_rules.

export interface DiTransportRules {
  dailyCap: boolean;
  deliveryOnlyCap: boolean;
  mixedInvoiceTransport: boolean;
  maxTrips: number;
}

export interface StoredDiTransportRules extends DiTransportRules {
  updatedAt: string | null;
  updatedByName: string | null;
}

type Q = Pick<PoolClient, 'query'>;

export const DEFAULT_DI_TRANSPORT_RULES: DiTransportRules = {
  dailyCap: true,
  deliveryOnlyCap: false,
  mixedInvoiceTransport: true,
  maxTrips: 2,
};

export async function getDiTransportRules(client: Q): Promise<StoredDiTransportRules> {
  const r = await client.query<StoredDiTransportRules>(
    `SELECT t.daily_cap AS "dailyCap", t.delivery_only_cap AS "deliveryOnlyCap",
            t.mixed_invoice_transport AS "mixedInvoiceTransport", t.max_trips::int AS "maxTrips",
            t.updated_at AS "updatedAt", p.display_name AS "updatedByName"
       FROM di_transport_rules t LEFT JOIN profiles p ON p.id = t.updated_by
      WHERE t.id = 1`,
  );
  return r.rows[0] ?? { ...DEFAULT_DI_TRANSPORT_RULES, updatedAt: null, updatedByName: null };
}

export async function saveDiTransportRules(
  client: Q,
  rules: DiTransportRules,
  profileId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO di_transport_rules (id, daily_cap, delivery_only_cap, mixed_invoice_transport, max_trips, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET daily_cap = $1, delivery_only_cap = $2, mixed_invoice_transport = $3,
       max_trips = $4, updated_by = $5, updated_at = now()`,
    [rules.dailyCap, rules.deliveryOnlyCap, rules.mixedInvoiceTransport, rules.maxTrips, profileId],
  );
}

export interface DiCapTrip {
  reference: string;
  deliveryNoteRef: string | null;
  kind: 'installation' | 'delivery';
  carrier: string;
  charge: number;
  rank: number;
  charged: boolean;
}

export interface DiCapDay {
  date: string;
  salesman: string;
  trips: DiCapTrip[];
}

/** What the saved rules do to the Completed jobs: totals, and the salesperson-days that went over the cap. */
export async function diTransportImpact(client: Q) {
  const totals = await client.query<{
    jobs: string;
    notCharged: string;
    removed: string;
    mixedRemoved: string;
  }>(
    `SELECT count(*)::text AS jobs,
            count(*) FILTER (WHERE x.removed > 0)::text AS "notCharged",
            COALESCE(sum(x.removed), 0)::text AS removed,
            COALESCE(sum(x.removed) FILTER (WHERE NOT c.capped OR c.trip_charge = 0), 0)::text AS "mixedRemoved"
       FROM di_job_trip_cap c
       CROSS JOIN LATERAL (
         SELECT c.stored_charge
                - CASE WHEN (NOT c.capped OR c.trip_rank <= c.max_trips) THEN c.trip_charge ELSE 0 END AS removed
       ) x`,
  );
  const rows = await client.query<{
    reference: string;
    date: string;
    salesman: string | null;
    deliveryNoteRef: string | null;
    kind: 'installation' | 'delivery';
    carrier: string;
    charge: string;
    rank: number;
    charged: boolean;
    maxTrips: number;
  }>(
    `WITH capped AS (
       SELECT c.*, d.reference,
              count(*) OVER (PARTITION BY c.service_date, lower(btrim(COALESCE(c.salesman, '')))) AS day_trips
         FROM di_job_trip_cap c JOIN di_jobs d ON d.id = c.job_id
        WHERE c.capped
     )
     SELECT reference, service_date::text AS date, salesman, delivery_note_ref AS "deliveryNoteRef",
            kind, carrier, trip_charge::text AS charge, trip_rank::int AS rank,
            (trip_rank <= max_trips) AS charged, max_trips::int AS "maxTrips"
       FROM capped
      WHERE day_trips > max_trips
      ORDER BY service_date DESC, lower(btrim(COALESCE(salesman, ''))), trip_rank
      LIMIT 300`,
  );
  const days: DiCapDay[] = [];
  for (const r of rows.rows) {
    const last = days[days.length - 1];
    const trip: DiCapTrip = {
      reference: r.reference,
      deliveryNoteRef: r.deliveryNoteRef,
      kind: r.kind,
      carrier: r.carrier,
      charge: Number(r.charge),
      rank: r.rank,
      charged: r.charged,
    };
    if (last && last.date === r.date && last.salesman === (r.salesman ?? '')) last.trips.push(trip);
    else days.push({ date: r.date, salesman: r.salesman ?? '', trips: [trip] });
  }
  const t = totals.rows[0]!;
  return {
    completedTripJobs: Number(t.jobs),
    tripsNotCharged: Number(t.notCharged),
    transportNotCharged: Math.round(Number(t.removed) * 100) / 100,
    daysOverCap: days.length,
    days,
  };
}
