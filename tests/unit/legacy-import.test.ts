import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanBrand,
  cleanInvoiceNo,
  mapWarranty,
  normalisePhone,
  toDate,
  toMoney,
  toTimestamp,
} from '../../packages/db/src/legacy-import/transforms.js';

test('phones regain the leading 0 and keep every number in the cell', () => {
  assert.equal(normalisePhone('551085135').value, '0551085135');
  assert.equal(normalisePhone('0504901232').value, '0504901232');
  assert.equal(normalisePhone('+971 50 424 9336').value, '0504249336');
  assert.equal(normalisePhone('04-3592727 / 050-4249336').value, '043592727 / 0504249336');
  assert.equal(normalisePhone('').value, null);
  assert.equal(normalisePhone('72035999').value, '072035999');
  assert.ok(normalisePhone('12').notes.length > 0, 'a number that is too short is flagged');
});

test('dates read both formats and reject impossible days', () => {
  assert.equal(toDate('2026-08-12'), '2026-08-12');
  assert.equal(toDate('12/08/2026 10:20:09'), '2026-08-12');
  assert.equal(toDate('31/02/2026'), null);
  assert.equal(toDate(new Date(Date.UTC(2026, 7, 12))), '2026-08-12');
});

test('sheet wall-clock time is read as Dubai time', () => {
  assert.equal(toTimestamp('2026-08-17T10:19')?.toISOString(), '2026-08-17T06:19:00.000Z');
  assert.equal(toTimestamp('17/08/2026 10:19:00')?.toISOString(), '2026-08-17T06:19:00.000Z');
});

test('money text becomes numbers', () => {
  assert.equal(toMoney('AED 1,234.50'), 1234.5);
  assert.equal(toMoney('50.3%'), 50.3);
  assert.equal(toMoney(''), null);
  assert.equal(toMoney('n/a'), null);
});

test('warranty wording maps to portal values', () => {
  assert.equal(mapWarranty('Under Warranty').value, 'In Warranty');
  assert.equal(mapWarranty('Out of Warranty').value, 'Out Warranty');
  assert.equal(mapWarranty('Out Warranty').value, 'Out Warranty');
  assert.equal(mapWarranty('maybe').value, null);
});

test('junk invoice text is dropped, real invoice numbers kept', () => {
  for (const junk of ['NA', 'OOW', 'AMC', 'C/O SIVA', 'DN 6374']) {
    assert.equal(cleanInvoiceNo(junk).value, null, junk);
  }
  assert.equal(cleanInvoiceNo('CDNAW - 16141090').value, 'CDNAW - 16141090');
  assert.equal(cleanInvoiceNo('INV-008514').value, 'INV-008514');
});

test('brands are upper-cased and the DEFAULT placeholder is dropped', () => {
  assert.equal(cleanBrand('Venus').value, 'VENUS');
  assert.equal(cleanBrand('DEFAULT').value, null);
});
