// Builds apps/api/src/changelog/changelog-data.ts from modification.md.
// Re-run after adding a modification:  node scripts/build-changelog.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(root, 'modification.md'), 'utf8').replace(/\r\n/g, '\n');

const clean = (s) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,;:(-]+\S*$/, '') + '…');

const AREAS = [
  ['Revenue', /revenue|csido|csidi|budget|variance|workbook|dashboard export/i],
  ['Permissions', /permission|role|login|team|access|admin\b|password/i],
  [
    'Pricing & rates',
    /pricing|rate card|rate-card|d\+i|dandi|vas|thomson|amc|quote calc|calculator|flat rate/i,
  ],
  ['Invoices & billing', /invoice|billing|tax|vat|print|letterhead/i],
  ['Job cards', /job card|job-card|walk-in|job status/i],
  ['Scheduler', /schedul|appointment|technician|calendar|whatsapp|ics/i],
  ['Complaints', /complaint|warranty|b2b|customer/i],
  ['Tasks', /\btask|roi|kanban/i],
  ['Stock & masters', /stock|master|item code|model|salesm|branch/i],
  [
    'Portal look & feel',
    /compact|layout|toast|notification|style|redesign|full-width|column|sidebar|navigation|colou?r|screen|view|filter|search|list|form\b|landing|dashboard|status/i,
  ],
];
const areaOf = (title) => (AREAS.find(([, re]) => re.test(title)) || ['General'])[0];

// Commit dates for recent modifications ("... (#N)" in the commit subject), used when an entry has no written date.
const commitDate = new Map();
try {
  const log = execSync('git log --format=%ad%x09%s --date=short', { cwd: root, encoding: 'utf8' });
  for (const line of log.split('\n')) {
    const [d, ...sub] = line.split('\t');
    const n = (sub.join('\t').match(/\(#(\d+)\)\s*$/) || [])[1];
    if (n && Number(n) >= 100 && (!commitDate.has(+n) || d < commitDate.get(+n)))
      commitDate.set(+n, d);
  }
} catch {}

const parts = text.split(/^## Modification #/m).slice(1);
const entries = parts.map((raw) => {
  const nl = raw.indexOf('\n');
  const head = raw.slice(0, nl);
  const body = raw.slice(nl + 1);
  const m = head.match(/^(\d+)\s*[—–-]\s*(.*)$/);
  const id = Number(m[1]);
  const title = clean(m[2]);
  const dateMatch =
    body.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/) ||
    body.match(/(2026-\d{2}-\d{2})/) ||
    (commitDate.has(id) ? [null, commitDate.get(id)] : null);
  const statusMatch = body.match(/\*\*Status:\*\*\s*([^\n]+)/);
  const status = statusMatch ? clean(statusMatch[1]).split(/\s[—–-]\s/)[0] : null;
  const why =
    body.match(/\*\*Why\.?\*\*\.?\s*([\s\S]*?)(?:\n\s*\n|$)/) ||
    body.match(/###\s*Why\s*\n+([\s\S]*?)(?:\n\s*\n|$)/);
  const scope = body.match(/\*\*Scope:\*\*\s*([^\n]+)/);
  const wc = body.match(
    /(?:###\s*What changed|\*\*What changed\.?\*\*)\s*\n([\s\S]*?)(?=\n###\s|\n\*\*[A-Z][^*\n]{1,30}[.:]\*\*|\n## |$)/,
  );
  const items = [];
  if (wc) {
    let cur = null;
    for (const line of wc[1].split('\n')) {
      const b = line.match(/^(?:- |\d+\.\s)(.*)$/);
      if (b) {
        if (cur) items.push(cur);
        cur = b[1];
      } else if (cur !== null && /^\s+\S/.test(line)) cur += ' ' + line.trim();
      else if (!line.trim() && cur !== null) {
        items.push(cur);
        cur = null;
      }
    }
    if (cur) items.push(cur);
  }
  if (!items.length) {
    for (const line of body.split('\n')) {
      const lead = line.match(/^\*\*([^*]{3,70}?)\.?\*\*\.?\s*(.*)$/);
      if (lead && !/^(Why|Files|Needs you|Date|Status|Scope|Not done|Reports)/i.test(lead[1]))
        items.push(lead[1] + (lead[2] ? ': ' + lead[2] : ''));
    }
  }
  const firstPara =
    body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find(
        (p) =>
          p &&
          !/^(- \*\*|#|\*\*(Date|Status|Why|Files|Needs|What changed))/.test(p) &&
          !/^- /.test(p),
      ) || '';
  const summary = cut(clean(why ? why[1] : scope ? scope[1] : firstPara || items[0] || ''), 320);
  const changes = items
    .map((s) => cut(clean(s), 240))
    .filter(Boolean)
    .slice(0, 8);
  const needs = body.match(/\*\*Needs you:?\*\*:?\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/);
  const files = body.match(/\*\*Files\.?\*\*\.?\s*([^\n]+)/);
  const migrations = [...new Set(body.match(/\b\d{3}_[a-z0-9_]+\.sql\b/g) || [])];
  return {
    id,
    title,
    area: areaOf(title),
    date: dateMatch ? dateMatch[1] : null,
    approxDate: false,
    status,
    summary,
    changes,
    needsYou: needs ? cut(clean(needs[1]), 260) : null,
    migrations,
    files: files ? cut(clean(files[1]), 200) : null,
  };
});
// Entries are numbered in order; where an entry has no written date, carry the previous known one and flag it.
let last = null;
for (const e of entries) {
  if (e.date) last = e.date;
  else if (last) {
    e.date = last;
    e.approxDate = true;
  }
}
const out = `// GENERATED by scripts/build-changelog.mjs from modification.md - do not edit by hand.
export interface ChangelogEntry {
  id: number;
  title: string;
  area: string;
  date: string | null;
  approxDate: boolean;
  status: string | null;
  summary: string;
  changes: string[];
  needsYou: string | null;
  migrations: string[];
  files: string | null;
}

export const CHANGELOG: ChangelogEntry[] = ${JSON.stringify(entries.reverse(), null, 2)};
`;
fs.writeFileSync(path.join(root, 'apps/api/src/changelog/changelog-data.ts'), out);
console.log(
  'entries',
  entries.length,
  'dated',
  entries.filter((e) => e.date && !e.approxDate).length,
  'with changes',
  entries.filter((e) => e.changes.length).length,
  'with summary',
  entries.filter((e) => e.summary).length,
);
