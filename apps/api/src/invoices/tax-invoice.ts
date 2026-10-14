// Tax invoice maths for service jobs. Job amounts are VAT-inclusive at 5%, so the
// invoice backs the VAT out of each gross amount (25.00 = 23.81 + 1.19).
// Pure functions so they can be unit-tested without a database.

export const VAT_RATE = 5;

export type TaxInvoiceLine = {
  sno: number;
  itemCode: string;
  description: string;
  uom: string;
  qty: number;
  rate: number; // net unit rate
  value: number; // net value
  taxRate: number;
  vat: number;
  amount: number; // gross
};

export type TaxInvoiceTotals = { net: number; vat: number; gross: number };

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Splits a VAT-inclusive amount into net and VAT; net + vat always equals gross. */
export function splitVat(gross: number, rate: number = VAT_RATE): { net: number; vat: number } {
  const total = cents(gross);
  const net = cents(total / (1 + rate / 100));
  return { net, vat: cents(total - net) };
}

function line(
  itemCode: string,
  description: string,
  uom: string,
  qty: number,
  gross: number,
): Omit<TaxInvoiceLine, 'sno'> {
  const { net, vat } = splitVat(gross);
  return {
    itemCode,
    description,
    uom,
    qty,
    rate: qty > 0 ? cents(net / qty) : net,
    value: net,
    taxRate: VAT_RATE,
    vat,
    amount: cents(gross),
  };
}

export type InvoiceSourceJob = {
  itemDescription: string | null;
  modelNo: string | null;
  serviceCharge: number;
  parts: { partNo?: string; description?: string; qty?: number; unitPrice?: number }[];
  amount: number; // billed amount (chargeable amount, else service charge plus parts)
};

/** Invoice lines for a job: the service charge, each part, and an adjustment line when the
 *  chargeable amount differs from service charge plus parts. */
export function buildInvoiceLines(job: InvoiceSourceJob): TaxInvoiceLine[] {
  const rows: Omit<TaxInvoiceLine, 'sno'>[] = [];
  const serviceLabel = [
    'Service charges',
    job.itemDescription ? `- ${job.itemDescription}` : '',
    job.modelNo ? `(${job.modelNo})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (job.serviceCharge > 0) rows.push(line('SERVICE', serviceLabel, 'NOS', 1, job.serviceCharge));
  for (const part of job.parts) {
    const qty = Number(part.qty) || 0;
    const gross = cents(qty * (Number(part.unitPrice) || 0));
    if (qty <= 0 || gross <= 0) continue;
    rows.push(line(part.partNo || '-', part.description || 'Spare part', 'PCS', qty, gross));
  }
  const listed = cents(rows.reduce((sum, row) => sum + row.amount, 0));
  const difference = cents(job.amount - listed);
  if (Math.abs(difference) >= 0.01) {
    rows.push(
      line(
        'ADJ',
        listed === 0 ? serviceLabel : difference < 0 ? 'Discount / adjustment' : 'Adjustment',
        'NOS',
        1,
        difference,
      ),
    );
  }
  return rows.map((row, index) => ({ sno: index + 1, ...row }));
}

export function invoiceTotals(lines: TaxInvoiceLine[]): TaxInvoiceTotals {
  const net = cents(lines.reduce((sum, row) => sum + row.value, 0));
  const vat = cents(lines.reduce((sum, row) => sum + row.vat, 0));
  return { net, vat, gross: cents(net + vat) };
}

const ones = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ones[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ones[n]);
  }
  return parts.join(' ');
}

function wholeWords(n: number): string {
  if (n === 0) return 'Zero';
  const scales: [number, string][] = [
    [1_000_000_000, 'Billion'],
    [1_000_000, 'Million'],
    [1_000, 'Thousand'],
  ];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      parts.push(`${belowThousand(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** "AED Twenty Five Only" / "AED One Hundred and Fifty Fils Only". */
export function amountInWords(amount: number, currency = 'AED'): string {
  const total = Math.round(Math.abs(amount) * 100);
  const dirhams = Math.floor(total / 100);
  const fils = total % 100;
  const parts = [`${currency} ${wholeWords(dirhams)}`];
  if (fils) parts.push(`and ${wholeWords(fils)} Fils`);
  return `${parts.join(' ')} Only`.replace(/-/g, ' ');
}
