import ExcelJS from 'exceljs';
import {
  csidoFlatCharge,
  type Enriched,
  type PricingMaster,
  type PricingRules,
  type SheetPricing,
} from './pricing-logic.js';

const NAVY = 'FF10233F';
const MONEY = '#,##0.00';
const PCT = '0.0%';

export type LogicLine = {
  jobType: string;
  qty: number;
  revenue: number;
  pricing: SheetPricing | null;
  e: Enriched;
};

type Cell = string | number | null;

class Writer {
  row = 1;
  constructor(readonly ws: ExcelJS.Worksheet) {}

  title(text: string) {
    this.ws.mergeCells(this.row, 1, this.row, 7);
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.font = { bold: true, size: 14, name: 'Arial', color: { argb: NAVY } };
    this.row += 1;
  }

  note(text: string, height = 0) {
    this.ws.mergeCells(this.row, 1, this.row, 7);
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
    c.font = { name: 'Arial', size: 10, color: { argb: 'FF475467' } };
    this.ws.getRow(this.row).height = height || Math.max(15, Math.ceil(text.length / 150) * 15);
    this.row += 1;
  }

  gap() {
    this.row += 1;
  }

  section(text: string) {
    this.ws.mergeCells(this.row, 1, this.row, 7);
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.font = { bold: true, size: 11, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    this.row += 1;
  }

  head(values: string[]) {
    const r = this.ws.getRow(this.row);
    values.forEach((v, i) => (r.getCell(i + 1).value = v));
    r.font = { bold: true, name: 'Arial', size: 10, color: { argb: NAVY } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
    r.alignment = { wrapText: true, vertical: 'middle' };
    this.row += 1;
  }

  add(values: Cell[], formats: (string | null)[] = [], bold = false) {
    const r = this.ws.getRow(this.row);
    values.forEach((v, i) => {
      const cell = r.getCell(i + 1);
      cell.value = v === null ? null : v;
      const f = formats[i];
      if (f) cell.numFmt = f;
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
    if (bold) r.font = { bold: true };
    this.row += 1;
  }
}

function sum<T>(list: T[], pick: (t: T) => number | null | undefined): number {
  let total = 0;
  for (const item of list) total += pick(item) ?? 0;
  return total;
}

function masterRows(w: Writer, label: string, m: PricingMaster) {
  w.head([
    label + ' - category',
    'Batch rate (same-site, Qty > 1)',
    'Standard rate (Qty = 1)',
    'Minimum rate',
  ]);
  for (const c of m.categories)
    w.add([c.category, c.batchRate, c.standardRate, c.minimumRate], [null, MONEY, MONEY, MONEY]);
  w.head(['Quantity tier', 'From qty', 'To qty', 'Discount']);
  for (const d of m.discounts)
    w.add(
      [d.tier, d.minimum, d.maximum >= 999999 ? 'and above' : d.maximum, d.discount],
      [null, null, null, PCT],
    );
}

// Revenue Logic sheet for the invoice-level rules (workbook revision of
// 15 Oct 2026): four short sections written for accounts. The full
// explanation, with live figures, is the portal's "Logic applied" tab.
function buildInvoiceLevelLogicSheet(
  wb: ExcelJS.Workbook,
  rules: PricingRules,
  lines: LogicLine[],
  batchFile: string,
  filterText: string,
) {
  const ws = wb.addWorksheet('Revenue Logic', { properties: { tabColor: { argb: NAVY } } });
  const widths = [2, 34, 14, 16, 16, 16, 14, 62];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ showGridLines: false }];
  const LAST = 8;

  // Design tokens
  const INK = 'FF1F2933';
  const MUTED = 'FF667085';
  const LINE = 'FFD0D5DD';
  const ZEBRA = 'FFF5F8FC';
  const SOFT = 'FFE8EEF6';
  const ACCENT = 'FF1D5FA8';
  const font = (over: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
    name: 'Arial',
    size: 10,
    color: { argb: INK },
    ...over,
  });
  const thin = { style: 'thin' as const, color: { argb: LINE } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };
  let row = 1;

  const flat = csidoFlatCharge(rules);
  const money = (n: number) => 'AED ' + n.toLocaleString('en-US');
  const rate = (code: string) => rules.rates.find((r) => r.jobType === code)?.price ?? 0;
  const transports = rules.deliveryInstall.transport
    .map((t) => `${money(t.roundTrip)} ${t.region}`)
    .join(' / ');
  const total = sum(lines, (l) => l.revenue);
  const fill = (argb: string): ExcelJS.Fill => ({
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  });
  const heightFor = (text: string, chars: number) =>
    Math.max(18, Math.ceil(text.length / chars) * 14 + 6);

  // Title band
  ws.mergeCells(row, 2, row, LAST);
  const t = ws.getCell(row, 2);
  t.value = 'Revenue Logic';
  t.font = font({ size: 18, bold: true, color: { argb: 'FFFFFFFF' } });
  t.alignment = { vertical: 'middle', indent: 1 };
  for (let c = 1; c <= LAST; c += 1) ws.getCell(row, c).fill = fill(NAVY);
  ws.getRow(row).height = 34;
  row += 1;
  ws.mergeCells(row, 2, row, LAST);
  const sub = ws.getCell(row, 2);
  sub.value = `How revenue is calculated  |  Source: ${batchFile}  |  Scope: ${filterText}`;
  sub.font = font({ size: 9, color: { argb: 'FFD6E3F5' } });
  sub.alignment = { vertical: 'middle', indent: 1 };
  for (let c = 1; c <= LAST; c += 1) ws.getCell(row, c).fill = fill('FF1B3A63');
  ws.getRow(row).height = 20;
  row += 2;

  const paragraph = (text: string, bold = false) => {
    ws.mergeCells(row, 2, row, LAST);
    const c = ws.getCell(row, 2);
    c.value = text;
    c.font = font({ bold, color: { argb: bold ? INK : MUTED } });
    c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    ws.getRow(row).height = heightFor(text, 150);
    row += 1;
  };
  const section = (num: number, text: string) => {
    ws.mergeCells(row, 2, row, LAST);
    const c = ws.getCell(row, 2);
    c.value = `${num}.  ${text}`;
    c.font = font({ size: 12, bold: true, color: { argb: NAVY } });
    c.alignment = { vertical: 'middle', indent: 1 };
    for (let col = 2; col <= LAST; col += 1) {
      const cell = ws.getCell(row, col);
      cell.fill = fill(SOFT);
      cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
    }
    ws.getCell(row, 2).border = {
      left: { style: 'thick', color: { argb: ACCENT } },
      bottom: { style: 'medium', color: { argb: ACCENT } },
    };
    ws.getRow(row).height = 24;
    row += 1;
  };
  // A table row; `spans` merges the last cell across the remaining columns.
  const tableHead = (labels: string[], from = 2, mergeLastTo = 0) => {
    labels.forEach((l, i) => {
      const c = ws.getCell(row, from + i);
      c.value = l;
      c.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
      c.fill = fill(NAVY);
      c.border = box;
      c.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: i === 0 || (mergeLastTo && i === labels.length - 1) ? 'left' : 'center',
      };
    });
    if (mergeLastTo) {
      for (let c = from + labels.length; c <= mergeLastTo; c += 1) {
        ws.getCell(row, c).fill = fill(NAVY);
        ws.getCell(row, c).border = box;
      }
      ws.mergeCells(row, from + labels.length - 1, row, mergeLastTo);
    }
    ws.getRow(row).height = 24;
    row += 1;
  };
  type V = string | number | null;
  const tableRow = (
    values: V[],
    opts: { fmts?: (string | null)[]; zebra?: boolean; bold?: boolean; mergeLastTo?: number } = {},
  ) => {
    const { fmts = [], zebra = false, bold = false, mergeLastTo = 0 } = opts;
    values.forEach((v, i) => {
      const c = ws.getCell(row, 2 + i);
      c.value = v === null ? null : v;
      if (fmts[i]) c.numFmt = fmts[i]!;
      c.font = font({ bold: bold || i === 0 });
      c.border = bold ? { ...box, top: { style: 'medium', color: { argb: NAVY } } } : box;
      if (zebra) c.fill = fill(ZEBRA);
      const last = i === values.length - 1;
      c.alignment = {
        vertical: 'top',
        wrapText: true,
        horizontal: typeof v === 'number' ? 'right' : 'left',
        indent: typeof v === 'number' ? 0 : last && values.length > 4 ? 1 : 0,
      };
    });
    if (mergeLastTo) {
      for (let c = 2 + values.length; c <= mergeLastTo; c += 1) {
        const cell = ws.getCell(row, c);
        cell.border = box;
        if (zebra) cell.fill = fill(ZEBRA);
      }
      ws.mergeCells(row, 1 + values.length, row, mergeLastTo);
    }
    return row++;
  };

