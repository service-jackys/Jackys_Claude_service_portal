import type {
  AmcPricingInput,
  DandiPricingInput,
  RateCardInput,
  ThomsonPricingInput,
  VasPriceBandsInput,
  VasPricingParamsInput,
  VasProfitSplitInput,
} from '../../contracts/src/index.js';

// Phase 6 (see modification.md #26) -- Excel-derived defaults, cross-checked
// directly against the attached master workbook
// (Service_Budget_2027_AUG_13_TG_CAL_VAS_PROFIT_CENTERv4_thomson_pricing_change.xlsx)
// rather than solely trusting the legacy Apps Script prototype's hardcoded
// values. These load once as each domain's starting point; once an admin
// saves an override the system has no further Excel dependency (see
// packages/db/src/pricing-configs.ts), and "reset to Excel default" always
// comes back here.
//
// Two mismatches were found and are deliberately NOT carried over from the
// legacy prototype (code.gs / index_sep_15.html):
//  - Thomson appliance Base rates: the workbook's "thomson_pricing_change"
//    filename is real -- every appliance's Base rate has dropped since the
//    legacy JS's hardcoded THOMSON_INITIAL_CONFIG_ was written (e.g.
//    Built-in Hob 90 -> 78, Combination unit 175 -> 122). The 4 non-Base
//    tiers are still always derived from Base via deriveThomsonTierRates
//    (see contracts/src/index.ts) -- confirmed against the workbook's own
//    "Thomson Pricing Calculator" sheet, tier-by-tier, for every appliance.
//  - A 12th appliance, "Built-in Microwave Oven", now exists in the
//    workbook's master price list (Base 58) but isn't wired into the
//    workbook's own Calculator sheet yet -- included here as the 12th
//    Thomson appliance since it's genuinely part of the current master list.

export const vasPriceBandsDefault: VasPriceBandsInput = [
  { start: 0, end: 99.99, label: '0 - 99.99' },
  { start: 100, end: 249.99, label: '100 - 249.99' },
  { start: 250, end: 499.99, label: '250 - 499.99' },
  { start: 500, end: 999.99, label: '500 - 999.99' },
  { start: 1000, end: 1499.99, label: '1,000 - 1,499.99' },
  { start: 1500, end: 1999.99, label: '1,500 - 1,999.99' },
  { start: 2000, end: 2499.99, label: '2,000 - 2,499.99' },
  { start: 2500, end: 2999.99, label: '2,500 - 2,999.99' },
  { start: 3000, end: 3499.99, label: '3,000 - 3,499.99' },
  { start: 3500, end: 3999.99, label: '3,500 - 3,999.99' },
  { start: 4000, end: 4499.99, label: '4,000 - 4,499.99' },
  { start: 4500, end: 4999.99, label: '4,500 - 4,999.99' },
  { start: 5000, end: 6999.99, label: '5,000 - 6,999.99' },
  { start: 7000, end: 9999.99, label: '7,000 - 9,999.99' },
  { start: 10000, end: 14999.99, label: '10,000 - 14,999.99' },
  { start: 15000, end: 20000, label: '15,000 and above' },
];

// computeVasFee_(midpoint, rate, minFee, roundingStep) =
//   MAX(ROUND(midpoint * rate / roundingStep, 0) * roundingStep, minFee)
// -- verified against the workbook's own band price card row-by-row (e.g.
// midpoint 1250 * ew1Rate 0.06 = 75, rounded to the nearest 5 = 75, vs.
// minFee 29 -> 75, matching the sheet's 1-Year EW value at that band).
export const vasPricingParamsDefault: VasPricingParamsInput = {
  ew1Rate: 0.06,
  ew2Rate: 0.1,
  di1Rate: 0.08,
  premiumRate: 0.06,
  ew1MinFee: 29,
  ew2MinFee: 49,
  di1MinFee: 60,
  premiumMinFee: 60,
  roundingStep: 5,
  claimFeeLow: 100,
  claimFeeHigh: 200,
  claimFeeThreshold: 1500,
  deductibleEw1: 0,
  deductibleEw2: 0,
  deductibleDi1: 0,
  deductiblePremium: 0,
};

// technicianVisitCost = AMC techRate (salary*technicians/workingDays/hoursPerDay)
// * visitHours + transportPerVisit = 43.2692307692 * 4 + 100 = 273.0769230769231
// -- matches the workbook's "VAS Sales-Service GP Split" sheet exactly.
export const vasProfitSplitDefault: VasProfitSplitInput = {
  technicianVisitCost: 273.0769230769231,
  referenceSellingPrice: 1500,
  plans: [
    {
      plan: '1-Year Extended Warranty',
      claimFrequency: 0.1,
      partsCostPct: 0.1,
      marginBuffer: 0.2,
      appliedServicePct: 0.55,
    },
    {
      plan: '2-Year Extended Warranty',
      claimFrequency: 0.23,
      partsCostPct: 0.1,
      marginBuffer: 0.2,
      appliedServicePct: 0.65,
    },
    {
      plan: '1-Year Damage Insurance',
      claimFrequency: 0.05,
      partsCostPct: 0.2,
      marginBuffer: 0.2,
      appliedServicePct: 0.6,
    },
    {
      plan: 'Premium Service (24hr SLA)',
      claimFrequency: 0,
      partsCostPct: 0,
      marginBuffer: 0.2,
      appliedServicePct: 1,
    },
  ],
};

