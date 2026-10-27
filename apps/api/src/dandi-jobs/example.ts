// Worked example for one delivery note: the master-workbook lines, the portal
// job(s) that carry the same delivery note or ERP Inv No (frozen figures for a
// Completed job, a live price for a Draft) and the comparison between them, in
// a shape the screen can show line by line so the figures can be checked by hand.
import type { DiJobLineRecord, DiJobRecord } from '../../../../packages/db/src/di-jobs.js';
import type { WorkedExample } from '../revenue-dashboard/logic-summary.js';
import { compareDandi, DANDI_TYPES, type PortalJob, type WorkbookLine } from './compare.js';
import type { PricedNote } from './service.js';

export type ExampleJobInput = {
  job: DiJobRecord & { lines: DiJobLineRecord[] };
  /** The live price of a Draft (what it would be if completed now). */
  live: PricedNote | null;
};

export type ExampleLine = {
  lineNo: number;
  itemCode: string;
  itemDesc: string | null;
  groupName: string | null;
  type: 'CSIDI' | 'CSIDO' | 'CSIII';
  qty: number;
  installable: boolean | null;
  pricingCategory: string | null;
  rateKind: string | null;
  baseRate: number | null;
  discountTier: string | null;
  discountRate: number | null;
  netRate: number | null;
  labour: number | null;
  transport: number | null;
  charge: number | null;
  revenue: number | null;
  note: string | null;
};

export type ExampleJob = {
  id: string;
  reference: string;
  status: string;
  /** Only Completed jobs count towards revenue and the comparison. */
  counted: boolean;
  /** Where the figures come from: saved when completed, a price if completed now, or none. */
  basis: 'frozen' | 'live' | 'none';
  serviceDate: string;
  customerName: string | null;
  salesman: string | null;
  salesChannel: string | null;
  region: string;
  deliveryNoteRef: string | null;
  erpInvNo: string | null;
  note: { csidiQty: number; csiiiQty: number; csidoLines: number };
  lines: ExampleLine[];
  totals: { CSIDI: number; CSIDO: number; CSIII: number; total: number } | null;
  messages: string[];
};

