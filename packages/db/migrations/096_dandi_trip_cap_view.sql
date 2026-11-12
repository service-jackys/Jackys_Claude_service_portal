-- Delivery & Installation: the 2-trip daily cap on installation transport, applied when the figures
-- are READ (Billing, Portal vs Excel comparison, Budget vs Actual), never to the Service Revenue
-- Dashboard, which keeps reading the uploaded master workbook only.
--
-- The rules are the ones the dashboard uses (revenue_transport_rules, one row, set by an admin on the
-- Transport rules tab). The cap groups trips by the portal's SERVICE DATE and the salesman. Within a
-- salesman's day the highest transport charges are charged first; equal charges are ordered by the ERP
-- delivery note (Ref Inv). Delivery-only notes are outside the cap unless the admin switches the
-- "Delivery-only cap" on. The figures saved when a job was completed are not changed: they stay the full
-- (pre-cap) price, and the views below take the uncharged transport off the carrying line.

-- One row per Completed job that carries a trip charge.
CREATE OR REPLACE VIEW di_job_trip_cap AS
WITH rules AS (
  SELECT daily_cap, delivery_only_cap, mixed_invoice_transport, max_trips::int AS max_trips
    FROM revenue_transport_rules WHERE id = 1
  UNION ALL
  SELECT true, false, true, 2
   WHERE NOT EXISTS (SELECT 1 FROM revenue_transport_rules WHERE id = 1)
),
jobs AS (
  SELECT d.id AS job_id, d.service_date, d.salesman, d.delivery_note_ref,
         COALESCE(sum(l.qty) FILTER (WHERE l.txn_type = 'CSIDI'), 0) AS csidi_qty,
         COALESCE(sum(l.transport) FILTER (WHERE l.txn_type = 'CSIDI'), 0) AS csidi_transport,
         COALESCE(sum(l.charge) FILTER (WHERE l.txn_type = 'CSIDO'), 0) AS csido_charge,
         (array_agg(l.id ORDER BY l.line_no)
            FILTER (WHERE l.txn_type = 'CSIDI' AND COALESCE(l.transport, 0) > 0))[1] AS csidi_line,
         (array_agg(l.id ORDER BY l.line_no)
            FILTER (WHERE l.txn_type = 'CSIDO' AND COALESCE(l.charge, 0) > 0))[1] AS csido_line
    FROM di_jobs d JOIN di_job_lines l ON l.job_id = d.id
   WHERE d.status = 'Completed'
   GROUP BY d.id
),
trips AS (
  SELECT j.*,
         CASE WHEN j.csidi_transport > 0 THEN 'installation'
              WHEN j.csidi_qty > 0 AND j.csido_charge > 0 THEN 'installation'
              WHEN j.csido_charge > 0 THEN 'delivery' END AS kind,
         CASE WHEN j.csidi_transport > 0 THEN 'CSIDI'
              WHEN j.csido_charge > 0 THEN 'CSIDO' END AS carrier,
         CASE WHEN j.csidi_transport > 0 THEN j.csidi_line ELSE j.csido_line END AS carrier_line,
         CASE WHEN j.csidi_transport > 0 THEN j.csidi_transport ELSE j.csido_charge END AS stored_charge
    FROM jobs j
   WHERE j.csidi_transport > 0 OR j.csido_charge > 0
),
priced AS (
  SELECT t.*, r.daily_cap, r.delivery_only_cap, r.max_trips,
         -- Mixed-invoice transport OFF: a note with 1 installed unit plus delivery-only items pays nothing extra.
         CASE WHEN t.kind = 'installation' AND t.carrier = 'CSIDO' AND t.csidi_qty <= 1
                   AND NOT r.mixed_invoice_transport THEN 0
              ELSE t.stored_charge END AS trip_charge
    FROM trips t CROSS JOIN rules r
),
ranked AS (
  SELECT p.*,
         (p.daily_cap AND p.trip_charge > 0
            AND (p.kind = 'installation' OR (p.kind = 'delivery' AND p.delivery_only_cap))) AS capped
    FROM priced p
)
SELECT r.job_id, r.service_date, r.salesman, r.delivery_note_ref, r.kind, r.carrier, r.carrier_line,
       r.stored_charge, r.trip_charge, r.max_trips, r.capped,
       CASE WHEN r.capped THEN row_number() OVER (
              PARTITION BY r.capped, r.service_date, lower(btrim(COALESCE(r.salesman, '')))
              ORDER BY r.trip_charge DESC,
                       CASE WHEN btrim(COALESCE(r.delivery_note_ref, '')) ~ '^[0-9]+$'
                            THEN lpad(btrim(r.delivery_note_ref), 30, '0')
                            ELSE lower(btrim(COALESCE(r.delivery_note_ref, ''))) END,
                       r.job_id) END AS trip_rank
  FROM ranked r;

-- One row per Completed job line: the figure to bill under the active rules.
CREATE OR REPLACE VIEW di_line_effective AS
SELECT l.id AS line_id, l.job_id, COALESCE(l.revenue, 0) AS stored_revenue,
       GREATEST(COALESCE(l.revenue, 0) - COALESCE(x.removed, 0), 0) AS effective_revenue,
       COALESCE(x.removed, 0) AS removed_amount,
       x.trip_rank, x.max_trips, x.trip_charge, x.kind AS trip_kind, x.charged AS trip_charged,
       (COALESCE(x.removed, 0) > 0) AS transport_removed
  FROM di_job_lines l
  JOIN di_jobs d ON d.id = l.job_id AND d.status = 'Completed'
  LEFT JOIN (
    SELECT c.job_id, c.carrier_line, c.trip_rank, c.max_trips, c.trip_charge, c.kind,
           (NOT c.capped OR c.trip_rank <= c.max_trips) AS charged,
           c.stored_charge
             - CASE WHEN (NOT c.capped OR c.trip_rank <= c.max_trips) THEN c.trip_charge ELSE 0 END AS removed
      FROM di_job_trip_cap c
  ) x ON x.carrier_line = l.id;
