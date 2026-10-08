import type { Pool } from 'pg';
import { invoiceSummary, listJobInvoices } from '../../../../packages/db/src/invoices.js';
import {
  insertBillingRule,
  listBillingRules,
  updateBillingRule,
} from '../../../../packages/db/src/billing-rules.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { billingRuleWriteSchema } from '../../../../packages/contracts/src/index.js';
import { randomUUID } from 'node:crypto';

export class InvoiceServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export function createInvoiceService(pool: Pool) {
  async function list(query: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      return await listJobInvoices(client, {
        type: text(query.type),
        paymentBy: text(query.paymentBy),
        paymentStatus: text(query.paymentStatus),
        search: text(query.search),
        page: Number(query.page ?? 1) || 1,
        pageSize: Number(query.pageSize ?? 50) || 50,
      });
    } finally {
      client.release();
    }
  }

  async function summary() {
    const client = await pool.connect();
    try {
      return await invoiceSummary(client);
    } finally {
      client.release();
    }
  }

  async function rules() {
    const client = await pool.connect();
    try {
      return await listBillingRules(client);
    } finally {
      client.release();
    }
  }

  async function createRule(input: unknown, profileId: string, requestId: string = randomUUID()) {
    const data = billingRuleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const rule = await insertBillingRule(client, data);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'billing_rule.created',
        targetType: 'billing_rule',
        targetId: rule.id,
        metadata: { billToChannel: rule.billToChannel },
        requestId,
      });
      return rule;
    });
  }

  async function updateRule(
    id: string,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    const data = billingRuleWriteSchema.parse(input);
    return withTransaction(pool, async (client) => {
      const rule = await updateBillingRule(client, id, data);
      if (!rule) throw new InvoiceServiceError('not-found', 'The billing rule was not found.');
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'billing_rule.updated',
        targetType: 'billing_rule',
        targetId: rule.id,
        metadata: { billToChannel: rule.billToChannel, active: rule.active },
        requestId,
      });
      return rule;
    });
  }

  return { list, summary, rules, createRule, updateRule };
}

export type InvoiceService = ReturnType<typeof createInvoiceService>;
