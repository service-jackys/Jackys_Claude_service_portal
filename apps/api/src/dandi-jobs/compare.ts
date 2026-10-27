// Portal vs master workbook: lines the workbook (Revenue Source) holds for CSIDI,
// CSIDO and CSIII, set against the Completed jobs entered in the portal. A pure
// function so the rules can be tested without a database.
//
// A workbook "Inv/Del No" is matched to a portal job by the ERP delivery note
// (Ref Inv) or by the ERP Inv No -- whichever the workbook line carries.

export type DandiType = 'CSIDI' | 'CSIDO' | 'CSIII';
export const DANDI_TYPES: DandiType[] = ['CSIDI', 'CSIDO', 'CSIII'];

export type WorkbookLine = {
  jobType: string;
  invDelNo: string | null;
  customer: string | null;
  salesPerson: string | null;
  salesChannel: string | null;
  orderDate: string | null;
  qty: number;
  revenue: number;
};

export type PortalJob = {
  id: string;
  reference: string;
  serviceDate: string;
  customerName: string | null;
  salesman: string | null;
  deliveryNoteRef: string | null;
  erpInvNo: string | null;
  /** Sales channels of the job's lines. */
  channels: string[];
  types: Record<DandiType, { qty: number; revenue: number }>;
};

export type TypeTotals = Record<DandiType, { qty: number; revenue: number }>;

export type CompareRow = {
  status: 'match' | 'differs' | 'only-excel' | 'only-portal';
  /** The workbook Inv/Del No, or the portal job's delivery note when the workbook has none. */
  key: string;
  customer: string | null;
  date: string | null;
  excel: (TypeTotals & { total: number }) | null;
  portal: (TypeTotals & { total: number }) | null;
  /** Portal minus Excel. */
  difference: number;
  jobs: { id: string; reference: string; serviceDate: string; matchedBy: string }[];
  notes: string[];
};

export type CompareResult = {
  month: string;
  summary: {
    byType: Record<
      DandiType,
      {
        excelQty: number;
        excelRevenue: number;
        portalQty: number;
        portalRevenue: number;
        difference: number;
      }
    >;
    excelTotal: number;
    portalTotal: number;
    difference: number;
    counts: { match: number; differs: number; onlyExcel: number; onlyPortal: number };
  };
  rows: CompareRow[];
};

export type CompareOptions = {
  month: string;
  tolerance?: number;
  /** Salesman as written -> master spelling (aliases). Unknown names come back as they are. */
  resolveSalesman: (name: string) => string;
  /** Portal channel -> the name the workbook uses (reporting name). */
  reportingName: (channel: string) => string;
};

const norm = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const emptyTotals = (): TypeTotals => ({
  CSIDI: { qty: 0, revenue: 0 },
  CSIDO: { qty: 0, revenue: 0 },
  CSIII: { qty: 0, revenue: 0 },
});
const withTotal = (t: TypeTotals) => ({
  ...t,
  total: round2(t.CSIDI.revenue + t.CSIDO.revenue + t.CSIII.revenue),
});

