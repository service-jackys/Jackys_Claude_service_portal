import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../apps/web/src/thomson-terms-core.js', import.meta.url),
  'utf8',
);
const holder: { exports: Record<string, any> } = { exports: {} };
new Function('module', 'self', source)(holder, undefined);
const T = holder.exports;
const fmt = (n: number) => Number(n).toFixed(2);

const lineItems = [
  { qty: 319, applianceSubtotal: 15950, totalPrice: 16320 },
  { qty: 1079, applianceSubtotal: 46397, totalPrice: 47287 },
];
const addons = (on: Record<string, boolean>) => [
  { name: 'Project Management Fee', rate: 0.05, hours: 0, on: !!on.pm },
  { name: 'Site Survey', rate: 150, hours: 1, on: !!on.survey },
  { name: 'Testing & Commissioning', rate: 25, hours: 0.25, on: !!on.test },
  { name: 'Training (End User)', rate: 750, hours: 2, on: !!on.train },
];
const sale = (over: Record<string, unknown> = {}) => ({
  lineItems,
  totalPrice: 63607,
  schedule: { workMode: 'phased', extraVisitAmount: 30 },
  editorState: {
    lines: [
      { siteVisits: 1, trainingSessions: 0 },
      { siteVisits: 1, trainingSessions: 0 },
    ],
    addons: addons({ survey: true }),
  },
  ...over,
});

test('services = total minus appliance subtotal, transport folded in', () => {
  assert.equal(T.servicesCharged(lineItems[0]), 370);
  assert.equal(T.servicesCharged(lineItems[1]), 890);
  assert.equal(T.totals(sale()).services, 1260);
});

test('VAT 5% on the total excluding VAT', () => {
  const t = T.totals(sale());
  assert.equal(t.excl, 63607);
  assert.equal(t.vat, 3180.35);
  assert.equal(t.incl, 66787.35);
});

test('extra visit amount follows the share; 0% and 100% are the full round trip', () => {
  assert.equal(T.extraVisitAmount(60, 50), 30);
  assert.equal(T.extraVisitAmount(60, 100), 60);
  assert.equal(T.extraVisitAmount(60, 0), 60);
  assert.equal(T.extraVisitAmount(0, 50), 0);
});

test('services section prints Included / Not included from the ticks', () => {
  const html = T.servicesSectionHtml(sale(), fmt);
  assert.match(html, /Site Survey<\/strong><\/td><td><strong>Included<\/strong><br>2 visits/);
  assert.match(html, /Project Management Fee<\/strong><\/td><td><strong>Not included/);
  assert.match(html, /5% of the equipment price/);
  assert.match(html, /AED 150.00 per site visit/);
  assert.ok(!/transport/i.test(html));
});

test('single-unit quotes have no services section and no phased box', () => {
  const single = sale({
    lineItems: [{ ...lineItems[0], quoteMode: 'single' }],
    schedule: undefined,
  });
  assert.equal(T.servicesSectionHtml(single, fmt), '');
  assert.equal(T.phasedBoxHtml(single, fmt), '');
});

test('phased box only on phased projects and shows the per-visit amount', () => {
  assert.match(T.phasedBoxHtml(sale(), fmt), /AED 30.00 per visit/);
  const continuous = sale({ schedule: { workMode: 'continuous' } });
  assert.equal(T.phasedBoxHtml(continuous, fmt), '');
});

test('terms: no waiting charge, no payment clause, 14 days notice, warranty as per sales terms', () => {
  const html = T.termsHtml(sale(), fmt);
  assert.ok(!/waiting time on site/i.test(html));
  assert.ok(!/advance|payment/i.test(html));
  assert.match(html, /at least 14 days/);
  assert.match(html, /warranty stated in the sales terms/);
  assert.match(html, /within 3 working days/);
  assert.match(html, /valid for 30 days/);
  assert.ok(!/transport/i.test(html));
});

test('terms are numbered 1..n without gaps; continuous drops the phased clause', () => {
  const phased = T.termGroups(sale(), fmt).flatMap((g: any) => g.clauses).length;
  const continuous = T.termGroups(sale({ schedule: { workMode: 'continuous' } }), fmt).flatMap(
    (g: any) => g.clauses,
  ).length;
  assert.equal(phased, 14);
  assert.equal(continuous, 13);
  const html = T.termsHtml(sale(), fmt);
  for (let i = 1; i <= 14; i++) assert.ok(html.includes('>' + i + '.</strong>'));
});

test('continuous quote with a known amount states it inside the additional visits clause', () => {
  const html = T.termsHtml(
    sale({ schedule: { workMode: 'continuous', extraVisitAmount: 60 } }),
    fmt,
  );
  assert.match(html, /charged at AED 60.00 per visit/);
});
