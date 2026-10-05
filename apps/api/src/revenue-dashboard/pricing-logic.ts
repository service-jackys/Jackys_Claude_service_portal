// Revenue rules behind the CSIDI / CSIDO / CSIII lines of the master workbook
// (Modification #51). The master workbook computes revenue for these job types
// in its CSIDI sheet from Remarks + temporary assumptions (Orion ERP does not
// supply appliance category, site, crew, trip or region data). This module
//   * describes the rate masters read from the workbook,
//   * re-computes a line from those masters (so the export can show every
//     component of the figure and prove it reconciles to the workbook), and
//   * quantifies what each assumption is worth, for the "Revenue Logic" sheet.

export type CategoryRate = {
  category: string;
  batchRate: number;
  standardRate: number;
  minimumRate: number;
};
export type DiscountTier = { minimum: number; maximum: number; tier: string; discount: number };
export type PricingMaster = {
  categories: CategoryRate[];
  discounts: DiscountTier[];
  transport: { region: string; roundTrip: number }[];
  crew: { size: number; loading: number }[];
  defaults: {
    customerGrouping: string;
    sites: number;
    crewSize: number;
    tripThreshold: number;
    tripsAtOrBelow: number;
    tripsAbove: number;
  };
};
export type PricingRules = {
  deliveryInstall: PricingMaster;
  install: PricingMaster;
  rates: { jobType: string; description: string; price: number }[];
  source: 'workbook' | 'built-in';
};

// Values of the workbook as at revision 2 (3 Oct 2026). Used only when an
// older import has no rules stored; flagged "built-in" on the Logic sheet.
export const DEFAULT_PRICING_RULES: PricingRules = {
  source: 'built-in',
  rates: [
    { jobType: 'CSIJW', description: 'Warranty Repairs', price: 100 },
    { jobType: 'CSIDI', description: 'Delivery + Installations', price: 100 },
    { jobType: 'CSIJO', description: 'Non-Warranty Repairs', price: 119 },
    { jobType: 'CSIDO', description: 'Delivery only', price: 80 },
    { jobType: 'CSIII', description: 'Installation Only', price: 60 },
    { jobType: 'RWR', description: 'BER/RWR Flat Charge', price: 60 },
  ],
  deliveryInstall: {
    categories: [
      {
        category: 'Freestanding Refrigerator',
        batchRate: 60,
        standardRate: 95.2,
        minimumRate: 35,
      },
      {
        category: 'Freestanding Washing Machine',
        batchRate: 60,
        standardRate: 95.2,
        minimumRate: 35,
      },
      { category: 'Freestanding Cooker', batchRate: 80, standardRate: 123.8, minimumRate: 35 },
      { category: 'Default', batchRate: 60, standardRate: 60, minimumRate: 35 },
    ],
    discounts: [
      { minimum: 1, maximum: 1, tier: '1 unit', discount: 0 },
      { minimum: 2, maximum: 5, tier: '2–5 units', discount: 0.05 },
      { minimum: 6, maximum: 10, tier: '6–10 units', discount: 0.1 },
      { minimum: 11, maximum: 20, tier: '11–20 units', discount: 0.15 },
      { minimum: 21, maximum: 30, tier: '21–30 units', discount: 0.18 },
      { minimum: 31, maximum: 40, tier: '31–40 units', discount: 0.2 },
      { minimum: 41, maximum: 999999, tier: '41+ units', discount: 0.22 },
    ],
    transport: [
      { region: 'Dubai', roundTrip: 60 },
      { region: 'Sharjah', roundTrip: 90 },
    ],
    crew: [
      { size: 1, loading: 1 },
      { size: 2, loading: 1 },
      { size: 3, loading: 1.5 },
    ],
    defaults: {
      customerGrouping: 'Same customer / same site',
      sites: 1,
      crewSize: 2,
      tripThreshold: 20,
      tripsAtOrBelow: 1,
      tripsAbove: 2,
    },
  },
  install: {
    categories: [
      { category: 'Freestanding Refrigerator', batchRate: 55, standardRate: 60, minimumRate: 35 },
      {
        category: 'Freestanding Washing Machine',
        batchRate: 55,
        standardRate: 60,
        minimumRate: 35,
      },
      { category: 'Freestanding Cooker', batchRate: 70, standardRate: 80, minimumRate: 35 },
      { category: 'Default', batchRate: 60, standardRate: 60, minimumRate: 35 },
    ],
    discounts: [
      { minimum: 1, maximum: 1, tier: '1 unit', discount: 0 },
      { minimum: 2, maximum: 5, tier: '2–5 units', discount: 0.05 },
      { minimum: 6, maximum: 10, tier: '6–10 units', discount: 0.1 },
      { minimum: 11, maximum: 20, tier: '11–20 units', discount: 0.15 },
      { minimum: 21, maximum: 30, tier: '21–30 units', discount: 0.2 },
      { minimum: 31, maximum: 40, tier: '31–40 units', discount: 0.22 },
      { minimum: 41, maximum: 999999, tier: '41+ units', discount: 0.25 },
    ],
    transport: [
      { region: 'Dubai', roundTrip: 60 },
      { region: 'Sharjah', roundTrip: 90 },
    ],
    crew: [
      { size: 1, loading: 1 },
      { size: 2, loading: 1 },
      { size: 3, loading: 1.5 },
    ],
    defaults: {
      customerGrouping: 'Same customer / same site',
      sites: 1,
      crewSize: 2,
      tripThreshold: 20,
      tripsAtOrBelow: 1,
      tripsAbove: 2,
    },
  },
};

