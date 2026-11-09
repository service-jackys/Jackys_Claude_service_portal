import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../apps/web/src/thomson-schedule.js', import.meta.url),
  'utf8',
);
const holder: { exports: Record<string, any> } = { exports: {} };
new Function('module', 'self', source)(holder, undefined);
const sched = holder.exports;

// 2 techs x 8 h = 16 h/day. 100 units x 30 min = 50 h; 40 units x 45 min = 30 h.
const lines = [
  { hoursPerUnit: 0.5, qty: 100, extraDays: 0 },
  { hoursPerUnit: 0.75, qty: 40, extraDays: 1 },
];

test('continuous: lines share the team and round up once', () => {
  const s = sched.computeSchedule({ lines, techCount: 2, hoursDay: 8, mode: 'continuous' });
  assert.equal(s.totalHours, 80);
  assert.equal(s.installDays, 5); // 80 / 16
  assert.equal(s.workingDays, 6); // + 1 survey/training day
  assert.equal(s.calendarDays, 6);
});

test('continuous rounds up once, not per line', () => {
  const s = sched.computeSchedule({
    lines: [
      { hoursPerUnit: 1, qty: 10, extraDays: 0 },
      { hoursPerUnit: 1, qty: 10, extraDays: 0 },
    ],
    techCount: 2,
    hoursDay: 8,
    mode: 'continuous',
  });
  assert.equal(s.installDays, 2); // 20 h / 16 = 1.25 -> 2
});

test('phased: each phase rounds up on its own, gaps add calendar days', () => {
  const s = sched.computeSchedule({
    lines,
    techCount: 2,
    hoursDay: 8,
    mode: 'phased',
    phases: [
      { name: 'Block A', qty: [20, 10], gapDays: 9 }, // gap ignored on the first phase
      { name: 'Block B', qty: [40, 10], gapDays: 3 },
      { name: 'Block C', qty: [40, 20], gapDays: 5 },
    ],
  });
  assert.deepEqual(
    s.phases.map((p: any) => p.days),
    [2, 2, 3], // 17.5 h, 27.5 h, 35 h at 16 h/day
  );
  assert.equal(s.installDays, 7); // more than the 5 days of the same work done continuously
  assert.equal(s.workingDays, 8);
  assert.equal(s.gapDays, 8);
  assert.equal(s.calendarDays, 16);
});

test('a phase with no work takes no days; zero capacity gives zero', () => {
  assert.equal(sched.daysFor(0, 16), 0);
  assert.equal(sched.daysFor(5, 16), 1);
  assert.equal(sched.daysFor(16, 16), 1);
  assert.equal(sched.daysFor(16.1, 16), 2);
  assert.equal(sched.daysFor(10, 0), 0);
});

test('phasedLineTrips rounds every phase separately', () => {
  assert.equal(sched.phasedLineTrips(0.5, [20, 40, 40], 16), 5); // 10 h, 20 h, 20 h -> 1 + 2 + 2
  assert.equal(sched.phasedLineTrips(0.5, [100], 16), 4); // continuous equivalent: 50 h -> 4
});

test('addWorkingDays skips Saturday and Sunday', () => {
  assert.equal(sched.addWorkingDays('2026-11-09', 5), '2026-11-16'); // Mon + 5 working days
  assert.equal(sched.addWorkingDays('2026-11-13', 1), '2026-11-16'); // Fri -> Mon
});