// Proposed (going-forward) rates from the workbook's "Service Price List"
// sheet -- current-vs-proposed comparison rows use the Proposed column;
// the Volume(2025) block's activities have no separate proposed rate so
// their current rate carries over as the starting admin value.
export const rateCardDefault: RateCardInput = [
  {
    key: 'warranty_repairs',
    label: 'Warranty Repairs',
    activities: [
      { name: 'SDA', rate: 50 },
      { name: 'MDA – Standard', rate: 100 },
      { name: 'MDA – Gas Charging', rate: 200 },
      { name: 'AC – Inspection', rate: 125 },
      { name: 'External Repair', rate: 60 },
    ],
  },
  {
    key: 'non_warranty_repairs',
    label: 'Non-Warranty / 3rd Party Repairs',
    activities: [{ name: 'Non-Warranty / 3rd Party Repairs', rate: 100 }],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    activities: [{ name: 'Delivery', rate: 40 }],
  },
  {
    key: 'installations',
    label: 'Installations',
    activities: [
      { name: 'Installation Only', rate: 40 },
      { name: 'Installation + Delivery', rate: 65 },
    ],
  },
  {
    key: 'inspections',
    label: 'Inspections / Visits',
    activities: [{ name: 'Inspection Visit', rate: 83.33 }],
  },
];

export const dandiPricingDefault: DandiPricingInput = {
  maxUnits: 50,
  minUnitRate: 35,
  regions: [
    { name: 'Dubai', km: 20, costPerKm: 1.5, roundTripCost: 60 },
    { name: 'Sharjah', km: 30, costPerKm: 1.5, roundTripCost: 90 },
  ],
  groupings: [
    'Same customer / same site',
    'Same customer / multiple sites',
    'Different customers / multiple sites',
  ],
  crewFactors: { '1': 1, '2': 1, '3': 1.5 },
  capacities: { fridge: 10, washer: 10, cooker: 10 },
  laborMinutes: { fridge: 17.5, washer: 25, cooker: 25 },
  laborCostPerHour: 43.2692307692,
  modes: {
    dandi: {
      label: 'D+I',
      transportAlways: true,
      rates: {
        fridge: { batch: 60, standard: 95.2 },
        washer: { batch: 60, standard: 95.2 },
        cooker: { batch: 80, standard: 123.8 },
      },
      discounts: [
        { min: 1, max: 1, label: '1 unit', rate: 0 },
        { min: 2, max: 5, label: '2–5 units', rate: 0.05 },
        { min: 6, max: 10, label: '6–10 units', rate: 0.1 },
        { min: 11, max: 20, label: '11–20 units', rate: 0.15 },
        { min: 21, max: 30, label: '21–30 units', rate: 0.18 },
        { min: 31, max: 40, label: '31–40 units', rate: 0.2 },
        { min: 41, max: 50, label: '41–50 units', rate: 0.22 },
      ],
    },
    install: {
      label: 'Installation Only',
      transportAlways: false,
      rates: {
        fridge: { batch: 55, standard: 60 },
        washer: { batch: 55, standard: 60 },
        cooker: { batch: 70, standard: 80 },
      },
      discounts: [
        { min: 1, max: 1, label: '1 unit', rate: 0 },
        { min: 2, max: 5, label: '2–5 units', rate: 0.05 },
        { min: 6, max: 10, label: '6–10 units', rate: 0.1 },
        { min: 11, max: 20, label: '11–20 units', rate: 0.15 },
        { min: 21, max: 30, label: '21–30 units', rate: 0.2 },
        { min: 31, max: 40, label: '31–40 units', rate: 0.22 },
        { min: 41, max: 50, label: '41–50 units', rate: 0.25 },
      ],
    },
  },
};

export const amcPricingDefault: AmcPricingInput = {
  basicPct: 0.05,
  standardPct: 0.08,
  premiumPct: 0.12,
  riskUplift: 0.25,
  overhead: 0.1,
  profitMarkup: 0.3,
  standardPartsReserve: 0.025,
  premiumPartsReserve: 0.045,
  handledPerVisit: 8,
  transportPerVisit: 100,
  salary: 4500,
  technicians: 2,
  workingDays: 26,
  hoursPerDay: 8,
  visitHours: 4,
  standardVisits: 2,
  premiumVisits: 4,
  basicVisitTiers: [
    [1, 4],
    [11, 6],
    [26, 8],
    [51, 12],
    [101, 18],
    [251, 36],
  ],
  appliances: [
    { name: 'Built-in Cooker Hood', qty: 100, price: 700, active: true },
    { name: 'Built-in Oven (60/90 cm)', qty: 50, price: 650, active: true },
    { name: 'Built-in Dishwasher', qty: 100, price: 650, active: true },
    { name: 'Built-in Washer-Dryer', qty: 100, price: 1600, active: true },
    { name: 'Built-in Hob (30 cm)', qty: 100, price: 1100, active: true },
    { name: 'Built-in Coffee Machine', qty: 100, price: 2000, active: true },
    { name: 'Freestanding Refrigerator', qty: 100, price: 1050, active: true },
    { name: 'Freestanding Washing Machine', qty: 100, price: 850, active: true },
  ],
};