/** Fields read from one row of the workbook's CSIDI sheet (stored as jsonb). */
export type SheetPricing = {
  tranc: string | null;
  custCode: string | null;
  trnNo: string | null;
  currency: string | null;
  location: string | null;
  delLoc: string | null;
  rawQty: number | null;
  value: number | null;
  items: number | null;
  invoiceStatus: string | null;
  salesman: string | null;
  refDocNo: string | null;
  refDocDt: string | null;
  delDate: string | null;
  lpoNo: string | null;
  derivedType: string | null;
  calcQty: number | null;
  originalType: string | null;
  applianceCategory: string | null;
  categorySource: string | null;
  pricingType: string | null;
  customerGrouping: string | null;
  sites: number | null;
  plannedTrips: number | null;
  crewSize: number | null;
  discountTier: string | null;
  discountRate: number | null;
  baseUnitRate: number | null;
  netUnitRate: number | null;
  transportCharge: number | null;
  billingQty: number | null;
  proposedRevenue: number | null;
  pricingStatus: string | null;
  reviewNote: string | null;
  before: {
    applianceCategory: string | null;
    pricingType: string | null;
    discountRate: number | null;
    baseUnitRate: number | null;
    netUnitRate: number | null;
    transport: number | null;
    billingQty: number | null;
    revenue: number | null;
  };
};

function lookupDiscount(master: PricingMaster, qty: number): DiscountTier {
  let hit = master.discounts[0]!;
  for (const tier of master.discounts) if (qty >= tier.minimum) hit = tier;
  return hit;
}

function categoryRate(master: PricingMaster, category: string | null): CategoryRate {
  return (
    master.categories.find((c) => c.category === category) ??
    master.categories.find((c) => c.category === 'Default') ??
    master.categories[0]!
  );
}

function crewLoading(master: PricingMaster, size: number): number {
  const exact = master.crew.find((c) => c.size === size);
  if (exact) return exact.loading;
  // The workbook treats larger crews like the biggest listed one.
  return master.crew.length ? master.crew[master.crew.length - 1]!.loading : 1;
}

export type Priced = {
  base: number;
  discountRate: number;
  discountTier: string;
  net: number;
  floorApplied: boolean;
  gross: number;
  discountAmount: number;
  labour: number;
  transport: number;
  total: number;
};

/**
 * Re-prices a CSIDI / CSIII line the way the workbook does:
 *   Net = MAX(minimum, Base * (1 - Discount)), Base = Batch rate when Qty > 1
 *   else Standard rate; Revenue = Qty * Net * crew loading (+ trips * transport
 *   for CSIDI).
 */
export function priceInstallLine(
  rules: PricingRules,
  type: 'CSIDI' | 'CSIII',
  input: {
    qty: number;
    category: string | null;
    trips: number;
    crewSize: number;
    transportPerTrip?: number;
    forceStandard?: boolean;
  },
): Priced {
  const master = type === 'CSIDI' ? rules.deliveryInstall : rules.install;
  const cat = categoryRate(master, input.category);
  const tier = lookupDiscount(master, input.qty);
  const useBatch = input.qty > 1 && !input.forceStandard;
  const base = useBatch ? cat.batchRate : cat.standardRate;
  const discounted = base * (1 - tier.discount);
  const net = Math.max(cat.minimumRate, discounted);
  const loading = crewLoading(master, input.crewSize);
  const labour = input.qty * net * loading;
  const perTrip = input.transportPerTrip ?? master.transport[0]?.roundTrip ?? 0;
  const transport = type === 'CSIDI' ? input.trips * perTrip : 0;
  const gross = input.qty * base * loading;
  return {
    base,
    discountRate: tier.discount,
    discountTier: tier.tier,
    net,
    floorApplied: discounted < cat.minimumRate,
    gross,
    discountAmount: gross - labour,
    labour,
    transport,
    total: labour + transport,
  };
}

