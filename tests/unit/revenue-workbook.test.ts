import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseRevenueWorkbook } from '../../apps/api/src/revenue-dashboard/parser.js';
import { enrichLine } from '../../apps/api/src/revenue-dashboard/pricing-logic.js';

// A small stand-in for the Service Dashboard master workbook, built with the
// same sheet names, header labels and master-table cells the importer reads.

type CsidiRow = {
  inv: string;
  type: 'CSIDI' | 'CSIDO' | 'CSIII';
  qty: number;
  category: string | null;
  base?: number;
  net?: number;
  transport?: number;
  revenue: number | { formula: string };
  city?: string;
};

const RS_HEADERS = [
  'Source Row',
  'Job Type',
  'Description',
  'Inv/Del No',
  'CSOSC Order No',
  'Order Date',
  'Year',
  'Week No',
  'Month No',
  'Customer',
  'CSOSC LPO No',
  'CSOSC Status',
  'Job Sheet Status',
  'Sales Person',
  'Qty',
  'Proposed Price / Job',
  'Revenue',
  'Original Job Value',
  'Source Sheet',
  'Filtered',
  'Remarks',
  'Billing Code',
  'Sales Channel',
  'Cost Status',
];

const CSIDI_HEADERS = [
  'Inv/Del No',
  'Date',
  'Derived Type',
  'Calc Qty',
  'Appliance Category',
  'ERP Parent Category',
  'ERP City / Region',
  'ERP Raw Line Count',
  'Category Source',
  'Pricing Type',
  'Customer Grouping',
  'Number of Sites',
  'Planned Trips',
  'Crew Size',
  'Discount Rate',
  'Base Unit Rate',
  'Net Unit Rate',
  'Transport Charge',
  'Proposed Billing Qty',
  'Proposed Revenue',
  'Pricing Status',
];

function fillMaster(sheet: ExcelJS.Worksheet, rates: [string, number, number, number][]) {
  rates.forEach(([category, batch, standard, minimum], i) => {
    const r = 19 + i;
    sheet.getCell(r, 10).value = category;
    sheet.getCell(r, 11).value = batch;
    sheet.getCell(r, 12).value = standard;
    sheet.getCell(r, 13).value = minimum;
  });
  const tiers: [number, number, string, number][] = [
    [1, 1, '1 unit', 0],
    [2, 5, '2–5 units', 0.05],
    [6, 10, '6–10 units', 0.1],
  ];
  tiers.forEach(([min, max, tier, disc], i) => {
    const r = 26 + i;
    sheet.getCell(r, 2).value = min;
    sheet.getCell(r, 3).value = max;
    sheet.getCell(r, 4).value = tier;
    sheet.getCell(r, 5).value = disc;
  });
  sheet.getCell(26, 7).value = 'Dubai';
  sheet.getCell(26, 10).value = 60;
  sheet.getCell(27, 7).value = 'Sharjah';
  sheet.getCell(27, 10).value = 90;
  sheet.getCell(32, 7).value = 2;
  sheet.getCell(32, 8).value = 1;
}

