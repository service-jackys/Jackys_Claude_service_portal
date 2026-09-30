import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  pricingConfigSchemaFor,
  type PricingConfigDomain,
} from '../../../../packages/contracts/src/index.js';
import {
  getPricingConfig,
  getPricingConfigHistoryEntry,
  listPricingConfigHistory,
  upsertPricingConfig,
} from '../../../../packages/db/src/pricing-configs.js';
import { pricingConfigDefaults } from '../../../../packages/db/src/pricing-config-defaults.js';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';

// Phase 6 (see modification.md #26): admin entry for VAS price banding &
// split, Rate Card, D+I, AMC and Thomson pricing. Every domain shares this
// one service -- get, save, reset-to-Excel-default, history and restore --
// because the "no dependency on Excel once saved, but always revertible,
// with every change logged so a past entry can be loaded" requirement is
// identical across all 7 domains; only the payload shape (validated via
// pricingConfigSchemaFor) and the Excel default differ.

export class PricingConfigServiceError extends Error {
  constructor(
    public readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export type PricingConfigView = {
  domain: PricingConfigDomain;
  payload: unknown;
  isOverride: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export function createPricingConfigService(pool: Pool) {
  async function get(domain: PricingConfigDomain): Promise<PricingConfigView> {
    const client = await pool.connect();
    try {
      const row = await getPricingConfig(client, domain);
      if (row) {
        return {
          domain,
          payload: row.payload,
          isOverride: row.isOverride,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt.toISOString(),
        };
      }
      // No row yet -- this domain has never been saved (fresh install, or
      // this migration just ran) -- fall back to the Excel default rather
      // than erroring, exactly as "default values from excel and no
      // dependency needed [until changed]" asks.
      return {
        domain,
        payload: pricingConfigDefaults[domain],
        isOverride: false,
        updatedBy: null,
        updatedAt: null,
      };
    } finally {
      client.release();
    }
  }

  async function save(
    domain: PricingConfigDomain,
    input: unknown,
    profileId: string,
    requestId: string = randomUUID(),
  ): Promise<PricingConfigView> {
    const payload = pricingConfigSchemaFor(domain).parse(input);
    return withTransaction(pool, async (client) => {
      const row = await upsertPricingConfig(client, domain, payload, true, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'pricing_config.saved',
        targetType: 'pricing_config',
        targetId: row.id,
        metadata: { domain, payload },
        requestId,
      });
      return {
        domain,
        payload: row.payload,
        isOverride: row.isOverride,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  // Reset re-applies the Excel default as the new CURRENT value (rather
  // than deleting the row) so `get` above and the history list both stay
  // uniform, and so the reset itself is logged and later restorable too --
  // "admin can always revert to excel default" is itself just another
  // versioned change, not a special unlogged case.
  async function reset(
    domain: PricingConfigDomain,
    profileId: string,
    requestId: string = randomUUID(),
  ): Promise<PricingConfigView> {
    const payload = pricingConfigDefaults[domain];
    return withTransaction(pool, async (client) => {
      const row = await upsertPricingConfig(client, domain, payload, false, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'pricing_config.reset',
        targetType: 'pricing_config',
        targetId: row.id,
        metadata: { domain, payload },
        requestId,
      });
      return {
        domain,
        payload: row.payload,
        isOverride: row.isOverride,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async function history(domain: PricingConfigDomain, limit?: number) {
    const client = await pool.connect();
    try {
      return await listPricingConfigHistory(client, domain, limit);
    } finally {
      client.release();
    }
  }

  // "load it based on the update entry" -- restore takes a past
  // audit_events id (as listed by `history` above) and re-applies its
  // snapshot as the new current value, itself logged as a fresh
  // pricing_config.restored event so restoring is never a dead end.
  async function restore(
    domain: PricingConfigDomain,
    auditEventId: string,
    profileId: string,
    requestId: string = randomUUID(),
  ): Promise<PricingConfigView> {
    return withTransaction(pool, async (client) => {
      const entry = await getPricingConfigHistoryEntry(client, domain, auditEventId);
      if (!entry) {
        throw new PricingConfigServiceError('not-found', 'That saved entry was not found.');
      }
      const payload = pricingConfigSchemaFor(domain).parse(entry.payload);
      const row = await upsertPricingConfig(client, domain, payload, true, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'pricing_config.restored',
        targetType: 'pricing_config',
        targetId: row.id,
        metadata: { domain, payload, restoredFromAuditEventId: auditEventId },
        requestId,
      });
      return {
        domain,
        payload: row.payload,
        isOverride: row.isOverride,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  return { get, save, reset, history, restore };
}

export type PricingConfigService = ReturnType<typeof createPricingConfigService>;
