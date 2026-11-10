import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuotationHandlers } from '../../apps/api/src/quotations/routes.js';

const dubaiToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());

function fakeService() {
  const calls: { create?: Record<string, unknown>; update?: Record<string, unknown> } = {};
  const service = {
    create: async (input: Record<string, unknown>) => {
      calls.create = input;
      return { id: '1' };
    },
    update: async (_id: string, input: Record<string, unknown>) => {
      calls.update = input;
      return { id: '1' };
    },
  };
  return { service: service as never, calls };
}

async function run(handlers: unknown[], body: Record<string, unknown>) {
  const last = handlers[handlers.length - 1] as (
    req: unknown,
    res: unknown,
    next: unknown,
  ) => Promise<void>;
  const response = {
    locals: { auth: { profileId: 'p1' } },
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  await last({ body, params: { id: '1' }, header: () => undefined }, response, (error: unknown) => {
    throw error;
  });
}

test('A new quotation is stamped with today (Dubai) whatever date the client sends', async () => {
  const { service, calls } = fakeService();
  const handlers = createQuotationHandlers(
    service,
    (() => (_q, _r, next) => next()) as never,
  ) as unknown as { create: unknown[] };
  await run(handlers.create, { customerName: 'A', quotationDate: '2001-01-01' });
  assert.equal(calls.create?.quotationDate, dubaiToday());
  await run(handlers.create, { customerName: 'B' });
  assert.equal(calls.create?.quotationDate, dubaiToday());
});

test('Editing a quotation never changes its date', async () => {
  const { service, calls } = fakeService();
  const handlers = createQuotationHandlers(
    service,
    (() => (_q, _r, next) => next()) as never,
  ) as unknown as { update: unknown[] };
  await run(handlers.update, { customerName: 'A', quotationDate: '2001-01-01' });
  assert.equal('quotationDate' in (calls.update ?? {}), false);
  assert.equal(calls.update?.customerName, 'A');
});