  paragraph(
    'Revenue is the figure calculated in the master Service Dashboard workbook, not an ERP posting. Activity, appliance category and city of every delivery and installation line come from the ERP net-sale report. The portal tab "Logic applied" explains the same rules with live figures.',
  );
  row += 1;

  // 1. Rules -----------------------------------------------------------------
  section(1, 'Rules by job type');
  tableHead(['Job type', 'Jobs', 'Revenue (AED)', 'Share', 'Rule applied'], 2, LAST);
  const rules1: Record<string, [string, string]> = {
    CSIJW: [
      'CSIJW  Warranty repair',
      `Qty x ${money(rate('CSIJW'))}. BER / RWR jobs are billed a flat ${money(rate('RWR') || 60)} per job.`,
    ],
    CSIJO: [
      'CSIJO  Non-warranty repair',
      `Qty x ${money(rate('CSIJO'))}. BER / RWR jobs are billed a flat ${money(rate('RWR') || 60)} per job.`,
    ],
    CSIDI: [
      'CSIDI  Delivery + installation',
      `Qty x net rate. Net rate = base rate less the volume discount, never below the minimum rate. The base rate and the discount tier are decided on the invoice's total delivery + installation quantity across all its categories: more than 1 unit uses the batch rate for every line (even a line of 1), a single unit uses the standard rate. Transport (${transports}) is added once per invoice, on its first line, only when the invoice has more than 1 unit and no delivery-only line.` +
        (rules.csidoMixedRegional
          ? ' When the invoice does have a delivery-only line, the CSIDI lines carry no transport and the delivery-only line is charged the regional rate instead.'
          : ''),
    ],
    CSIII: [
      'CSIII  Installation only',
      'Qty x net rate from the installation rate card (same discount and minimum rule). No transport.',
    ],
    CSIDO: [
      'CSIDO  Delivery only',
      `One flat ${money(flat)} per invoice, charged on the first delivery-only line. The other delivery-only lines of the same invoice show AED 0.` +
        (rules.csidoMixedRegional
          ? ` Exception - mixed invoice: if the invoice also has a delivery + installation line, the one charge is the regional transport rate instead (${transports}), because the visit is shared.`
          : ''),
    ],
  };
  ['CSIJW', 'CSIJO', 'CSIDI', 'CSIII', 'CSIDO'].forEach((code, i) => {
    const set = lines.filter((l) => l.jobType === code);
    const text = rules1[code]![1];
    const r = tableRow(
      [
        rules1[code]![0],
        set.length,
        sum(set, (l) => l.revenue),
        total ? sum(set, (l) => l.revenue) / total : 0,
        text,
      ],
      { fmts: [null, '#,##0', MONEY, PCT, null], zebra: i % 2 === 1, mergeLastTo: LAST },
    );
    ws.getRow(r).height = heightFor(text, 88);
  });
  tableRow(['Total', lines.length, total, 1, ''], {
    fmts: [null, '#,##0', MONEY, PCT, null],
    bold: true,
    mergeLastTo: LAST,
  });
  row += 1;