// Regions, techCount/hoursDay/techRate/costPerKm, and addon rates all match
// the legacy JS's THOMSON_INITIAL_CONFIG_ exactly (verified against the
// workbook's "Thomson Pricing Calculator" sheet) -- only the appliance Base
// rates changed (see the file header note above). avgMin per appliance is
// the midpoint of the workbook's "Installation Time (per unit)" range, e.g.
// Built-in Hob "30-45 min" -> 37.5.
export const thomsonPricingDefault: ThomsonPricingInput = {
  techCount: 2,
  hoursDay: 8,
  techRate: 43.26923076923077,
  costPerKm: 1.5,
  regions: [
    { name: 'Dubai', km: 20, roundTripCost: 60, active: true },
    { name: 'Sharjah', km: 30, roundTripCost: 90, active: true },
    { name: 'UAQ', km: 80, roundTripCost: 240, active: true },
    { name: 'RAK', km: 115, roundTripCost: 345, active: true },
    { name: 'Abu Dhabi', km: 140, roundTripCost: 420, active: true },
    { name: 'Al Ain', km: 155, roundTripCost: 465, active: true },
  ],
  appliances: [
    {
      name: 'Built-in Hob (30 cm)',
      rates: { Base: 78, '50+': 74, '150+': 71, '300+': 69, '500+': 67 },
      avgMin: 37.5,
      active: true,
    },
    {
      name: 'Built-in Oven (60/90 cm)',
      rates: { Base: 78, '50+': 75, '150+': 71, '300+': 69, '500+': 67 },
      avgMin: 52.5,
      active: true,
    },
    {
      name: 'Built-in Cooker Hood',
      rates: { Base: 98, '50+': 94, '150+': 89, '300+': 87, '500+': 84 },
      avgMin: 37.5,
      active: true,
    },
    {
      name: 'Built-in Dishwasher',
      rates: { Base: 98, '50+': 94, '150+': 89, '300+': 87, '500+': 84 },
      avgMin: 52.5,
      active: true,
    },
    {
      name: 'Built-in Refrigerator',
      rates: { Base: 98, '50+': 94, '150+': 89, '300+': 87, '500+': 84 },
      avgMin: 50,
      active: true,
    },
    {
      name: 'Built-in Washer-Dryer',
      rates: { Base: 98, '50+': 94, '150+': 89, '300+': 87, '500+': 84 },
      avgMin: 50,
      active: true,
    },
    {
      name: 'Freestanding Refrigerator',
      rates: { Base: 58, '50+': 56, '150+': 53, '300+': 52, '500+': 50 },
      avgMin: 17.5,
      active: true,
    },
    {
      name: 'Freestanding Washing Machine',
      rates: { Base: 68, '50+': 65, '150+': 62, '300+': 60, '500+': 58 },
      avgMin: 25,
      active: true,
    },
    {
      name: 'Built-in Coffee Machine',
      rates: { Base: 102, '50+': 97, '150+': 92, '300+': 90, '500+': 87 },
      avgMin: 52.5,
      active: true,
    },
    {
      name: 'Combination (Oven + Hob)',
      rates: { Base: 122, '50+': 116, '150+': 110, '300+': 108, '500+': 104 },
      avgMin: 105,
      active: true,
    },
    {
      name: 'Built-in Cooker Gas/Ceramic',
      rates: { Base: 107, '50+': 102, '150+': 97, '300+': 95, '500+': 91 },
      avgMin: 25,
      active: true,
    },
    {
      name: 'Built-in Microwave Oven',
      rates: { Base: 58, '50+': 56, '150+': 53, '300+': 52, '500+': 50 },
      avgMin: 25,
      active: true,
    },
  ],
  addons: {
    'Project Management Fee': {
      rate: 0.05,
      hours: 0,
      note: 'As a percentage of appliance subtotal',
    },
    'Site Survey': { rate: 150, hours: 1, note: 'Per site-survey visit' },
    'Testing & Commissioning': { rate: 25, hours: 0.25, note: 'Per unit tested (15 min)' },
    'Training (End User)': { rate: 750, hours: 1.5, note: 'Per training session' },
  },
};

export const pricingConfigDefaults = {
  vas_price_bands: vasPriceBandsDefault,
  vas_pricing_params: vasPricingParamsDefault,
  vas_profit_split: vasProfitSplitDefault,
  rate_card: rateCardDefault,
  dandi_pricing: dandiPricingDefault,
  amc_pricing: amcPricingDefault,
  thomson_pricing: thomsonPricingDefault,
} as const;
