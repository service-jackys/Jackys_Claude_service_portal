import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { CHANGELOG } from '../../apps/api/src/changelog/changelog-data.js';
import { createChangelogHandlers } from '../../apps/api/src/changelog/routes.js';

test('changelog data covers every modification in modification.md, newest first', () => {
  const text = fs.readFileSync('modification.md', 'utf8');
  const ids = [...text.matchAll(/^## Modification #(\d+)/gm)].map((m) => Number(m[1]));
  assert.equal(CHANGELOG.length, ids.length, 'run: node scripts/build-changelog.mjs');
  assert.deepEqual(
    CHANGELOG.map((e) => e.id),
    [...ids].sort((a, b) => b - a),
  );
  for (const entry of CHANGELOG) assert.ok(entry.title.length > 0, `#${entry.id} has a title`);
});

test('changelog endpoint is administrator-only (admin.users) and returns the entries', () => {
  const asked: string[] = [];
  const handlers = createChangelogHandlers((permission) => {
    asked.push(permission);
    return ((_req: unknown, _res: unknown, next: () => void) => next()) as never;
  });
  assert.deepEqual(asked, ['admin.users']);
  assert.equal(handlers.list?.length, 2);
  let body: { total: number; entries: unknown[] } | undefined;
  const response = { setHeader() {}, json: (value: typeof body) => (body = value) };
  (handlers.list![1] as unknown as (req: unknown, res: unknown) => void)({}, response);
  assert.equal(body?.total, CHANGELOG.length);
});