  // 2. Zero revenue --------------------------------------------------------------
  section(2, 'Why some jobs show AED 0');
  const zeroDo = lines.filter((l) => l.jobType === 'CSIDO' && l.revenue === 0).length;
  const paidDo = lines.filter((l) => l.jobType === 'CSIDO' && l.revenue > 0).length;
  const zeroOther = lines.filter((l) => l.jobType !== 'CSIDO' && l.revenue === 0).length;
  paragraph(
    `A delivery-only invoice with several products has one line per product, but the customer is charged one delivery fee for the invoice. The first line carries the flat ${money(flat)} and the other lines show AED 0. No revenue is lost.` +
      (rules.csidoMixedRegional
        ? ' On an invoice that also has a delivery + installation line, that one charge is the regional transport rate instead.'
        : ''),
  );
  paragraph(
    `In this report: ${zeroDo} delivery-only lines show AED 0, next to ${paidDo} lines that carry the charge.` +
      (zeroOther
        ? ` ${zeroOther} other line(s) show AED 0 for another reason and are listed under Exceptions.`
        : ''),
    true,
  );
  paragraph('Jobs and average revenue per job count every line, including the AED 0 lines.');
  row += 1;

  // 3. Rates ---------------------------------------------------------------------
  section(3, 'Rates in force (read from the workbook)');
  const rateTable = (label: string, m: PricingMaster) => {
    tableHead([label, 'Batch rate', 'Standard rate', 'Minimum rate']);
    m.categories.forEach((c, i) =>
      tableRow([c.category, c.batchRate, c.standardRate, c.minimumRate], {
        fmts: [null, MONEY, MONEY, MONEY],
        zebra: i % 2 === 1,
      }),
    );
    row += 1;
  };
  rateTable('Delivery + installation (CSIDI)', rules.deliveryInstall);
  rateTable('Installation only (CSIII)', rules.install);

