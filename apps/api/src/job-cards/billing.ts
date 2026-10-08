// Warranty and billing rules for service job cards. Pure functions so the
// rules can be unit-tested without a database.
//
//  - In Warranty  -> job type CSIJW, billed to the sales channel (finance
//    reconciles from the channel report).
//  - Out Warranty -> job type CSIJO, billed to the customer or the sales
//    channel. The user picks who pays; B2C defaults to the customer.
//  - Billing follows the FINAL warranty status the technician sets, which
//    falls back to the warranty status registered on the request.
//  - A job with an amount payable by the customer cannot be delivered until
//    an invoice number is recorded and the payment is confirmed. A job billed
//    to a sales channel can be delivered straight away.

export type BillingRule = {
  salesman: string | null;
  branchKeyword: string | null;
  billToChannel: string;
};

export type WarrantyValue = 'In Warranty' | 'Out Warranty';

/** Maps the free-text warranty values found on older records onto the two real ones. */
export function normalizeWarranty(value: string | null | undefined): WarrantyValue | null {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/\bout\b|^oow\b|non[- ]?warranty|expired/.test(text)) return 'Out Warranty';
  if (/warranty|^iw\b/.test(text)) return 'In Warranty';
  return null;
}

export function matchBillingRule(
  rules: BillingRule[],
  job: { salesman: string | null; b2bBranchSchool: string | null },
): BillingRule | null {
  const salesman = (job.salesman ?? '').trim().toLowerCase();
  const branch = (job.b2bBranchSchool ?? '').trim().toLowerCase();
  for (const rule of rules) {
    const ruleSalesman = (rule.salesman ?? '').trim().toLowerCase();
    const keyword = (rule.branchKeyword ?? '').trim().toLowerCase();
    if (!ruleSalesman && !keyword) continue;
    if (ruleSalesman && ruleSalesman !== salesman) continue;
    if (keyword && !branch.includes(keyword)) continue;
    return rule;
  }
  return null;
}

export type BillingInput = {
  warrantyStatus: string | null;
  finalWarrantyStatus: string | null;
  customerType: string | null;
  salesman: string | null;
  salesChannel: string | null;
  b2bBranchSchool: string | null;
  // What the user asked for on this save (undefined = not sent).
  paymentBy: 'Sales channel' | 'Customer' | null | undefined;
  billToOverride: string | null | undefined;
  rules: BillingRule[];
};

export type BillingResolution = {
  effectiveWarranty: WarrantyValue | null;
  billingJobType: 'CSIJW' | 'CSIJO' | null;
  paymentBy: 'Sales channel' | 'Customer' | null;
  billToChannel: string | null;
  billToOverridden: boolean;
  // True when the final warranty differs from the registered one.
  warrantyChanged: boolean;
};

export function resolveBilling(input: BillingInput): BillingResolution {
  const registered = normalizeWarranty(input.warrantyStatus);
  const final = input.finalWarrantyStatus ? normalizeWarranty(input.finalWarrantyStatus) : null;
  const effectiveWarranty = final ?? registered;
  const warrantyChanged = Boolean(final && registered && final !== registered);

  let paymentBy: BillingResolution['paymentBy'] = input.paymentBy ?? null;
  if (effectiveWarranty === 'In Warranty') {
    paymentBy = 'Sales channel';
  } else if (effectiveWarranty === 'Out Warranty' && !paymentBy) {
    paymentBy = input.customerType === 'B2C' ? 'Customer' : 'Sales channel';
  }

  const billingJobType =
    effectiveWarranty === 'In Warranty'
      ? 'CSIJW'
      : effectiveWarranty === 'Out Warranty'
        ? 'CSIJO'
        : null;

  let billToChannel: string | null = null;
  let billToOverridden = false;
  if (paymentBy === 'Sales channel') {
    const override = input.billToOverride?.trim();
    if (override) {
      billToChannel = override;
      billToOverridden = true;
    } else {
      const rule = matchBillingRule(input.rules, input);
      billToChannel = rule?.billToChannel ?? (input.salesChannel?.trim() || null);
    }
  }

  return {
    effectiveWarranty,
    billingJobType,
    paymentBy,
    billToChannel,
    billToOverridden,
    warrantyChanged,
  };
}

/** The amount this job bills: the explicit chargeable amount, else service charge plus parts. */
export function billedAmount(card: {
  amountChargeable: number | null;
  grandTotal: number;
}): number {
  return card.amountChargeable ?? card.grandTotal ?? 0;
}

/** Why the job cannot be delivered yet, or null when it can. */
export function deliveryBlockReason(card: {
  amount: number;
  billingJobType: string | null;
  paymentBy: string | null;
  invoiceNo: string | null;
  paymentConfirmed: boolean;
}): string | null {
  if (!(card.amount > 0)) return null;
  if (card.billingJobType === 'CSIJO' && !card.paymentBy) {
    return 'This job has an amount. Choose who pays (Payment by) before it can be delivered.';
  }
  if (card.paymentBy === 'Customer') {
    if (!card.invoiceNo) {
      return 'The customer pays for this job. Record the invoice number and confirm the payment before delivery.';
    }
    if (!card.paymentConfirmed) {
      return 'The customer pays for this job. Confirm the payment before delivery.';
    }
  }
  return null;
}

/** Major domestic appliances: the product category (main group) is MDA. */
export function isMdaGroup(mainGroup: string | null | undefined): boolean {
  return (mainGroup ?? '').trim().toUpperCase() === 'MDA';
}

/** The "MDA – Standard" activity rate in the rate card, or null when it is missing. */
export function mdaStandardRate(
  sections: { activities: { name: string; rate: number }[] }[],
): number | null {
  const wanted = 'mda - standard';
  for (const section of sections) {
    for (const activity of section.activities) {
      const name = activity.name
        .replace(/[\u2012-\u2015\u2212]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (name === wanted) return Number(activity.rate);
    }
  }
  return null;
}
