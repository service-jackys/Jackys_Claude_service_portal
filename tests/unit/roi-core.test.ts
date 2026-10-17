import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// roi-core.js is a browser script (UMD); evaluate it with a stand-in module.
const source = readFileSync(new URL('../../apps/web/src/roi-core.js', import.meta.url), 'utf8');
const holder: { exports: Record<string, any> } = { exports: {} };
new Function('module', 'self', source)(holder, undefined);
const roi = holder.exports;

test('ISO weeks match the Week 40 / 02-OCT-2026 ROI mail', () => {
  const week = roi.isoWeek('2026-10-02');
  assert.deepEqual(
    [week.year, week.week, week.start, week.end, week.friday],
    [2026, 40, '2026-09-28', '2026-10-04', '2026-10-02'],
  );
  assert.equal(roi.isoWeek('2026-10-04').week, 40);
  assert.equal(roi.isoWeek('2026-10-05').week, 41);
  // Year boundaries
  assert.deepEqual([roi.isoWeek('2026-01-01').year, roi.isoWeek('2026-01-01').week], [2026, 1]);
  assert.deepEqual([roi.isoWeek('2025-12-29').year, roi.isoWeek('2025-12-29').week], [2026, 1]);
  assert.deepEqual([roi.isoWeek('2021-01-03').year, roi.isoWeek('2021-01-03').week], [2020, 53]);
  assert.equal(roi.isoWeekRange(2026, 40).start, '2026-09-28');
  assert.equal(roi.shiftWeek('2026-10-02', -1).week, 39);
  assert.equal(roi.formatRoiDate('2026-10-02'), '02-OCT-2026');
  assert.equal(roi.subjectFor('Vysakh Raju', week), 'VYSAKH RAJU-Weekly ROI: Week 40 02-OCT-2026');
  // Dubai is UTC+4: 21:00 UTC on the 1st is already the 2nd in Dubai.
  assert.equal(roi.dubaiDay('2026-10-01T21:00:00Z'), '2026-10-02');
});

const week = roi.isoWeek('2026-10-02');
const task = (over: Record<string, unknown>) => ({
  title: 't',
  kind: 'task',
  status: 'not_started',
  priority: 'medium',
  percentComplete: 0,
  startDate: null,
  dueDate: null,
  remarks: null,
  completedAt: null,
  sortOrder: 0,
  ...over,
});

test('groupForWeek puts tasks in Result, Objective and Issues', () => {
  const groups = roi.groupForWeek(
    [
      task({
        title: 'done in week',
        status: 'completed',
        percentComplete: 100,
        completedAt: '2026-10-01T05:00:00Z',
      }),
      task({
        title: 'done before',
        status: 'completed',
        percentComplete: 100,
        completedAt: '2026-09-20T05:00:00Z',
      }),
      task({
        title: 'done after',
        status: 'completed',
        percentComplete: 100,
        completedAt: '2026-10-05T05:00:00Z',
      }),
      task({
        title: 'just after midnight dubai',
        status: 'completed',
        percentComplete: 100,
        completedAt: '2026-10-04T20:30:00Z',
      }),
      task({ title: 'low open', priority: 'low', status: 'in_progress', percentComplete: 30 }),
      task({
        title: 'urgent open',
        priority: 'urgent',
        status: 'in_progress',
        percentComplete: 30,
      }),
      task({ title: 'future start', startDate: '2026-10-20' }),
      task({ title: 'erp access', kind: 'issue' }),
      task({ title: 'closed issue', kind: 'issue', status: 'completed' }),
    ],
    week,
  );
  assert.deepEqual(
    groups.results.map((t: any) => t.title),
    ['done in week'],
  );
  assert.deepEqual(
    groups.objectives.map((t: any) => t.title),
    ['urgent open', 'low open'],
  );
  assert.deepEqual(
    groups.issues.map((t: any) => t.title),
    ['erp access'],
  );
});

test('weekly budget is the monthly budget pro-rated by days and sums back to it', () => {
  // October 2026 spans weeks 40 (from Oct 1) to 44 (to Oct 31).
  const weeks = [40, 41, 42, 43, 44].map((w) => ({ week: w, actual: 1000 }));
  const rows = roi.weeklyBudget(31000, 2026, 10, weeks);
  assert.deepEqual(
    rows.map((r: any) => r.days),
    [4, 7, 7, 7, 6],
  );
  assert.equal(rows[0].from, '2026-10-01');
  assert.equal(rows[4].to, '2026-10-31');
  const total = rows.reduce((sum: number, r: any) => sum + r.budget, 0);
  assert.ok(Math.abs(total - 31000) < 1e-6);
  assert.equal(Math.round(rows[0].budget), 4000);
  assert.equal(Math.round(rows[0].variance), -3000);
});