  tableHead(['Volume discount (units on the invoice)', 'CSIDI', 'CSIII']);
  rules.deliveryInstall.discounts.forEach((d, i) =>
    tableRow([d.tier, d.discount, rules.install.discounts[i]?.discount ?? d.discount], {
      fmts: [null, PCT, PCT],
      zebra: i % 2 === 1,
    }),
  );
  row += 1;

  tableHead(['Charge per invoice', 'AED', 'When it applies'], 2, LAST);
  const charges: [string, number, string][] = [
    ...rules.deliveryInstall.transport.map((x): [string, number, string] => [
      `Transport - ${x.region}`,
      x.roundTrip,
      'CSIDI invoice with more than 1 unit and no delivery-only line; first CSIDI line only.',
    ]),
    [
      'Delivery-only flat charge',
      flat,
      'Once per invoice, on the first delivery-only line, when the invoice has no delivery + installation line. Sharjah = city containing SHJ or SHARJAH.',
    ],
    ...(rules.csidoMixedRegional
      ? rules.deliveryInstall.transport.map((x): [string, number, string] => [
          `Delivery-only on a mixed invoice - ${x.region}`,
          x.roundTrip,
          'Replaces the flat charge when the invoice also has a delivery + installation line (the visit is shared). Once per invoice, first delivery-only line.',
        ])
      : []),
  ];
  charges.forEach(([a, b, c], i) => {
    const r = tableRow([a, b, c], {
      fmts: [null, MONEY, null],
      zebra: i % 2 === 1,
      mergeLastTo: LAST,
    });
    ws.getRow(r).height = heightFor(c, 88);
  });
  row += 1;

  // 4. Check ---------------------------------------------------------------------
  section(4, 'Check against the workbook');
  const rebuilt = lines.filter((l) => l.e.rebuilt !== null);
  const causeText: Record<string, string> = {
    'CSIDO flat charge':
      'Delivery-only invoices that still carry an older amount than the current rule (flat charge, or regional transport on a mixed invoice).',
    'CSIDI transport':
      'Multi-unit installation invoices where the workbook transport is missing or charged against the rule.',
    'Rate or quantity': 'A locked row kept at an older rate or quantity.',
  };
  paragraph(
    'Every delivery and installation line was re-priced with the rules above and compared with the workbook. The workbook keeps earlier rows as locked history, so some of them differ. Portal revenue is always the workbook figure.',
  );
  tableHead(
    [
      'Group',
      'Lines checked',
      'Workbook (AED)',
      'Rules (AED)',
      'Difference (AED)',
      'Lines that differ',
      'Reason',
    ],
    2,
  );
  // 'Reason' sits in the last column, so merge nothing and keep it wide.
  const groups = ['CSIDI', 'CSIII', 'CSIDO'].filter((g) => rebuilt.some((l) => l.jobType === g));
  groups.forEach((g, i) => {
    const set = rebuilt.filter((l) => l.jobType === g);
    const bad = set.filter((l) => Math.abs(l.e.reconcileDiff ?? 0) > 0.01);
    const causes = [...new Set(bad.map((l) => l.e.diffCause || 'Rate or quantity'))];
    const reason = bad.length
      ? causes.map((c) => causeText[c] ?? c).join(' ')
      : 'All lines agree with the rules.';
    const r = tableRow(
      [
        g,
        set.length,
        sum(set, (l) => l.revenue),
        sum(set, (l) => l.e.rebuilt),
        sum(set, (l) => l.revenue) - sum(set, (l) => l.e.rebuilt),
        bad.length,
        reason,
      ],
      { fmts: [null, '#,##0', MONEY, MONEY, MONEY, '#,##0', null], zebra: i % 2 === 1 },
    );
    ws.getRow(r).height = heightFor(reason, 60);
  });
  const sumWb = sum(rebuilt, (l) => l.revenue);
  const sumRules = sum(rebuilt, (l) => l.e.rebuilt);
  tableRow(
    [
      'Total',
      rebuilt.length,
      sumWb,
      sumRules,
      sumWb - sumRules,
      rebuilt.filter((l) => Math.abs(l.e.reconcileDiff ?? 0) > 0.01).length,
      '',
    ],
    { fmts: [null, '#,##0', MONEY, MONEY, MONEY, '#,##0', null], bold: true },
  );

  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
}

