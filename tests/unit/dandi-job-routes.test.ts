import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import { createDiJobHandlers } from '../../apps/api/src/dandi-jobs/routes.js';
import {
  DiJobServiceError,
  type DiJobService,
} from '../../apps/api/src/dandi-jobs/jobs-service.js';

type Captured = { status: number; body: Record<string, unknown> | null };

async function call(
  service: Partial<DiJobService>,
  name: string,
  options: { permissions?: string[]; params?: Record<string, string>; body?: unknown } = {},
): Promise<Captured> {
  const needed: string[] = [];
  const handlers = createDiJobHandlers(
    service as DiJobService,
    (permission) => (_request, _response, next) => {
      needed.push(permission);
      next();
    },
    (_response, permission) => (options.permissions ?? []).includes(permission),
  );
  const captured: Captured = { status: 200, body: null };
  const response = {
    locals: { auth: { profileId: '7' } },
    status(code: number) {
      captured.status = code;
      return response;
    },
    type() {
      return response;
    },
    json(body: Record<string, unknown>) {
      captured.body = { ...body, _needed: needed.slice() };
      return response;
    },
  };
  const request = {
    params: options.params ?? {},
    query: {},
    body: options.body,
    header: () => undefined,
  };
  let error: unknown;
  for (const handler of handlers[name] as RequestHandler[]) {
    let moved = false;
    await handler(
      request as never,
      response as never,
      ((e?: unknown) => {
        moved = true;
        if (e) error = e;
      }) as never,
    );
    if (!moved) break;
  }
  if (error) throw error;
  return captured;
}

test('each D&I route asks for the right permission', async () => {
  const service = {
    list: async () => ({ jobs: [] }),
    create: async () => ({ job: {} }),
    reopen: async () => ({ job: {} }),
    updateSettings: async () => ({}),
    compare: async () => ({ rows: [] }),
    workedExample: async () => ({ invoice: 'X' }),
  } as unknown as Partial<DiJobService>;
  assert.deepEqual((await call(service, 'list')).body?._needed, ['di_jobs.read']);
  const created = await call(service, 'create', { body: {} });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body?._needed, ['di_jobs.write']);
  assert.deepEqual((await call(service, 'reopen', { params: { id: '1' } })).body?._needed, [
    'di_jobs.reopen',
  ]);
  assert.deepEqual((await call(service, 'compare')).body?._needed, ['di_jobs.compare']);
  assert.deepEqual((await call(service, 'workedExample')).body?._needed, ['di_jobs.compare']);
  assert.deepEqual((await call(service, 'updateSettings', { body: {} })).body?._needed, [
    'di_jobs.configure',
  ]);
});

test('service errors become the right problem responses', async () => {
  const fail = (error: Error) =>
    ({
      complete: async () => {
        throw error;
      },
    }) as unknown as Partial<DiJobService>;
  const params = { params: { id: '1' } };

  const incomplete = await call(
    fail(new DiJobServiceError('incomplete', 'Cannot complete.', ['Enter the ERP delivery note.'])),
    'complete',
    params,
  );
  assert.equal(incomplete.status, 422);
  assert.deepEqual(incomplete.body?.messages, ['Enter the ERP delivery note.']);
  assert.match(String(incomplete.body?.detail), /Enter the ERP delivery note/);

  assert.equal(
    (await call(fail(new DiJobServiceError('conflict', 'x')), 'complete', params)).status,
    409,
  );
  assert.equal(
    (await call(fail(new DiJobServiceError('not-found', 'x')), 'complete', params)).status,
    404,
  );
  assert.equal(
    (await call(fail(new DiJobServiceError('invalid', 'x')), 'complete', params)).status,
    400,
  );
  assert.equal(
    (await call(fail(new DiJobServiceError('forbidden', 'x')), 'complete', params)).status,
    403,
  );
  assert.equal(
    (
      await call(
        fail(new ZodError([{ code: 'custom', message: 'Bad date', path: [] }])),
        'complete',
        params,
      )
    ).status,
    400,
  );
  await assert.rejects(call(fail(new Error('boom')), 'complete', params), /boom/);
});

test('cancelling a completed job needs the reopen right, which the route passes on', async () => {
  let received: boolean | null = null;
  const service = {
    cancel: async (_id: string, _profile: string, canReopen: boolean) => {
      received = canReopen;
      return { job: {} };
    },
  } as unknown as Partial<DiJobService>;
  await call(service, 'cancel', { params: { id: '1' }, permissions: [] });
  assert.equal(received, false);
  await call(service, 'cancel', { params: { id: '1' }, permissions: ['di_jobs.reopen'] });
  assert.equal(received, true);
});
