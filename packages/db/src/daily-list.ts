import type { PoolClient } from 'pg';

// Technician daily list / batch print (modification.md #57): the appointments
// for a day range with everything a field sheet needs, in one query.
export type DailyListRow = {
  id: string;
  appointmentReference: string;
  appointmentDate: string;
  status: string;
  customerType: string;
  customerName: string;
  contactNumber: string | null;
  address: string | null;
  region: string | null;
  brand: string | null;
  model: string | null;
  itemCode: string | null;
  faultDescription: string;
  jobWarranty: string | null;
  salesOrderNumber: string | null;
  technicianId: string | null;
  technicianName: string | null;
  branchName: string | null;
  schoolContactPerson: string | null;
  schoolContactNumber: string | null;
  complaintReference: string | null;
  customerEmail: string | null;
  customerNumber: string | null;
  subGroup: string | null;
  salesman: string | null;
  complaintSource: string | null;
};

export const DAILY_LIST_LIMIT = 1000;

export async function listDailyAppointments(
  client: PoolClient,
  from: string,
  to: string,
  includeCancelled: boolean,
): Promise<{ rows: DailyListRow[]; truncated: boolean }> {
  const result = await client.query<DailyListRow>(
    `SELECT a.id::text AS id,
            a.appointment_reference AS "appointmentReference",
            a.appointment_date::text AS "appointmentDate",
            a.status,
            a.customer_type AS "customerType",
            a.customer_name AS "customerName",
            a.contact_number AS "contactNumber",
            a.address,
            a.region,
            a.brand,
            a.model,
            a.item_code AS "itemCode",
            a.fault_description AS "faultDescription",
            a.job_warranty AS "jobWarranty",
            a.sales_order_number AS "salesOrderNumber",
            a.technician_id::text AS "technicianId",
            t.name AS "technicianName",
            COALESCE(b.name, a.b2b_branch_school) AS "branchName",
            a.school_contact_person AS "schoolContactPerson",
            a.school_contact_number AS "schoolContactNumber",
            c.complaint_reference AS "complaintReference",
            a.customer_email AS "customerEmail",
            a.customer_number AS "customerNumber",
            a.sub_group AS "subGroup",
            a.salesman,
            a.complaint_source AS "complaintSource"
     FROM appointments a
     LEFT JOIN technicians t ON t.id = a.technician_id
     LEFT JOIN branches b ON b.id = a.branch_id
     LEFT JOIN complaints c ON c.id = a.complaint_id
     WHERE a.appointment_date BETWEEN $1::date AND $2::date
       AND ($3::boolean OR a.status <> 'Cancelled')
     ORDER BY a.appointment_date, t.name NULLS LAST, a.id
     LIMIT ${DAILY_LIST_LIMIT + 1}`,
    [from, to, includeCancelled],
  );
  const truncated = result.rows.length > DAILY_LIST_LIMIT;
  return { rows: truncated ? result.rows.slice(0, DAILY_LIST_LIMIT) : result.rows, truncated };
}