export function buildLogicSheet(
  wb: ExcelJS.Workbook,
  rules: PricingRules,
  lines: LogicLine[],
  batchFile: string,
  filterText: string,
) {
  if (rules.logicVersion === 3) {
    buildInvoiceLevelLogicSheet(wb, rules, lines, batchFile, filterText);
    return;
  }
  const ws = wb.addWorksheet('Revenue Logic');
  ws.getColumn(1).width = 44;
  [2, 3, 4, 5, 6].forEach((c) => (ws.getColumn(c).width = 20));
  ws.getColumn(7).width = 60;
  const w = new Writer(ws);

  const sheetLines = lines.filter((l) => l.pricing);
  const installLines = sheetLines.filter((l) => l.jobType === 'CSIDI' || l.jobType === 'CSIII');
  const csido = sheetLines.filter((l) => l.jobType === 'CSIDO');
  const defaults = installLines.filter((l) => l.pricing!.categorySource === 'DEFAULT ASSUMPTION');
  const identified = installLines.filter((l) => l.pricing!.categorySource !== 'DEFAULT ASSUMPTION');

  w.title('Revenue Logic - how revenue is calculated today and what ERP data is missing');
  w.note(
    `Source workbook: ${batchFile}. Scope of the figures below: ${filterText}. ` +
      (rules.source === 'workbook'
        ? 'Rates and tiers are read from the workbook\'s "Del+Install Pricing", "Install Pricing" and "Calculation" sheets.'
        : 'This upload predates rate capture, so the built-in rates (workbook revision 2, 3 Oct 2026) are shown. Re-upload the workbook to read the live masters.'),
  );
  w.note(
    'Revenue is not an ERP posting. Orion ERP does not give the portal the structured fields the pricing model needs, so the master workbook derives them from free-text Remarks and temporary default assumptions. Every figure marked "assumption" below is only as good as that assumption.',
  );
  if (!sheetLines.length) {
    w.note(
      'The CSIDI-sheet pricing columns are not stored for this upload. Upload the Service Dashboard workbook again (after migration 025) to fill the extra Jobs columns and the exposure figures.',
    );
  }
  w.gap();

  // 1. Rules by job type -------------------------------------------------
  w.section('1. Current rules by job type');
  w.head([
    'Job type',
    'Source sheet',
    'Jobs',
    'Quantity',
    'Revenue (AED)',
    'Share %',
    'Rule applied',
  ]);
  const types = ['CSIJW', 'CSIJO', 'CSIDI', 'CSIII', 'CSIDO'];
  const total = sum(lines, (l) => l.revenue);
  const rule: Record<string, [string, string]> = {
    CSIJW: [
      'CSIJW',
      'Warranty repair: Quantity x AED rate (Calculation sheet). If the job sheet status is BER or RWR the job is billed a flat AED ' +
        (rules.rates.find((r) => r.jobType === 'RWR')?.price ?? 60) +
        ' per job (billing code RWR; quantity does not multiply).',
    ],
    CSIJO: [
      'CSIJO',
      'Non-warranty repair: Quantity x AED rate (Calculation sheet); the same BER/RWR flat charge applies.',
    ],
    CSIDI: [
      'CSIDI',
      'Delivery + installation: Qty x Net unit rate x crew loading + planned trips x transport. Net unit rate = MAX(minimum rate, Base rate x (1 - volume discount)). Base = batch rate when Qty > 1, standard rate when Qty = 1, by appliance category.',
    ],
    CSIII: [
      'CSIDI',
      'Installation only: Qty x Net unit rate x crew loading (no transport). Same net-rate formula using the Install Pricing master.',
    ],
    CSIDO: [
      'CSIDI',
      'Delivery only (not changed by the new masters): billed quantity x AED ' +
        (rules.rates.find((r) => r.jobType === 'CSIDO')?.price ?? 80) +
        '. Billed quantity is derived from the units: under 10 = 1, under 60 = 2, under 150 = 3, up to 500 = 4, otherwise 1.',
    ],
  };
  for (const t of types) {
    const set = lines.filter((l) => l.jobType === t);
    w.add(
      [
        t,
        t === 'CSIJW' || t === 'CSIJO' ? 'CSIJW / CSIJO' : 'CSIDI sheet (Raw_Data__5)',
        set.length,
        sum(set, (l) => l.qty),
        sum(set, (l) => l.revenue),
        total ? sum(set, (l) => l.revenue) / total : 0,
        rule[t]![1],
      ],
      [null, null, null, null, MONEY, PCT, null],
    );
  }
  w.add(
    ['Total', '', lines.length, sum(lines, (l) => l.qty), total, 1, ''],
    [null, null, null, null, MONEY, PCT, null],
    true,
  );
  w.gap();

  // 2. Classification ----------------------------------------------------
  w.section('2. How the activity (job type) is decided for CSIDI-sheet lines');
  w.note(
    'Remarks are searched (upper case) for DELIVERY / DELVERY / DELIVERED / "DELIVER " and for INSTAL / AND INST / & INST. Delivery + installation wording = CSIDI; delivery only = CSIDO; installation only = CSIII; neither = CSIDI (default). The sales channel is HAA or INS only when exactly one of the two words appears in Remarks; both or neither = REVIEW. RENEESH JOSE + a GEMS school = HAA JDI.',
  );
  w.gap();

  // 3. Rate masters ------------------------------------------------------
  w.section(
    '3. Rate masters in force (' +
      (rules.source === 'workbook' ? 'read from the workbook' : 'built-in') +
      ')',
  );
  masterRows(w, 'Delivery + installation (CSIDI)', rules.deliveryInstall);
  w.gap();
  masterRows(w, 'Installation only (CSIII)', rules.install);
  w.gap();
  w.head(['Transport (per round trip)', 'AED', '', 'Crew size', 'Loading factor']);
  const tr = rules.deliveryInstall.transport;
  const cr = rules.deliveryInstall.crew;
  for (let i = 0; i < Math.max(tr.length, cr.length); i += 1)
    w.add(
      [
        tr[i]?.region ?? '',
        tr[i]?.roundTrip ?? null,
        '',
        cr[i]?.size ?? null,
        cr[i]?.loading ?? null,
      ],
      [null, MONEY, null, null, null],
    );
  const d = rules.deliveryInstall.defaults;
  w.add([
    'Temporary defaults used for every job',
    '',
    '',
    '',
    '',
    '',
    `${d.customerGrouping}; ${d.sites} site; crew ${d.crewSize}; ${d.tripsAtOrBelow} trip up to ${d.tripThreshold} units, ${d.tripsAbove} trips above; region Dubai; transport always included for CSIDI.`,
  ]);
  w.gap();

  // 4. Exposure ----------------------------------------------------------
  w.section(
    '4. What each assumption is worth (this is the revenue that depends on missing ERP data)',
  );
  w.head([
    'Assumption / gap',
    'Jobs affected',
    'Revenue today (AED)',
    'Alternative (AED)',
    'Difference (AED)',
    'Difference %',
    'How to read it',
  ]);

  const defCur = sum(defaults, (l) => l.revenue);
  const defRef = sum(defaults, (l) => l.e.ifRefrigerator);
  const defCook = sum(defaults, (l) => l.e.ifCooker);
  const row = (label: string, jobs: number, now: number, alt: number | null, read: string) =>
    w.add(
      [
        label,
        jobs,
        now,
        alt,
        alt === null ? null : alt - now,
        alt === null || !now ? null : (alt - now) / now,
        read,
      ],
      [null, null, MONEY, MONEY, MONEY, PCT, null],
    );
  row(
    'Appliance category unknown: priced at the Default rate - if every unit were a refrigerator / washer',
    defaults.length,
    defCur,
    defRef,
    'CSIDI/CSIII jobs with no category keyword in Remarks. Lower bound of what these jobs could bill.',
  );
  row(
    'Appliance category unknown - if every unit were a cooker',
    defaults.length,
    defCur,
    defCook,
    'Upper bound: cookers carry the highest rates.',
  );
  const transport = sum(installLines, (l) => l.e.transport);
  const sharjahDelta = sum(
    installLines.filter((l) => l.jobType === 'CSIDI'),
    (l) => (l.e.ifSharjah ?? 0) - (l.e.rebuilt ?? 0),
  );
  row(
    'Region unknown: every CSIDI trip charged at the Dubai rate - if all were Sharjah',
    installLines.filter((l) => l.jobType === 'CSIDI').length,
    transport,
    transport + sharjahDelta,
    'Transport charged today in total vs the same trips at the Sharjah rate.',
  );
  const sameSiteDiscount = sum(installLines, (l) => l.e.discountAmount);
  const notSame = sum(installLines, (l) => l.e.ifNotSameSite);
  row(
    'Customer grouping unknown: every job treated as same customer / same site (batch rate + volume discount)',
    installLines.length,
    sum(installLines, (l) => l.e.rebuilt),
    notSame,
    `Discount given away today: AED ${Math.round(sameSiteDiscount).toLocaleString('en-US')}. If a job is not same-site the standard rate applies and there is no volume discount.`,
  );
  row(
    'Crew size unknown: assumed 2 (loading 1.00) - if all were 3-person crews (loading 1.50)',
    installLines.length,
    sum(installLines, (l) => l.e.rebuilt),
    sum(installLines, (l) => l.e.ifThreePersonCrew),
    'Labour loading applies to the labour part only.',
  );
  const trips = sum(
    installLines.filter((l) => l.jobType === 'CSIDI'),
    (l) => l.pricing!.plannedTrips,
  );
  w.add(
    [
      'Trips unknown: 1 trip up to 20 units, 2 above',
      installLines.filter((l) => l.jobType === 'CSIDI').length,
      transport,
      null,
      null,
      null,
      `${trips} planned trips assumed in total. Real trips and whether transport is chargeable on each job are not in ERP.`,
    ],
    [null, null, MONEY, null, null, null, null],
  );
  const floorHits = installLines.filter((l) => l.e.floorApplied === 'Yes').length;
  w.add([
    'AED 35 minimum-rate floor applied',
    floorHits,
    null,
    null,
    null,
    null,
    'Jobs whose discounted rate fell below the floor.',
  ]);
  const rawUnits = sum(csido, (l) => l.pricing!.rawQty);
  const billed = sum(csido, (l) => l.pricing!.billingQty);
  const csidoNow = sum(csido, (l) => l.revenue);
  const csidoRate = rules.rates.find((r) => r.jobType === 'CSIDO')?.price ?? 80;
  row(
    'CSIDO quantity basis: derived trips vs actual units (management decision pending)',
    csido.length,
    csidoNow,
    rawUnits * csidoRate,
    `${rawUnits} units delivered but only ${billed} trip-equivalents billed at AED ${csidoRate}. If CSIDO were billed per unit the revenue would be the alternative shown.`,
  );
  const unclear = sheetLines.filter((l) => l.e.reading.activityEvidence === 'None');
  row(
    'Activity not stated in Remarks (defaulted to CSIDI)',
    unclear.length,
    sum(unclear, (l) => l.revenue),
    null,
    'Remarks contain neither a delivery nor an installation word, so the job was classified CSIDI by default. Needs an ERP activity type.',
  );
  const onlyInst = sheetLines.filter(
    (l) => l.jobType === 'CSIDI' && l.e.reading.onlyInstallWording,
  );
  row(
    'Remarks say "only installation" but job priced as delivery + installation',
    onlyInst.length,
    sum(onlyInst, (l) => l.revenue),
    null,
    'Both words appear, so the classifier chose CSIDI. Review and re-classify.',
  );
  const other = sheetLines.filter((l) => l.e.reading.otherProducts);
  row(
    'Products outside the three priced categories mentioned (TV, microwave, AC, dryer ...)',
    other.length,
    sum(other, (l) => l.revenue),
    null,
    'No rate exists for these products; the job is priced as Default or CSIDO.',
  );
  const multi = sheetLines.filter((l) => l.e.reading.modelCount > 1);
  row(
    'Mixed models in one job (cannot be split by category)',
    multi.length,
    sum(multi, (l) => l.revenue),
    null,
    'Quantity by appliance category is not available, so one rate is applied to the whole quantity.',
  );
  const beforeNow = sum(sheetLines, (l) => l.revenue);
  const beforeThen = sum(sheetLines, (l) => l.pricing!.before.revenue);
  row(
    'Effect of the 3 Oct 2026 pricing change (before fix vs now)',
    sheetLines.length,
    beforeNow,
    beforeThen,
    'Alternative = the revenue the workbook showed before the pricing change (category-unknown jobs reclassified to CSIDO).',
  );
  w.gap();

  // 5. Category identification -----------------------------------------
  w.section('5. Appliance-category identification');
  w.head([
    'Basis',
    'Jobs',
    'Quantity',
    'Revenue (AED)',
    'Share of CSIDI/CSIII revenue',
    '',
    'Meaning',
  ]);
  const insRev = sum(installLines, (l) => l.revenue);
  w.add(
    [
      'Identified from Remarks keyword',
      identified.length,
      sum(identified, (l) => l.qty),
      sum(identified, (l) => l.revenue),
      insRev ? sum(identified, (l) => l.revenue) / insRev : 0,
      '',
      'REFRIGERATOR / FRIDGE, WASHING MACHINE / WASHER, COOKER / COOKING RANGE found in Remarks.',
    ],
    [null, null, null, MONEY, PCT, null, null],
  );
  w.add(
    [
      'Default (no keyword found)',
      defaults.length,
      sum(defaults, (l) => l.qty),
      defCur,
      insRev ? defCur / insRev : 0,
      '',
      'Priced at the flat Default rate regardless of the real appliance.',
    ],
    [null, null, null, MONEY, PCT, null, null],
  );
  w.gap();

  // 6. Reconciliation ----------------------------------------------------
  w.section('6. Reconciliation of this report to the workbook');
  const rebuilt = lines.filter((l) => l.e.rebuilt !== null);
  const bad = rebuilt.filter((l) => Math.abs(l.e.reconcileDiff ?? 0) > 0.01);
  w.add(
    [
      'Jobs re-computed from the rate masters',
      rebuilt.length,
      sum(rebuilt, (l) => l.revenue),
      sum(rebuilt, (l) => l.e.rebuilt),
      sum(rebuilt, (l) => l.revenue) - sum(rebuilt, (l) => l.e.rebuilt),
      null,
      bad.length
        ? `${bad.length} job(s) differ from the workbook - see the "Rebuilt vs workbook" column on the Jobs sheet.`
        : 'All re-computed figures agree with the workbook revenue.',
    ],
    [null, null, MONEY, MONEY, MONEY, null, null],
  );
  w.gap();

  // 7. Missing ERP data --------------------------------------------------
  w.section('7. Data needed from Orion ERP to calculate actual revenue');
  w.head([
    'Field',
    'Why it matters',
    'Today',
    'Jobs relying on the assumption',
    'Revenue relying on it (AED)',
    '',
    'Needed from ERP',
  ]);
  const dep = installLines.length;
  const depRev = insRev;
  const need: [string, string, string, number, number, string][] = [
    [
      'Activity type',
      'Decides which rate master applies',
      'Guessed from Remarks wording',
      sheetLines.length,
      sum(sheetLines, (l) => l.revenue),
      'Delivery + installation / delivery only / installation only on the order',
    ],
    [
      'Appliance category (and model / item code)',
      'Rates differ for refrigerator, washer and cooker; batch vs standard rate',
      'Keyword in Remarks, else Default',
      defaults.length,
      defCur,
      'Item master category per order line; quantity by category',
    ],
    [
      'Customer grouping and number of sites',
      'Volume discount and batch rate only apply to same customer / same site',
      'Assumed same customer / same site, 1 site',
      dep,
      depRev,
      'Customer + site identifier on the delivery; batch / quote identifier',
    ],
    [
      'Region',
      'Transport is AED 60 (Dubai) or AED 90 (Sharjah) per trip',
      'Assumed Dubai',
      installLines.filter((l) => l.jobType === 'CSIDI').length,
      transport,
      'Delivery emirate / location code',
    ],
    [
      'Planned trips and transport applicability',
      'Transport is charged per trip',
      '1 trip up to 20 units, 2 above; always charged for CSIDI',
      installLines.filter((l) => l.jobType === 'CSIDI').length,
      transport,
      'Trips actually run; whether transport is billable',
    ],
    [
      'Crew size',
      'A 3-person crew carries 1.50 labour loading',
      'Assumed 2',
      dep,
      depRev,
      'Crew size per job from scheduling',
    ],
    [
      'Quantity by appliance category',
      'Mixed jobs cannot be split',
      'One rate for the whole quantity',
      multi.length,
      sum(multi, (l) => l.revenue),
      'Line-level quantities per category',
    ],
    [
      'CSIDO billing basis',
      'Units vs derived trips changes revenue materially',
      'Derived trips x AED ' + csidoRate,
      csido.length,
      csidoNow,
      'Management decision plus category/site data to apply installation rates',
    ],
  ];
  for (const [f, why, today, jobs, rev, needed] of need)
    w.add([f, why, today, jobs, rev, '', needed], [null, null, null, null, MONEY, null, null]);
  w.gap();

  // 8. Decisions ---------------------------------------------------------
  w.section('8. Management decisions still open');
  for (const t of [
    'Is CSIDO priced by actual appliance units or by delivery trips?',
    'Are discounts applied per invoice, order, customer/site batch or monthly batch?',
    'Maximum installation batch size: 50 or 70 units (different in different formulas)?',
    'Authoritative CSIDI standard rates: 95.20 / 123.80 or 97.50 / 130?',
    'How should products outside refrigerator, washer and cooker be priced?',
    'Should history be recalculated or only jobs from an effective date?',
  ])
    w.add([t]);

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