const summary = {
  monthLabel: 'September 2026',
  totals: { jobs: 157, qty: 299, revenue: 27878 },
  byType: [{ code: 'CSIDI', label: 'Delivery + Install', jobs: 64, revenue: 19700 }],
  weeks: [{ label: 'W39', jobs: 43, qty: 73, revenue: 6720 }],
  budget: {
    monthLabel: 'Sep 26',
    monthBudget: 30000,
    monthActual: 27878,
    weeks: roi.weeklyBudget(30000, 2026, 9, [{ week: 39, actual: 6720 }]),
    ytd: { budget: 200000, actual: 180000 },
  },
  source: 'master.xlsm',
};
const input = {
  week,
  name: 'Vysakh Raju',
  title: 'Head of Service',
  greeting: 'Dear Sir,',
  signature: 'VYSAKH RAJU\nHead of Service',
  groups: roi.groupForWeek(
    [
      task({
        title: 'Complaint <portal>',
        status: 'completed',
        percentComplete: 100,
        completedAt: '2026-10-01T05:00:00Z',
        remarks: 'Live',
      }),
      task({
        title: 'Cost model',
        status: 'in_progress',
        percentComplete: 50,
        dueDate: '2026-10-20',
        remarks: 'Ongoing',
      }),
      task({ title: 'ERP access', kind: 'issue', remarks: 'Send separately' }),
    ],
    week,
  ),
  summary,
};

test('ROI email carries every section, escapes text and omits the summary when absent', () => {
  const html = roi.buildRoiHtml(input);
  for (const needle of [
    'WEEK 40 — 02-OCT-2026',
    'Dear Sir,',
    '>Result<',
    'Complaint &lt;portal&gt;',
    'Management summary: September 2026',
    'Revenue by job type',
    'Weekly management summary',
    'Achievement against budget',
    'AED 27,878',
    '50% &rarr; 100%',
    'Issues / Innovation',
    'ERP access',
    'Head of Service',
  ]) {
    assert.ok(html.includes(needle), 'missing: ' + needle);
  }
  assert.ok(!html.includes('<portal>'));
  const plain = roi.buildRoiHtml({ ...input, summary: null });
  assert.ok(!plain.includes('Management summary'));
  assert.ok(!plain.includes('Achievement against budget'));
  const text = roi.buildRoiText(input);
  assert.match(text, /RESULT\n {2}- Complaint <portal> \[Completed, 100%\] Live/);
  assert.match(text, /MANAGEMENT SUMMARY: SEPTEMBER 2026/);
  assert.match(text, /OBJECTIVE\n {2}- Cost model \[50% -> 100%, In Progress, due 20 Oct\]/);
  assert.match(text, /\* Issue: ERP access - Send separately/);
});

test('.eml draft is unsent, addressed and decodes back to the HTML', () => {
  const html = roi.buildRoiHtml(input);
  const eml = roi.buildEml({
    to: ['manohar@jackys.com', 'james.paul@jackys.com'],
    cc: ['hr.desk@jackys.com'],
    subject: roi.subjectFor('Vysakh Raju', week),
    html,
    text: roi.buildRoiText(input),
  });
  assert.match(
    eml,
    /^X-Unsent: 1\r\nTo: manohar@jackys.com; james.paul@jackys.com\r\nCc: hr.desk@jackys.com\r\nSubject: VYSAKH RAJU-Weekly ROI: Week 40 02-OCT-2026\r\n/,
  );
  const parts = eml.split(/--=_jd_[a-z0-9]+/);
  const htmlPart = parts.find((p: string) => p.includes('text/html'))!;
  const body = htmlPart.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), html);
  assert.equal(
    roi
      .buildEml({ to: [], cc: [], subject: 'Résumé', html: 'x', text: 'x' })
      .includes('=?UTF-8?B?'),
    true,
  );
});

test('recipient parsing accepts commas, semicolons and line breaks', () => {
  assert.deepEqual(roi.parseEmails('a@x.com; b@y.com,\n c@z.com'), [
    'a@x.com',
    'b@y.com',
    'c@z.com',
  ]);
  assert.equal(roi.isEmail('a@x.com'), true);
  assert.equal(roi.isEmail('nope'), false);
});