export function compareDandi(
  workbook: WorkbookLine[],
  jobs: PortalJob[],
  options: CompareOptions,
): CompareResult {
  const tolerance = options.tolerance ?? 0.005;
  const monthOf = (date: string | null) => (date ?? '').slice(0, 7);

  // Workbook lines grouped by Inv/Del No.
  type Group = {
    key: string;
    lines: WorkbookLine[];
    totals: TypeTotals;
    jobs: { job: PortalJob; matchedBy: string }[];
  };
  const groups = new Map<string, Group>();
  for (const line of workbook) {
    const type = norm(line.jobType) as DandiType;
    if (!DANDI_TYPES.includes(type)) continue;
    const key = norm(line.invDelNo) || '(no Inv/Del No)';
    let group = groups.get(key);
    if (!group) {
      group = { key, lines: [], totals: emptyTotals(), jobs: [] };
      groups.set(key, group);
    }
    group.lines.push(line);
    group.totals[type].qty += Number(line.qty) || 0;
    group.totals[type].revenue += Number(line.revenue) || 0;
  }

  // Portal jobs: to the group their delivery note, or else their ERP Inv No, names.
  const unmatchedJobs: PortalJob[] = [];
  for (const job of jobs) {
    const byNote = norm(job.deliveryNoteRef);
    const byInv = norm(job.erpInvNo);
    if (byNote && groups.has(byNote))
      groups.get(byNote)!.jobs.push({ job, matchedBy: 'Delivery note' });
    else if (byInv && groups.has(byInv))
      groups.get(byInv)!.jobs.push({ job, matchedBy: 'ERP Inv No' });
    else unmatchedJobs.push(job);
  }

  const portalTotalsOf = (list: PortalJob[]): TypeTotals => {
    const totals = emptyTotals();
    for (const job of list) {
      for (const type of DANDI_TYPES) {
        totals[type].qty += job.types[type].qty;
        totals[type].revenue += job.types[type].revenue;
      }
    }
    return totals;
  };
  const roundTotals = (t: TypeTotals): TypeTotals => ({
    CSIDI: { qty: round2(t.CSIDI.qty), revenue: round2(t.CSIDI.revenue) },
    CSIDO: { qty: round2(t.CSIDO.qty), revenue: round2(t.CSIDO.revenue) },
    CSIII: { qty: round2(t.CSIII.qty), revenue: round2(t.CSIII.revenue) },
  });

  const rows: CompareRow[] = [];
  const names = (values: (string | null)[]) => [
    ...new Set(values.map((v) => (v ?? '').trim()).filter(Boolean)),
  ];

  for (const group of groups.values()) {
    const excel = roundTotals(group.totals);
    const matched = group.jobs.map((m) => m.job);
    const row: CompareRow = {
      status: 'only-excel',
      key: group.key,
      customer: group.lines.find((l) => l.customer)?.customer ?? null,
      date: group.lines.find((l) => l.orderDate)?.orderDate ?? null,
      excel: withTotal(excel),
      portal: null,
      difference: 0,
      jobs: group.jobs.map((m) => ({
        id: m.job.id,
        reference: m.job.reference,
        serviceDate: m.job.serviceDate,
        matchedBy: m.matchedBy,
      })),
      notes: [],
    };
    if (!matched.length) {
      row.difference = round2(-row.excel!.total);
      row.notes.push('No Completed portal job carries this delivery note or ERP Inv No.');
      rows.push(row);
      continue;
    }
    const portal = roundTotals(portalTotalsOf(matched));
    row.portal = withTotal(portal);
    row.difference = round2(row.portal.total - row.excel!.total);
    let differs = false;
    for (const type of DANDI_TYPES) {
      const revenueGap = portal[type].revenue - excel[type].revenue;
      if (Math.abs(revenueGap) > tolerance) {
        differs = true;
        row.notes.push(
          `${type} revenue: Excel ${excel[type].revenue.toFixed(2)}, portal ${portal[type].revenue.toFixed(2)}.`,
        );
      }
      // The workbook counts a delivery-only charge per line, the portal per note, so CSIDO quantity is not compared.
      if (type !== 'CSIDO' && Math.abs(portal[type].qty - excel[type].qty) > tolerance) {
        differs = true;
        row.notes.push(`${type} quantity: Excel ${excel[type].qty}, portal ${portal[type].qty}.`);
      }
    }
    const excelSalesmen = names(group.lines.map((l) => l.salesPerson)).map(options.resolveSalesman);
    const portalSalesmen = names(matched.map((j) => j.salesman)).map(options.resolveSalesman);
    if (
      excelSalesmen.length &&
      portalSalesmen.length &&
      ![...excelSalesmen].every((n) => portalSalesmen.some((p) => norm(p) === norm(n)))
    ) {
      row.notes.push(
        `Salesman: Excel ${names(group.lines.map((l) => l.salesPerson)).join(', ')}, portal ${portalSalesmen.join(', ')}.`,
      );
    }
    const excelChannels = names(group.lines.map((l) => l.salesChannel));
    const portalChannels = names(matched.flatMap((j) => j.channels.map(options.reportingName)));
    if (
      excelChannels.length &&
      portalChannels.length &&
      !excelChannels.every((c) => portalChannels.some((p) => norm(p) === norm(c)))
    ) {
      row.notes.push(
        `Sales channel: Excel ${excelChannels.join(', ')}, portal ${portalChannels.join(', ')}.`,
      );
    }
    for (const job of matched) {
      if (monthOf(job.serviceDate) !== options.month) {
        row.notes.push(`${job.reference} is dated ${job.serviceDate}, in another month.`);
      }
    }
    row.status = differs ? 'differs' : 'match';
    rows.push(row);
  }

  for (const job of unmatchedJobs) {
    // A job outside the month that matched nothing is not part of this month's comparison.
    if (monthOf(job.serviceDate) !== options.month) continue;
    const portal = roundTotals(portalTotalsOf([job]));
    rows.push({
      status: 'only-portal',
      key: job.deliveryNoteRef ?? job.erpInvNo ?? job.reference,
      customer: job.customerName,
      date: job.serviceDate,
      excel: null,
      portal: withTotal(portal),
      difference: withTotal(portal).total,
      jobs: [{ id: job.id, reference: job.reference, serviceDate: job.serviceDate, matchedBy: '' }],
      notes: ['The workbook has no line for this delivery note or ERP Inv No.'],
    });
  }

  const rank = { 'only-excel': 0, 'only-portal': 1, differs: 2, match: 3 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.key.localeCompare(b.key));

  // Month totals: every workbook line of the month against the portal jobs dated in the month.
  const excelAll = emptyTotals();
  for (const group of groups.values()) {
    for (const type of DANDI_TYPES) {
      excelAll[type].qty += group.totals[type].qty;
      excelAll[type].revenue += group.totals[type].revenue;
    }
  }
  const portalAll = portalTotalsOf(
    jobs.filter((job) => monthOf(job.serviceDate) === options.month),
  );
  const byType = {} as CompareResult['summary']['byType'];
  for (const type of DANDI_TYPES) {
    byType[type] = {
      excelQty: round2(excelAll[type].qty),
      excelRevenue: round2(excelAll[type].revenue),
      portalQty: round2(portalAll[type].qty),
      portalRevenue: round2(portalAll[type].revenue),
      difference: round2(portalAll[type].revenue - excelAll[type].revenue),
    };
  }
  const excelTotal = round2(DANDI_TYPES.reduce((n, t) => n + excelAll[t].revenue, 0));
  const portalTotal = round2(DANDI_TYPES.reduce((n, t) => n + portalAll[t].revenue, 0));
  const count = (status: CompareRow['status']) => rows.filter((r) => r.status === status).length;
  return {
    month: options.month,
    summary: {
      byType,
      excelTotal,
      portalTotal,
      difference: round2(portalTotal - excelTotal),
      counts: {
        match: count('match'),
        differs: count('differs'),
        onlyExcel: count('only-excel'),
        onlyPortal: count('only-portal'),
      },
    },
    rows,
  };
}
