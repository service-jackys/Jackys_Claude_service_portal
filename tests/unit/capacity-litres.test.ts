import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCapacity,
  isCapacityGroup,
  isLargeFridge,
} from '../../packages/db/src/capacity-litres.js';

const cap = (itemDesc: string, subGroup?: string) => deriveCapacity({ itemDesc, subGroup });

test('one litre figure in the description is used as written', () => {
  assert.deepEqual(cap('HISENSE REFRIGERATOR-561 LITERS SIDE BY SIDE CROSS DOOR, BLACK'), {
    litres: 561,
    source: 'description',
  });
  assert.equal(cap('ELEKTA FRIDGE 240 LTR DOUBLE DOOR , NO FROST').litres, 240);
  assert.equal(cap('ELECTROLUX FRIDGE / 311L').litres, 311);
  assert.equal(cap('HITACHI FRIDGE / 660LTR , SILVER FINISH').litres, 660);
  assert.equal(cap('GRATUS FRIDGE /450 LITRES FROST FREE DOUBLE DOOR').litres, 450);
  assert.equal(cap('SAMSUNG REFRIGERATOR / 835 LTRS FOOD SHOWCASE').litres, 835);
});

test('gross is used when gross and net are both written', () => {
  assert.deepEqual(cap('ELECTROLUX BOTTOM FREEZER FRIDGE , 454 L GROSS / 371 L NET , NO FROST'), {
    litres: 454,
    source: 'gross',
  });
  assert.equal(cap('NOBEL 120 L GROSS / 95 L NET, DOUBLE DOOR REFRIGERATOR').litres, 120);
  assert.equal(cap('TERIM SINGLE DOOR REFRIGERATOR, GROSS CAP: 245 L, NET CAP: 183L').litres, 245);
  assert.equal(
    cap('SAMSUNG REFRIGERATOR TMF WITH SPACEMAN 450L GROSS AND 348L NET CAPACITY, 16 CFT').litres,
    450,
  );
});

test('an unlabelled figure beats a net one (net belongs to the next number)', () => {
  assert.equal(cap('HOOVER 263L, NET CAPACITY 202L SINGLE DOOR CHEST FREEZER').litres, 263);
});

test('cubic feet are converted when no litres are written', () => {
  assert.deepEqual(cap('DAEWOO FRIDGE / 24 CFT, SIDE BY SIDE, NO FROST, WHITE'), {
    litres: 680,
    source: 'cft',
  });
});

test('a range in the sub group name is used when the description has none', () => {
  assert.deepEqual(cap('SOME FRIDGE', 'FRIDGE 501-950LTRS.'), { litres: 501, source: 'range' });
});

test('no litres means 400 and the default flag', () => {
  assert.deepEqual(cap('LG FRIDGE / 2 DOOR, SILVER'), { litres: 400, source: 'default' });
  assert.deepEqual(cap('HITACHI FRIDGE / 3 DOOR, GLASS SILVER', 'FRIDGE DOUBLE DOOR'), {
    litres: 400,
    source: 'default',
  });
  assert.deepEqual(cap(''), { litres: 400, source: 'default' });
});

test('figures under 20 L or over 1,500 L are kept but flagged for review', () => {
  assert.deepEqual(cap('YAMADA THERMOELECTRIC FRIDGE 30LITERS 3 LAYER GLASS DOOR'), {
    litres: 30,
    source: 'description',
  });
  assert.deepEqual(cap('WAECO MINI FRIDGE MF-1M-230, 1 LTR CAPACITY'), {
    litres: 1,
    source: 'check',
  });
});

test('LED and similar words are not read as litres', () => {
  assert.equal(cap('LG FRIDGE 2 LED DISPLAY').source, 'default');
});

test('only fridge and freezer groups are read', () => {
  assert.equal(isCapacityGroup('FRIDGE'), true);
  assert.equal(isCapacityGroup(' freezer '), true);
  assert.equal(isCapacityGroup('WASHING MACHINE'), false);
  assert.equal(isCapacityGroup(null), false);
});

test('over 400 L is large; exactly 400 is not', () => {
  assert.equal(isLargeFridge(400), false);
  assert.equal(isLargeFridge(401), true);
  assert.equal(isLargeFridge(null), false);
});
