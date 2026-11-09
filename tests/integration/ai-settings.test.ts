import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../../apps/api/src/ai/crypto.js';
import { resolveBaseUrl } from '../../apps/api/src/ai/provider.js';
import { createAiService } from '../../apps/api/src/ai/service.js';
import { createDbPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';

const databaseUrl = process.env.DATABASE_URL;

test('the stored key round-trips and a wrong secret cannot read it', () => {
  const stored = encryptSecret('sk-test-1234567890', 'a-server-secret-of-16-chars');
  assert.ok(!stored.includes('sk-test'));
  assert.equal(decryptSecret(stored, 'a-server-secret-of-16-chars'), 'sk-test-1234567890');
  assert.throws(() => decryptSecret(stored, 'another-secret-16-chars!'));
});

test('provider addresses: defaults, https only, custom needs one', () => {
  assert.equal(resolveBaseUrl('anthropic', null), 'https://api.anthropic.com');
  assert.equal(resolveBaseUrl('openrouter', ''), 'https://openrouter.ai/api/v1');
  assert.equal(
    resolveBaseUrl('custom', 'https://gateway.example.com/v1/'),
    'https://gateway.example.com/v1',
  );
  assert.equal(resolveBaseUrl('custom', 'http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.throws(() => resolveBaseUrl('custom', null));
  assert.throws(() => resolveBaseUrl('custom', 'http://example.com/v1'));
});

test(
  'AI settings are saved encrypted, never returned, and used for the Smart advice wording',
  { skip: !databaseUrl, concurrency: false },
  async (context) => {
    try {
      await migrate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        context.skip('PostgreSQL is not available');
        return;
      }
      throw error;
    }
    const pool = createDbPool(databaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    let mode: 'ok' | 'fail' = 'ok';
    const fakeFetch = (async (url: string, init: any) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (mode === 'fail')
        return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
      const anthropic = String(url).includes('/v1/messages');
      return new Response(
        JSON.stringify(
          anthropic
            ? { content: [{ type: 'text', text: 'Add one technician.' }] }
            : { choices: [{ message: { content: 'Add one technician.' } }] },
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const ai = createAiService(pool, {
      fetchImpl: fakeFetch,
      secret: 'a-server-secret-of-16-chars',
    });
    let profileId: string | undefined;
    const advice = {
      projectDays: 13,
      thresholdDays: 10,
      workMode: 'continuous' as const,
      technicians: 2,
      hoursPerDay: 8,
      marginPct: 40,
      minMarginPct: 15,
      options: [
        {
          title: 'Deploy 3 technicians',
          days: 9,
          marginChange: 240,
          marginPct: 42,
          withinGuard: true,
        },
      ],
    };
    try {
      profileId = (
        await pool.query<{ id: string }>(
          `INSERT INTO profiles (email, display_name) VALUES ($1, 'AI settings') RETURNING id`,
          [`ai-settings-${suffix}@example.test`],
        )
      ).rows[0].id;
      // Not configured yet: no wording, and a clear error rather than a crash.
      await pool.query('DELETE FROM ai_settings');
      assert.equal((await ai.status()).available, false);
      await assert.rejects(ai.advise(advice), /not set up/);

      const saved = await ai.save(
        {
          provider: 'openrouter',
          model: 'anthropic/claude-haiku-4.5',
          enabled: true,
          apiKey: 'sk-or-secret-123456',
        },
        profileId,
      );
      assert.equal(saved.hasKey, true);
      assert.equal(saved.keyHint, '••••3456');
      assert.ok(!JSON.stringify(saved).includes('sk-or-secret'));
      const row = await pool.query('SELECT api_key_encrypted FROM ai_settings');
      assert.ok(!row.rows[0].api_key_encrypted.includes('sk-or-secret'));
      assert.equal((await ai.status()).available, true);

      const test1 = await ai.test();
      assert.equal(test1.ok, true);
      assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(calls[0].headers.authorization, 'Bearer sk-or-secret-123456');

      const wording = await ai.advise(advice);
      assert.equal(wording.text, 'Add one technician.');
      assert.equal(calls[1].body.model, 'anthropic/claude-haiku-4.5');
      assert.ok(JSON.stringify(calls[1].body.messages).includes('Deploy 3 technicians'));

      // Saving again without a key keeps the stored one; switching to Anthropic uses its API shape.
      await ai.save({ provider: 'anthropic', model: 'claude-haiku-4-5', enabled: true }, profileId);
      const keep = await ai.advise(advice);
      assert.equal(keep.text, 'Add one technician.');
      const last = calls[calls.length - 1];
      assert.equal(last.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(last.headers['x-api-key'], 'sk-or-secret-123456');

      // Ask-AI chat: earlier turns and the quote's figures reach the provider.
      const quote = {
        source: 'calculator' as const,
        mode: 'project' as const,
        transportSharePercent: 0,
        totals: { price: 540, cost: 300, margin: 240, marginPct: 44.4 },
        minMarginPct: 15,
        lines: [
          {
            region: 'Dubai',
            appliance: 'Built-in Hob',
            qty: 3,
            unitRate: 100,
            equipment: 300,
            services: 240,
            transportCharged: 0,
            transportCost: 60,
            totalPrice: 540,
            totalCost: 300,
            margin: 240,
          },
        ],
      };
      const reply = await ai.chat({
        messages: [
          { role: 'user', content: 'What is my margin?' },
          { role: 'assistant', content: 'About 44%.' },
          { role: 'user', content: 'And on the hobs?' },
        ],
        quote,
      });
      assert.equal(reply.text, 'Add one technician.');
      const chatCall = calls[calls.length - 1];
      assert.ok(String(chatCall.body.system).includes('Built-in Hob'));
      assert.equal(chatCall.body.messages.length, 3);
      assert.equal(chatCall.body.messages[2].content, 'And on the hobs?');
      await assert.rejects(
        ai.chat({ messages: [{ role: 'assistant', content: 'Hello' }], quote }),
        /must be a question/,
      );
      await assert.rejects(ai.chat({ messages: [{ role: 'user', content: 'x' }], quote: {} }));

      // Ask AI across the portal: figures reach the provider, personal fields do not.
      const asked = await ai.ask({
        section: 'revenue',
        title: 'Budget vs actual',
        messages: [{ role: 'user', content: 'Where are we behind budget?' }],
        context: {
          summary: { budget: 1000, actual: 800 },
          rows: [
            { month: 'Oct', budget: 500, actual: 300, customerName: 'Secret LLC', phone: '0501' },
          ],
        },
      });
      assert.equal(asked.text, 'Add one technician.');
      const askCall = calls[calls.length - 1];
      assert.ok(String(askCall.body.system).includes('"budget":1000'));
      assert.ok(!String(askCall.body.system).includes('Secret LLC'));
      assert.ok(!String(askCall.body.system).includes('0501'));
      // Beyond the screen: the uploaded workbook summary is added only when the
      // person's permissions allow it.
      await ai.ask(
        {
          section: 'revenue',
          title: 'Budget vs actual',
          messages: [{ role: 'user', content: 'And last year?' }],
          context: { summary: { budget: 1 } },
          includeWorkbook: true,
        },
        { revenue: true, budget: false },
      );
      const wbCall = calls[calls.length - 1];
      assert.ok(String(wbCall.body.system).includes('"onScreen"'));
      assert.ok(String(wbCall.body.system).includes('"revenueWorkbook"'));
      assert.ok(!String(wbCall.body.system).includes('"budgetWorkbook"'));
      await ai.ask({
        section: 'revenue',
        title: 'Budget vs actual',
        messages: [{ role: 'user', content: 'And last year?' }],
        context: { summary: { budget: 1 } },
        includeWorkbook: true,
      });
      assert.ok(!String(calls[calls.length - 1].body.system).includes('"workbook"'));
      // Complaints: the counts-and-statuses snapshot needs the record permission.
      const complaintsAsk = (includePortalData: boolean) =>
        ai.ask(
          {
            section: 'complaints',
            title: 'Complaints',
            messages: [{ role: 'user', content: 'How many are open?' }],
            context: { statusFilter: 'All' },
            includePortalData,
          },
          { revenue: false, budget: false, can: (code: string) => code === 'complaints.read' },
        );
      await complaintsAsk(true);
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await complaintsAsk(false);
      assert.ok(!String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'appointments',
          title: 'Appointments',
          messages: [{ role: 'user', content: 'How many are overdue?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'appointments.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'job_cards',
          title: 'Job cards',
          messages: [{ role: 'user', content: 'How many wait for spares?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'service_job_card.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'quotations',
          title: 'Quotations',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'quotation.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'inspections',
          title: 'Inspections',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'inspection.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'warranty_approvals',
          title: 'Warranty approvals',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'warranty_approval.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'delivery_install',
          title: 'Delivery and installation jobs',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'di_jobs.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'walk_in',
          title: 'Walk-in job cards',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
          includePortalData: true,
        },
        { revenue: false, budget: false, can: (code: string) => code === 'service_job_card.read' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('"portalData"'));
      await ai.ask(
        {
          section: 'rate_card',
          title: 'Rate card',
          messages: [{ role: 'user', content: 'How many are pending?' }],
          context: { statusFilter: 'All' },
        },
        { revenue: false, budget: false, can: (code: string) => code === 'rate_card.view' },
      );
      assert.ok(String(calls[calls.length - 1].body.system).includes('Rate Card'));
      await assert.rejects(
        ai.ask({
          section: 'revenue',
          title: 'x',
          messages: [{ role: 'assistant', content: 'Hi' }],
          context: {},
        }),
        /must be a question/,
      );
      await assert.rejects(
        ai.ask({
          section: 'nope',
          title: 'x',
          messages: [{ role: 'user', content: 'Hi' }],
          context: {},
        }),
      );

      // A provider failure is reported, and the test result is remembered.
      mode = 'fail';
      await assert.rejects(ai.advise(advice), /401/);
      const failed = await ai.test();
      assert.equal(failed.ok, false);
      assert.equal((await ai.get()).lastTestOk, false);

      // Removing the key turns the wording off.
      await ai.save(
        { provider: 'anthropic', model: 'claude-haiku-4-5', enabled: true, apiKey: '' },
        profileId,
      );
      assert.equal((await ai.status()).available, false);

      await assert.rejects(
        ai.save({ provider: 'custom', model: 'x', enabled: true }, profileId),
        /base URL/,
      );
    } finally {
      await pool.query('DELETE FROM ai_settings');
      if (profileId)
        await pool.query('DELETE FROM profiles WHERE id = $1', [profileId]).catch(() => undefined);
      await pool.end();
    }
  },
);