async function buildWorkbook(options: {
  invoiceLevel: boolean;
  /** The Guide states the 19 Oct 2026 rule: CSIDO on a mixed invoice = regional transport. */
  mixedRule?: boolean;
  rows: CsidiRow[];
  csidoRate?: number;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const calc = wb.addWorksheet('Calculation');
  calc.getCell(5, 6).value = 2026;
  const rates: [string, string, number][] = [
    ['CSIJW', 'Warranty Repairs', 100],
    ['CSIDI', 'Delivery + Installations', 100],
    ['CSIJO', 'Non-Warranty Repairs', 119],
    ['CSIDO', 'Delivery only', options.csidoRate ?? 100],
    ['CSIII', 'Installation Only', 60],
    ['RWR', 'BER/RWR Flat Charge', 60],
  ];
  rates.forEach(([code, description, price], i) => {
    calc.getCell(6 + i, 1).value = code;
    calc.getCell(6 + i, 2).value = description;
    calc.getCell(6 + i, 3).value = price;
  });
  // The monthly summary of the 15 Oct 2026 revision ends in a "Total" row that
  // lands inside the rate rows the importer scans; it must not become a rate.
  calc.getCell(20, 1).value = 'Total';
  calc.getCell(20, 3).value = 811;

  fillMaster(wb.addWorksheet('Del+Install Pricing'), [
    ['Freestanding Refrigerator', 60, 95.2, 35],
    ['Freestanding Washing Machine', 60, 95.2, 35],
    ['Freestanding Cooker', 80, 100, 35],
    ['Default', 60, 60, 35],
  ]);
  fillMaster(wb.addWorksheet('Install Pricing'), [
    ['Freestanding Refrigerator', 55, 60, 35],
    ['Freestanding Washing Machine', 55, 60, 35],
    ['Freestanding Cooker', 70, 80, 35],
    ['Default', 60, 60, 35],
  ]);
  if (options.invoiceLevel) {
    const guide = wb.addWorksheet('Pricing Logic Guide');
    if (options.mixedRule) guide.getCell('A35').value = 'CSIDO Revenue \u2014 Mixed';
  }

  const csidi = wb.addWorksheet('CSIDI');
  csidi.addRow(CSIDI_HEADERS);
  for (const r of options.rows) {
    const net = r.net ?? 0;
    csidi.addRow([
      r.inv,
      new Date('2026-09-01'),
      r.type,
      r.qty,
      r.category,
      'FRIDGE',
      r.city ?? 'DXB',
      1,
      'Identified from ERP (net_sale_report.xlsx)',
      r.type,
      'Same customer / same site',
      1,
      1,
      2,
      0,
      r.base ?? net,
      net,
      r.transport ?? 0,
      r.qty,
      r.revenue,
      'Finalized - New Logic',
    ]);
  }

  const rs = wb.addWorksheet('Revenue Source');
  rs.addRow(RS_HEADERS);
  options.rows.forEach((r, i) => {
    const revenue = typeof r.revenue === 'number' ? r.revenue : 0; // a formula row evaluates to 0 here
    rs.addRow([
      i + 2,
      r.type,
      '',
      r.inv,
      '',
      new Date('2026-09-01'),
      2026,
      36,
      9,
      'Customer',
      'UNMATCHED CSOSC',
      '',
      '',
      '',
      r.qty,
      r.net ?? 0,
      revenue,
      0,
      r.type,
      1,
      '',
      'SERV-DELIVERY-INS',
      'INS',
      'READY',
    ]);
  });
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Invoice 1: two CSIDI categories (qty 1 and qty 4), no CSIDO -> transport once.
// Invoice 2: one CSIDI unit -> no transport.
// Invoice 3: CSIDI + CSIDO mixed -> no transport; CSIDO flat once.
// Invoice 4: CSIDO only, three lines -> flat on the first, 0 on the others.
const CONFORMING: CsidiRow[] = [
  {
    inv: '1001',
    type: 'CSIDI',
    qty: 1,
    category: 'Freestanding Refrigerator',
    base: 60,
    net: 57,
    transport: 60,
    revenue: 117,
  },
  {
    inv: '1001',
    type: 'CSIDI',
    qty: 4,
    category: 'Freestanding Washing Machine',
    base: 60,
    net: 57,
    revenue: 228,
  },
  { inv: '2002', type: 'CSIDI', qty: 1, category: 'Freestanding Cooker', net: 100, revenue: 100 },
  {
    inv: '3003',
    type: 'CSIDI',
    qty: 2,
    category: 'Freestanding Refrigerator',
    base: 60,
    net: 57,
    revenue: 114,
  },
  { inv: '3003', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 100 },
  { inv: '4004', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 100 },
  { inv: '4004', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 0 },
  { inv: '4004', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 0 },
];

async function enriched(buffer: Buffer) {
  const parsed = await parseRevenueWorkbook(buffer);
  const lines = parsed.lines.map((line) => ({
    line,
    e: enrichLine(parsed.pricingRules, {
      jobType: line.jobType,
      qty: line.qty,
      unitPrice: line.unitPrice,
      revenue: line.revenue,
      remarks: line.remarks,
      billingCode: line.billingCode,
      pricing: line.pricing,
    }),
  }));
  return { parsed, lines };
}

test('repair jobs get their Ref DocNo from the CSIJW / CSIJO sheets', async () => {
  const base = await buildWorkbook({ invoiceLevel: true, rows: CONFORMING });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(base as unknown as ArrayBuffer);
  const rs = wb.getWorksheet('Revenue Source')!;
  const repair = (type: string, inv: string) =>
    rs.addRow([
      99,
      type,
      '',
      inv,
      '',
      new Date('2026-09-02'),
      2026,
      36,
      9,
      'Customer',
      '',
      '',
      '',
      '',
      1,
      100,
      100,
      0,
      type,
      1,
      '',
      'SERV-REPAIR',
      'INS',
      'READY',
    ]);
  repair('CSIJW', '250532');
  repair('CSIJO', '16100945');
  repair('CSIJW', '999999'); // no row on the CSIJW sheet
  const headers = ['Tranc', 'Inv/Del No', 'Date', 'Ref DocNo.', 'Ref DocDt.'];
  const csijw = wb.addWorksheet('CSIJW');
  csijw.addRow(headers);
  csijw.addRow(['SI', '250532', '2026-09-02', 'CSOSC - 16104750', '']);
  const csijo = wb.addWorksheet('CSIJO');
  csijo.addRow(headers);
  csijo.addRow(['SI', '16100945', '2026-09-02', 'Direct', '']);
  const parsed = await parseRevenueWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  const ref = (inv: string) => parsed.lines.find((l) => l.invDelNo === inv)?.refDocNo;
  assert.equal(ref('250532'), 'CSOSC - 16104750');
  assert.equal(ref('16100945'), 'Direct');
  assert.equal(ref('999999'), null);
  // Delivery & Installation lines are untouched (their Ref DocNo is in the pricing detail).
  assert.equal(ref('1001'), null);
});

test('an invoice with several rows of one type keeps each row its own pricing', async () => {
  const { parsed } = await enriched(await buildWorkbook({ invoiceLevel: true, rows: CONFORMING }));
  assert.equal(parsed.pricingUnmatched, 0);
  assert.equal(parsed.pricingMatched, CONFORMING.length);
  const inv1 = parsed.lines.filter((l) => l.invDelNo === '1001');
  assert.deepEqual(
    inv1.map((l) => l.pricing?.applianceCategory),
    ['Freestanding Refrigerator', 'Freestanding Washing Machine'],
  );
  assert.deepEqual(
    inv1.map((l) => l.pricing?.firstOfType),
    [true, false],
  );
  // Invoice-level facts the rules need are stored on every row.
  assert.ok(inv1.every((l) => l.pricing?.invoiceCsidiQty === 5));
  assert.ok(inv1.every((l) => l.pricing?.invoiceHasCsido === false));
  const inv3 = parsed.lines.filter((l) => l.invDelNo === '3003');
  assert.ok(inv3.every((l) => l.pricing?.invoiceHasCsido === true));
});

test('the invoice-level rules rebuild every conforming line exactly', async () => {
  const { parsed, lines } = await enriched(
    await buildWorkbook({ invoiceLevel: true, rows: CONFORMING }),
  );
  assert.equal(parsed.pricingRules.logicVersion, 3);
  for (const { line, e } of lines) {
    assert.ok(e.rebuilt !== null, `invoice ${line.invDelNo} rebuilt`);
    assert.ok(
      Math.abs(e.reconcileDiff ?? 1) < 0.005,
      `invoice ${line.invDelNo} ${line.jobType}: workbook ${line.revenue} vs rebuilt ${e.rebuilt}`,
    );
    assert.equal(e.diffCause, '');
  }
  const byInv = (inv: string, type: string) =>
    lines.filter((x) => x.line.invDelNo === inv && x.line.jobType === type).map((x) => x.e);
  assert.deepEqual(
    byInv('1001', 'CSIDI').map((e) => e.transport),
    [60, 0],
  );
  assert.deepEqual(
    byInv('2002', 'CSIDI').map((e) => e.transport),
    [0],
  );
  assert.deepEqual(
    byInv('3003', 'CSIDI').map((e) => e.transport),
    [0],
  );
  assert.deepEqual(
    byInv('4004', 'CSIDO').map((e) => e.rebuilt),
    [100, 0, 0],
  );
});

test('workbook figures that break the current rules are flagged with a cause', async () => {
  const rows: CsidiRow[] = [
    // Pure CSIDI, 5 units (1 + 4), transport missing.
    {
      inv: '5005',
      type: 'CSIDI',
      qty: 1,
      category: 'Freestanding Refrigerator',
      base: 60,
      net: 57,
      revenue: 57,
    },
    {
      inv: '5005',
      type: 'CSIDI',
      qty: 4,
      category: 'Freestanding Washing Machine',
      base: 60,
      net: 57,
      revenue: 228,
    },
    // CSIDO-only invoice left at the old regional AED 60.
    { inv: '6006', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 60 },
  ];
  const { lines } = await enriched(await buildWorkbook({ invoiceLevel: true, rows }));
  const causes = lines.map((x) => x.e.diffCause);
  assert.deepEqual(causes, ['CSIDI transport', '', 'CSIDO flat charge']);
  const first = lines[0]!.e;
  assert.ok(Math.abs((first.reconcileDiff ?? 0) + 60) < 0.005);
  assert.ok(Math.abs((lines[2]!.e.reconcileDiff ?? 0) + 40) < 0.005);
});

test('Sharjah cities get the Sharjah transport charge', async () => {
  const rows: CsidiRow[] = [
    {
      inv: '7007',
      type: 'CSIDI',
      qty: 2,
      category: 'Freestanding Refrigerator',
      base: 60,
      net: 57,
      transport: 90,
      revenue: 204,
      city: 'DUBAI,SHJ',
    },
  ];
  const { lines } = await enriched(await buildWorkbook({ invoiceLevel: true, rows }));
  assert.equal(lines[0]!.e.transport, 90);
  assert.equal(lines[0]!.e.diffCause, '');
});

test('a formula that evaluates to zero without a cached value still matches its line', async () => {
  const rows: CsidiRow[] = [
    { inv: '8008', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 100 },
    {
      inv: '8008',
      type: 'CSIDO',
      qty: 1,
      category: null,
      net: 60,
      revenue: { formula: 'IF(1=2,100,0)' },
    },
  ];
  const { parsed, lines } = await enriched(await buildWorkbook({ invoiceLevel: true, rows }));
  assert.equal(parsed.pricingUnmatched, 0);
  assert.deepEqual(
    lines.map((x) => x.e.diffCause),
    ['', ''],
  );
});

test('the Total row of the monthly summary is not read as a rate', async () => {
  const parsed = await parseRevenueWorkbook(
    await buildWorkbook({ invoiceLevel: true, rows: CONFORMING, csidoRate: 100 }),
  );
  assert.deepEqual(
    parsed.rates.map((r) => r.jobType),
    ['CSIJW', 'CSIDI', 'CSIJO', 'CSIDO', 'CSIII', 'RWR'],
  );
  assert.equal(parsed.rates.find((r) => r.jobType === 'CSIDO')?.price, 100);
});

test('an earlier workbook (no Pricing Logic Guide) keeps the earlier per-line rules', async () => {
  const rows: CsidiRow[] = [
    {
      inv: '9009',
      type: 'CSIDI',
      qty: 1,
      category: 'Freestanding Refrigerator',
      net: 95.2,
      transport: 60,
      revenue: 155.2,
    },
    { inv: '9010', type: 'CSIDO', qty: 1, category: null, net: 80, revenue: 80 },
  ];
  const { parsed, lines } = await enriched(
    await buildWorkbook({ invoiceLevel: false, rows, csidoRate: 80 }),
  );
  assert.equal(parsed.pricingRules.logicVersion, 2);
  assert.equal(parsed.pricingMatched, 2);
  const csidi = lines[0]!.e;
  assert.equal(csidi.transport, 60);
  assert.equal(csidi.reconcileDiff, 0);
  assert.equal(lines[1]!.e.rebuilt, 80);
});

const MIXED_ROWS: CsidiRow[] = [
  // Dubai: 2 CSIDI units (no transport, the invoice has CSIDO) + CSIDO at the Dubai transport rate.
  {
    inv: '8101',
    type: 'CSIDI',
    qty: 2,
    category: 'Freestanding Refrigerator',
    base: 60,
    net: 57,
    transport: 0,
    revenue: 114,
  },
  { inv: '8101', type: 'CSIDO', qty: 1, category: null, net: 60, revenue: 60 },
  // Sharjah: the CSIDO charge is the Sharjah transport rate.
  {
    inv: '8102',
    type: 'CSIDI',
    qty: 2,
    category: 'Freestanding Refrigerator',
    base: 60,
    net: 57,
    transport: 0,
    revenue: 114,
    city: 'DUBAI,SHJ',
  },
  { inv: '8102', type: 'CSIDO', qty: 1, category: null, net: 90, revenue: 90, city: 'DUBAI,SHJ' },
  // Pure CSIDO invoice keeps the flat charge.
  { inv: '8103', type: 'CSIDO', qty: 1, category: null, net: 100, revenue: 100 },
];

test('a CSIDO line on a mixed invoice is charged the regional transport rate once the Guide says so', async () => {
  const { parsed, lines } = await enriched(
    await buildWorkbook({ invoiceLevel: true, mixedRule: true, rows: MIXED_ROWS }),
  );
  assert.equal(parsed.pricingRules.csidoMixedRegional, true);
  for (const { line, e } of lines) {
    assert.equal(e.diffCause, '', `invoice ${line.invDelNo} ${line.jobType}`);
    assert.ok(Math.abs(e.reconcileDiff ?? 1) < 0.005);
  }
  const csido = lines.filter((x) => x.line.jobType === 'CSIDO').map((x) => x.e.rebuilt);
  assert.deepEqual(csido, [60, 90, 100]);
});

test('without the mixed-invoice rule in the Guide a CSIDO line stays at the flat charge', async () => {
  const { parsed, lines } = await enriched(
    await buildWorkbook({ invoiceLevel: true, rows: MIXED_ROWS }),
  );
  assert.equal(parsed.pricingRules.csidoMixedRegional, undefined);
  const causes = lines.filter((x) => x.line.jobType === 'CSIDO').map((x) => x.e.diffCause);
  assert.deepEqual(causes, ['CSIDO flat charge', 'CSIDO flat charge', '']);
});