export function transportPerTrip(rules: PricingRules, region: string): number {
  return rules.deliveryInstall.transport.find((t) => t.region === region)?.roundTrip ?? 0;
}

// ---- Remarks reading (what the workbook's classifier looks at) ----------

// Same keywords as the workbook's CSIDI!Derived Type formula.
const DELIVERY = /ELIVERY|DELVERY|DELIVERED|DELIVER /;
const INSTALL = /INSTAL|AND INST|& INST/;
const ONLY_INSTALL = /ONLY\s+(THE\s+)?INSTALL/;
const OTHER_PRODUCT =
  /\b(TV|TELEVISION|MICROWAVE|MICRO WAVE|OVEN|HOB|HOOD|DISHWASHER|DISH WASHER|DRYER|AIR CONDITION\w*|A\/C|AC UNIT|SPLIT|FREEZER|CHILLER|WATER DISPENSER|DISPENSER|COOKTOP)\b/;

export type RemarkReading = {
  activityEvidence: string;
  onlyInstallWording: boolean;
  otherProducts: string;
  models: string;
  modelCount: number;
};

export function readRemarks(remarks: string | null | undefined): RemarkReading {
  const r = String(remarks ?? '')
    .toUpperCase()
    .replace(/[–—]/g, '-');
  const d = DELIVERY.test(r);
  const i = INSTALL.test(r);
  const found = new Set<string>();
  const re = new RegExp(OTHER_PRODUCT.source, 'g');
  for (let m = re.exec(r); m; m = re.exec(r)) found.add(m[0]!.trim());
  const models = new Set<string>();
  const modelRe = /MODEL\s*(?:NO\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/g;
  for (let m = modelRe.exec(r); m; m = modelRe.exec(r)) models.add(m[1]!);
  return {
    activityEvidence:
      d && i ? 'Delivery + installation' : d ? 'Delivery only' : i ? 'Installation only' : 'None',
    onlyInstallWording: ONLY_INSTALL.test(r),
    otherProducts: [...found].join(', '),
    models: [...models].slice(0, 6).join(', '),
    modelCount: models.size,
  };
}

// ---- Per-line enrichment for the Jobs sheet ----------------------------

export type LineLike = {
  jobType: string;
  qty: number;
  unitPrice: number;
  revenue: number;
  remarks?: string | null;
  billingCode?: string | null;
  pricing?: SheetPricing | null;
};

export type Enriched = {
  basis: string;
  grossLabour: number | null;
  discountAmount: number | null;
  floorApplied: string;
  labourAfterDiscount: number | null;
  transport: number | null;
  rebuilt: number | null;
  reconcileDiff: number | null;
  changeVsBeforeFix: number | null;
  revenuePerUnit: number | null;
  ifRefrigerator: number | null;
  ifCooker: number | null;
  ifSharjah: number | null;
  ifNotSameSite: number | null;
  ifThreePersonCrew: number | null;
  rawUnitsAt80: number | null;
  assumptions: string;
  remarkFlags: string;
  reading: RemarkReading;
};

const INSTALL_TYPES = new Set(['CSIDI', 'CSIII']);

export function enrichLine(rules: PricingRules, line: LineLike): Enriched {
  const reading = readRemarks(line.remarks);
  const p = line.pricing ?? null;
  const type = line.jobType;
  const empty: Enriched = {
    basis: '',
    grossLabour: null,
    discountAmount: null,
    floorApplied: '',
    labourAfterDiscount: null,
    transport: null,
    rebuilt: null,
    reconcileDiff: null,
    changeVsBeforeFix: null,
    revenuePerUnit: line.qty ? line.revenue / line.qty : null,
    ifRefrigerator: null,
    ifCooker: null,
    ifSharjah: null,
    ifNotSameSite: null,
    ifThreePersonCrew: null,
    rawUnitsAt80: null,
    assumptions: '',
    remarkFlags: '',
    reading,
  };
  const flags: string[] = [];
  if (INSTALL_TYPES.has(type) || type === 'CSIDO') {
    if (reading.activityEvidence === 'None')
      flags.push('No delivery/installation wording (activity defaulted)');
    if (reading.onlyInstallWording && type === 'CSIDI')
      flags.push('Says "only installation" but priced as delivery + installation');
    if (reading.otherProducts) flags.push('Other products in remarks: ' + reading.otherProducts);
    if (reading.modelCount > 1) flags.push(`${reading.modelCount} models in one job`);
  }
  empty.remarkFlags = flags.join('; ');

  if (type === 'CSIJW' || type === 'CSIJO') {
    const flat = Math.abs(line.revenue - line.qty * line.unitPrice) > 0.01;
    empty.basis = flat
      ? 'Flat BER/RWR charge per job (quantity does not multiply)'
      : 'Rate x quantity (Calculation sheet rate)';
    empty.assumptions = 'None of the delivery/installation assumptions apply';
    return empty;
  }

  if (type === 'CSIDO') {
    const raw = p?.rawQty ?? line.qty;
    empty.basis = 'Derived billing quantity x AED ' + (p?.netUnitRate ?? line.unitPrice);
    empty.rawUnitsAt80 = raw * (p?.netUnitRate ?? line.unitPrice);
    empty.rebuilt = p ? (p.billingQty ?? 0) * (p.netUnitRate ?? 0) : null;
    empty.reconcileDiff = empty.rebuilt === null ? null : line.revenue - empty.rebuilt;
    empty.changeVsBeforeFix = p?.before.revenue == null ? null : line.revenue - p.before.revenue;
    empty.assumptions =
      'Billed on derived trips (' +
      (p?.calcQty ?? '?') +
      ') not the ' +
      raw +
      ' units; no category/site/crew data from ERP';
    return empty;
  }

  if (!INSTALL_TYPES.has(type) || !p) {
    empty.basis = 'Rate x quantity';
    return empty;
  }

  const t = type as 'CSIDI' | 'CSIII';
  const crew = p.crewSize ?? 2;
  const trips = p.plannedTrips ?? 1;
  const master = t === 'CSIDI' ? rules.deliveryInstall : rules.install;
  const cur = priceInstallLine(rules, t, {
    qty: line.qty,
    category: p.applianceCategory,
    trips,
    crewSize: crew,
  });
  empty.basis =
    t === 'CSIDI'
      ? 'Qty x Net unit rate x crew loading + trips x transport'
      : 'Qty x Net unit rate x crew loading (no transport)';
  empty.grossLabour = cur.gross;
  empty.discountAmount = cur.discountAmount;
  empty.floorApplied = cur.floorApplied ? 'Yes' : 'No';
  empty.labourAfterDiscount = cur.labour;
  empty.transport = cur.transport;
  empty.rebuilt = cur.total;
  empty.reconcileDiff = line.revenue - cur.total;
  empty.changeVsBeforeFix = p.before.revenue == null ? null : line.revenue - p.before.revenue;
  empty.ifRefrigerator = priceInstallLine(rules, t, {
    qty: line.qty,
    category: 'Freestanding Refrigerator',
    trips,
    crewSize: crew,
  }).total;
  empty.ifCooker = priceInstallLine(rules, t, {
    qty: line.qty,
    category: 'Freestanding Cooker',
    trips,
    crewSize: crew,
  }).total;
  if (t === 'CSIDI') {
    empty.ifSharjah =
      cur.labour +
      trips * (transportPerTrip(rules, 'Sharjah') || master.transport[0]?.roundTrip || 0);
  }
  // Not the same customer/site: no batch rate, no volume discount.
  empty.ifNotSameSite = priceInstallLine(rules, t, {
    qty: line.qty,
    category: p.applianceCategory,
    trips,
    crewSize: crew,
    forceStandard: true,
  }).gross;
  if (t === 'CSIDI') empty.ifNotSameSite += cur.transport;
  empty.ifThreePersonCrew = priceInstallLine(rules, t, {
    qty: line.qty,
    category: p.applianceCategory,
    trips,
    crewSize: 3,
  }).total;
  const assumed: string[] = [];
  if (p.categorySource === 'DEFAULT ASSUMPTION')
    assumed.push('appliance category (Default rate used)');
  else assumed.push('category taken from Remarks keyword');
  assumed.push(
    'customer grouping = ' + (p.customerGrouping ?? master.defaults.customerGrouping),
    'sites = ' + (p.sites ?? master.defaults.sites),
    'crew = ' + crew,
    'trips = ' + trips + (t === 'CSIDI' ? ' (by quantity)' : ''),
    'region = Dubai',
  );
  empty.assumptions = assumed.join('; ');
  return empty;
}
