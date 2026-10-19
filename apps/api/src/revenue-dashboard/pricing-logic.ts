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
  /**
   * 3 = invoice-level rules of the workbook revision of 15 Oct 2026 (category,
   * activity and city come from the ERP net-sale report; transport and the
   * CSIDO flat charge are charged once per invoice). Absent / 2 = the earlier
   * per-line, remarks-based rules. Older stored uploads have no value.
   */
  logicVersion?: 2 | 3;
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
  // ---- Added with the 15 Oct 2026 workbook revision (absent on older uploads) ----
  /** True when the row was built from the ERP net-sale report (no CSOSC order behind it). */
  erpSourced?: boolean;
  city?: string | null;
  erpModels?: string | null;
  erpParentItems?: string | null;
  erpCategory?: string | null;
  erpSubcategory?: string | null;
  erpBrand?: string | null;
  erpBillingCodes?: string | null;
  erpChannel?: string | null;
  erpJobTypes?: string | null;
  erpJobStatuses?: string | null;
  erpJobReferences?: string | null;
  erpLineCount?: number | null;
  /** Sum of Calc Qty over the CSIDI rows of the same invoice. */
  invoiceCsidiQty?: number | null;
  /** The invoice also has at least one CSIDO row. */
  invoiceHasCsido?: boolean | null;
  /** This is the first row of its pricing type on the invoice (carries the once-per-invoice charge). */
  firstOfType?: boolean | null;
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
    /** Total transport for this line, overriding trips x per-trip (invoice-level rule). */
    transportTotal?: number;
    forceStandard?: boolean;
    /**
     * Quantity that decides batch vs standard rate and the discount tier. The
     * invoice rule (workbook of 15 Oct 2026) uses the invoice's total quantity of
     * this job type across all categories; defaults to the line's own qty.
     */
    tierQty?: number;
  },
): Priced {
  const master = type === 'CSIDI' ? rules.deliveryInstall : rules.install;
  const cat = categoryRate(master, input.category);
  const tierQty = input.tierQty ?? input.qty;
  const tier = lookupDiscount(master, tierQty);
  const useBatch = tierQty > 1 && !input.forceStandard;
  const base = useBatch ? cat.batchRate : cat.standardRate;
  const discounted = base * (1 - tier.discount);
  const net = Math.max(cat.minimumRate, discounted);
  const loading = crewLoading(master, input.crewSize);
  const labour = input.qty * net * loading;
  const perTrip = input.transportPerTrip ?? master.transport[0]?.roundTrip ?? 0;
  const transport = type === 'CSIDI' ? (input.transportTotal ?? input.trips * perTrip) : 0;
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

/**
 * Region used for transport, same test as the workbook's CSIDI sheet: the city
 * text contains SHJ / SHARJAH -> Sharjah, anything else (DXB, DUBAI, blank,
 * free-text areas) -> Dubai.
 */
export function regionOfCity(city: string | null | undefined): 'Dubai' | 'Sharjah' {
  const c = String(city ?? '').toUpperCase();
  return c.includes('SHJ') || c.includes('SHARJAH') ? 'Sharjah' : 'Dubai';
}

/** The CSIDO flat charge per invoice (Calculation sheet rate for CSIDO). */
export function csidoFlatCharge(rules: PricingRules): number {
  return rules.rates.find((r) => r.jobType === 'CSIDO')?.price ?? 0;
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
  /** Why the workbook figure differs from the rebuilt one ('' when it agrees). */
  diffCause: string;
};

const INSTALL_TYPES = new Set(['CSIDI', 'CSIII']);

/**
 * Invoice-level rules (workbook revision of 15 Oct 2026, "Pricing Logic Guide"
 * section 4). The importer stores the invoice facts the rules need on each
 * row (invoice CSIDI quantity, whether the invoice has a CSIDO line, whether
 * this is the first row of its type), so a line can be rebuilt on its own.
 *   CSIDI : Qty x Net rate + one transport charge per invoice, only when the
 *           invoice has more than 1 CSIDI unit and no CSIDO line.
 *   CSIII : Qty x Net rate, no transport.
 *   CSIDO : one flat charge per invoice (Calculation sheet rate) on the first
 *           CSIDO line; later CSIDO lines of the invoice show 0.
 */
function enrichInvoiceLevel(
  rules: PricingRules,
  line: LineLike,
  p: SheetPricing,
  out: Enriched,
): Enriched {
  const type = line.jobType;
  out.remarkFlags = '';
  const region = regionOfCity(p.city);
  const first = p.firstOfType !== false;

  if (type === 'CSIDO') {
    const flat = csidoFlatCharge(rules);
    const expected = first ? flat : 0;
    out.basis =
      'One flat charge per invoice (AED ' +
      flat +
      ') on the first CSIDO line; later CSIDO lines of the invoice show 0';
    out.rebuilt = expected;
    out.reconcileDiff = line.revenue - expected;
    out.diffCause = Math.abs(out.reconcileDiff) > 0.01 ? 'CSIDO flat charge' : '';
    out.changeVsBeforeFix = p.before.revenue == null ? null : line.revenue - p.before.revenue;
    out.assumptions =
      'Activity and category from the ERP net-sale report (' +
      (p.erpCategory ?? 'category not stated') +
      ' is not an installable category); ' +
      (first
        ? 'first CSIDO line of the invoice, carries the charge'
        : 'charge sits on the first CSIDO line');
    return out;
  }

  const t = type as 'CSIDI' | 'CSIII';
  const master = t === 'CSIDI' ? rules.deliveryInstall : rules.install;
  const crew = p.crewSize ?? 2;
  const invoiceQty = p.invoiceCsidiQty ?? line.qty;
  let transportNote = 'no transport on installation only';
  let transportTotal = 0;
  if (t === 'CSIDI') {
    if (p.invoiceHasCsido)
      transportNote =
        'transport not added: the invoice also has CSIDO, whose flat charge covers the visit';
    else if (invoiceQty <= 1) transportNote = 'transport not added: single unit on the invoice';
    else if (!first)
      transportNote = 'transport charged once, on the first CSIDI line of the invoice';
    else {
      transportTotal = transportPerTrip(rules, region) || master.transport[0]?.roundTrip || 0;
      transportNote = 'transport charged once for the invoice (' + region + ')';
    }
  }
  // CSIDI: invoice total (workbook of 15 Oct 2026). CSIII rows are still priced on the line's own quantity in the workbook.
  const tierQty = t === 'CSIDI' ? (p.invoiceCsidiQty ?? line.qty) : line.qty;
  const cur = priceInstallLine(rules, t, {
    qty: line.qty,
    category: p.applianceCategory,
    trips: 1,
    crewSize: crew,
    transportTotal,
    tierQty,
  });
  out.basis =
    t === 'CSIDI'
      ? 'Qty x Net unit rate x crew loading; batch rate and discount tier are decided on the invoice total of ' +
        tierQty +
        ' CSIDI unit' +
        (tierQty === 1 ? '' : 's') +
        '; one transport charge per invoice only when the invoice has more than 1 CSIDI unit and no CSIDO line'
      : 'Qty x Net unit rate x crew loading (no transport)';
  out.grossLabour = cur.gross;
  out.discountAmount = cur.discountAmount;
  out.floorApplied = cur.floorApplied ? 'Yes' : 'No';
  out.labourAfterDiscount = cur.labour;
  out.transport = cur.transport;
  out.rebuilt = cur.total;
  out.reconcileDiff = line.revenue - cur.total;
  out.changeVsBeforeFix = p.before.revenue == null ? null : line.revenue - p.before.revenue;
  if (Math.abs(out.reconcileDiff) > 0.01) {
    out.diffCause =
      t === 'CSIDI' && Math.abs((p.transportCharge ?? 0) - cur.transport) > 0.01
        ? 'CSIDI transport'
        : 'Rate or quantity';
  }
  out.assumptions =
    'Category ' +
    (p.erpCategory ?? '?') +
    ' -> ' +
    (p.applianceCategory ?? 'Default') +
    ' (from the ERP net-sale report); ' +
    transportNote +
    '; grouping = ' +
    (p.customerGrouping ?? master.defaults.customerGrouping) +
    ', crew = ' +
    crew;
  return out;
}

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
    diffCause: '',
  };
  if (rules.logicVersion === 3 && p && (type === 'CSIDI' || type === 'CSIII' || type === 'CSIDO')) {
    return enrichInvoiceLevel(rules, line, p, empty);
  }
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