export type DandiExample = {
  invoice: string;
  excel: WorkedExample | null;
  jobs: ExampleJob[];
  comparison: {
    status: 'match' | 'differs' | 'only-excel' | 'only-portal' | 'none';
    excelTotal: number | null;
    portalTotal: number | null;
    difference: number;
    byType: Record<
      'CSIDI' | 'CSIDO' | 'CSIII',
      { excelQty: number; excelRevenue: number; portalQty: number; portalRevenue: number }
    >;
    notes: string[];
  };
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function exampleJob({ job, live }: ExampleJobInput): ExampleJob {
  const frozen = job.status === 'Completed';
  const messages: string[] = [];
  let lines: ExampleLine[];
  let totals: ExampleJob['totals'] = null;
  if (frozen) {
    lines = job.lines.map((line) => ({
      lineNo: line.lineNo,
      itemCode: line.itemCode,
      itemDesc: line.itemDesc,
      groupName: line.groupName,
      type: line.type,
      qty: line.qty,
      installable: line.installable,
      pricingCategory: line.pricingCategory,
      rateKind: line.rateKind,
      baseRate: line.baseRate,
      discountTier: line.discountTier,
      discountRate: line.discountRate,
      netRate: line.netRate,
      labour: line.labour,
      transport: line.transport,
      charge: line.charge,
      revenue: line.revenue,
      note: line.rateNote,
    }));
    totals = {
      CSIDI: job.totalCsidi,
      CSIDO: job.totalCsido,
      CSIII: job.totalCsiii,
      total: job.totalRevenue,
    };
    messages.push(
      'Figures saved when the job was completed; later rate changes do not alter them.',
    );
  } else if (live) {
    lines = job.lines.map((line, i) => {
      const result = live.lines[i];
      return {
        lineNo: line.lineNo,
        itemCode: line.itemCode,
        itemDesc: line.itemDesc,
        groupName: live.items[i]?.groupName ?? line.groupName,
        type: line.type,
        qty: line.qty,
        installable: live.items[i]?.installable ?? line.installable,
        pricingCategory: line.pricingCategory,
        rateKind: result?.rateKind ?? null,
        baseRate: result?.baseRate ?? null,
        discountTier: result?.discountTier ?? null,
        discountRate: result?.discountRate ?? null,
        netRate: result?.netRate ?? null,
        labour: result?.labour ?? null,
        transport: result?.transport ?? null,
        charge: result?.charge ?? null,
        revenue: result?.revenue ?? null,
        note: result?.note ?? null,
      };
    });
    totals = live.totals;
    messages.push(
      `${job.status}: this is the price if the job were completed now. It does not count as revenue until it is Completed.`,
    );
    for (const issue of live.issues) messages.push(issue.message);
  } else {
    lines = job.lines.map((line) => ({
      lineNo: line.lineNo,
      itemCode: line.itemCode,
      itemDesc: line.itemDesc,
      groupName: line.groupName,
      type: line.type,
      qty: line.qty,
      installable: line.installable,
      pricingCategory: line.pricingCategory,
      rateKind: null,
      baseRate: null,
      discountTier: null,
      discountRate: null,
      netRate: null,
      labour: null,
      transport: null,
      charge: null,
      revenue: null,
      note: null,
    }));
    messages.push(
      job.status === 'Cancelled'
        ? 'Cancelled: it does not count as revenue.'
        : 'No lines yet, so there is nothing to price.',
    );
  }
  const qtyOf = (type: ExampleLine['type']) =>
    lines.filter((l) => l.type === type).reduce((n, l) => n + l.qty, 0);
  return {
    id: job.id,
    reference: job.reference,
    status: job.status,
    counted: frozen,
    basis: frozen ? 'frozen' : live ? 'live' : 'none',
    serviceDate: job.serviceDate,
    customerName: job.customerName,
    salesman: job.salesman,
    salesChannel: job.salesChannel,
    region: job.region,
    deliveryNoteRef: job.deliveryNoteRef,
    erpInvNo: job.erpInvNo,
    note: {
      csidiQty: qtyOf('CSIDI'),
      csiiiQty: qtyOf('CSIII'),
      csidoLines: lines.filter((l) => l.type === 'CSIDO').length,
    },
    lines,
    totals,
    messages,
  };
}

export function buildPortalExample(input: {
  invoice: string;
  excel: WorkedExample | null;
  workbookLines: WorkbookLine[];
  jobs: ExampleJobInput[];
  resolveSalesman: (name: string) => string;
  reportingName: (channel: string) => string;
}): DandiExample {
  const jobs = input.jobs.map(exampleJob);

  // The comparison is the Compare tab's own rule, applied to this one note.
  const counted = input.jobs.filter((entry) => entry.job.status === 'Completed');
  const portalJobs: PortalJob[] = counted.map(({ job }) => {
    const sum = (type: ExampleLine['type'], field: 'qty' | 'revenue') =>
      job.lines.filter((l) => l.type === type).reduce((n, l) => n + (l[field] ?? 0), 0);
    return {
      id: job.id,
      reference: job.reference,
      serviceDate: job.serviceDate,
      customerName: job.customerName,
      salesman: job.salesman,
      deliveryNoteRef: job.deliveryNoteRef,
      erpInvNo: job.erpInvNo,
      channels: [...new Set(job.lines.map((l) => l.salesChannel).filter((c): c is string => !!c))],
      types: {
        CSIDI: { qty: sum('CSIDI', 'qty'), revenue: sum('CSIDI', 'revenue') },
        CSIDO: { qty: sum('CSIDO', 'qty'), revenue: sum('CSIDO', 'revenue') },
        CSIII: { qty: sum('CSIII', 'qty'), revenue: sum('CSIII', 'revenue') },
      },
    };
  });
  const month = (
    input.workbookLines.find((l) => l.orderDate)?.orderDate ??
    portalJobs[0]?.serviceDate ??
    ''
  ).slice(0, 7);
  const result = compareDandi(input.workbookLines, portalJobs, {
    month,
    resolveSalesman: input.resolveSalesman,
    reportingName: input.reportingName,
  });
  const row = result.rows[0] ?? null;
  const byType = {} as DandiExample['comparison']['byType'];
  for (const type of DANDI_TYPES) {
    const excelLines = input.workbookLines.filter((l) => l.jobType.trim().toUpperCase() === type);
    byType[type] = {
      excelQty: round2(excelLines.reduce((n, l) => n + (Number(l.qty) || 0), 0)),
      excelRevenue: round2(excelLines.reduce((n, l) => n + (Number(l.revenue) || 0), 0)),
      portalQty: round2(portalJobs.reduce((n, j) => n + j.types[type].qty, 0)),
      portalRevenue: round2(portalJobs.reduce((n, j) => n + j.types[type].revenue, 0)),
    };
  }
  const notes = [...(row?.notes ?? [])];
  const notCounted = jobs.filter((job) => !job.counted);
  if (notCounted.length) {
    notes.push(
      `${notCounted.map((job) => `${job.reference} (${job.status})`).join(', ')} not counted: only Completed jobs count.`,
    );
  }
  return {
    invoice: input.invoice,
    excel: input.excel,
    jobs,
    comparison: {
      status: row?.status ?? 'none',
      excelTotal: row?.excel?.total ?? null,
      portalTotal: row?.portal?.total ?? null,
      difference: row ? round2(row.difference) : 0,
      byType,
      notes,
    },
  };
}
