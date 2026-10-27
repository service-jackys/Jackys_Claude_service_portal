import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareDandi,
  type PortalJob,
  type WorkbookLine,
} from '../../apps/api/src/dandi-jobs/compare.js';

const none = { qty: 0, revenue: 0 };
const line = (over: Partial<WorkbookLine>): WorkbookLine => ({
  jobType: 'CSIDI',
  invDelNo: 'N1',
  customer: 'School A',
  salesPerson: 'RENEESH JOSE',
  salesChannel: 'HAA',
  orderDate: '2026-10-05',
  qty: 2,
  revenue: 114,
  ...over,
});
const job = (over: Partial<PortalJob>): PortalJob => ({
  id: '1',
  reference: 'DIJ-2026-00001',
  serviceDate: '2026-10-05',
  customerName: 'School A',
  salesman: 'Raneesh Jose',
  deliveryNoteRef: 'N1',
  erpInvNo: null,
  channels: ['JDI'],
  types: { CSIDI: { qty: 2, revenue: 114 }, CSIDO: none, CSIII: none },
  ...over,
});
const options = {
  month: '2026-10',
  resolveSalesman: (name: string) =>
    name.trim().toLowerCase() === 'reneesh jose' ? 'Raneesh Jose' : name.trim(),
  reportingName: (channel: string) => (channel === 'JDI' ? 'HAA' : channel),
};

test('a delivery note that agrees on revenue and quantity matches, with no notes', () => {
  const result = compareDandi([line({})], [job({})], options);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.status, 'match');
  assert.deepEqual(result.rows[0]!.notes, []);
  assert.equal(result.summary.counts.match, 1);
  assert.equal(result.summary.difference, 0);
});

test('salesman spelling (alias) and channel reporting name do not cause a difference', () => {
  const result = compareDandi([line({})], [job({})], options);
  assert.equal(result.rows[0]!.notes.length, 0);
  // Without the alias the spelling is called out, but the status is still a match.
  const noAlias = compareDandi([line({})], [job({})], {
    ...options,
    resolveSalesman: (n) => n.trim(),
  });
  assert.equal(noAlias.rows[0]!.status, 'match');
  assert.match(noAlias.rows[0]!.notes[0]!, /Salesman: Excel RENEESH JOSE, portal Raneesh Jose/);
});

test('a revenue or quantity difference is reported per activity', () => {
  const result = compareDandi(
    [line({}), line({ jobType: 'CSIDO', qty: 1, revenue: 60 })],
    [
      job({
        types: { CSIDI: { qty: 3, revenue: 171 }, CSIDO: { qty: 1, revenue: 60 }, CSIII: none },
      }),
    ],
    options,
  );
  const row = result.rows[0]!;
  assert.equal(row.status, 'differs');
  assert.equal(row.difference, 57);
  assert.deepEqual(row.notes, [
    'CSIDI revenue: Excel 114.00, portal 171.00.',
    'CSIDI quantity: Excel 2, portal 3.',
  ]);
  assert.equal(result.summary.byType.CSIDI.difference, 57);
  assert.equal(result.summary.counts.differs, 1);
});

test('delivery-only quantity is not compared (the workbook counts per line, the portal per note)', () => {
  const result = compareDandi(
    [line({ jobType: 'CSIDO', qty: 3, revenue: 100 })],
    [job({ types: { CSIDI: none, CSIDO: { qty: 1, revenue: 100 }, CSIII: none } })],
    options,
  );
  assert.equal(result.rows[0]!.status, 'match');
});

test('a workbook line with no portal job, and a portal job with no workbook line, are listed first', () => {
  const result = compareDandi(
    [line({}), line({ invDelNo: 'N2', revenue: 50, qty: 1 })],
    [job({}), job({ id: '2', reference: 'DIJ-2026-00002', deliveryNoteRef: 'N9' })],
    options,
  );
  assert.deepEqual(
    result.rows.map((r) => [r.key, r.status]),
    [
      ['N2', 'only-excel'],
      ['N9', 'only-portal'],
      ['N1', 'match'],
    ],
  );
  assert.equal(result.rows[0]!.difference, -50);
  assert.equal(result.summary.counts.onlyExcel, 1);
  assert.equal(result.summary.counts.onlyPortal, 1);
});

test('the ERP Inv No pairs a job when the delivery note does not', () => {
  const result = compareDandi(
    [line({ invDelNo: ' inv-77 ' })],
    [job({ deliveryNoteRef: 'DN-5', erpInvNo: 'INV-77' })],
    options,
  );
  assert.equal(result.rows[0]!.status, 'match');
  assert.equal(result.rows[0]!.jobs[0]!.matchedBy, 'ERP Inv No');
});

test('several jobs on one workbook invoice are added together', () => {
  const result = compareDandi(
    [line({ qty: 4, revenue: 228 })],
    [job({}), job({ id: '2', reference: 'DIJ-2026-00002', erpInvNo: 'N1', deliveryNoteRef: 'X' })],
    options,
  );
  assert.equal(result.rows[0]!.status, 'match');
  assert.equal(result.rows[0]!.jobs.length, 2);
});

test('a job dated in another month still pairs with its workbook line, with a note, and stays out of the month total', () => {
  const result = compareDandi([line({})], [job({ serviceDate: '2026-09-30' })], options);
  assert.equal(result.rows[0]!.status, 'match');
  assert.match(result.rows[0]!.notes.join(' '), /another month/);
  assert.equal(result.summary.portalTotal, 0);
  assert.equal(result.summary.excelTotal, 114);
});

test('a job outside the month that matches nothing is not listed', () => {
  const result = compareDandi([], [job({ serviceDate: '2026-09-10' })], options);
  assert.equal(result.rows.length, 0);
});

test('other job types in the workbook are ignored and sub-fils differences are tolerated', () => {
  const result = compareDandi(
    [line({ jobType: 'CSIJW', revenue: 999 }), line({ revenue: 114.003 })],
    [job({})],
    options,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.status, 'match');
});
