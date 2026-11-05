import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  dandiFlatRateDefaults,
  pricingConfigSchemaFor,
  thomsonPricingSchema,
  type ApplianceMasterInput,
  type PricingConfigDomain,
} from '../../../../packages/contracts/src/index.js';
import {
  getPricingConfig,
  getPricingConfigHistoryEntry,
  listPricingConfigHistory,
  upsertPricingConfig,
} from '../../../../packages/db/src/pricing-configs.js';
import {
  buildApplianceMaster,
  pricingConfigDefaults,
} from '../../../../packages/db/src/pricing-config-defaults.js';
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

// A D+I Admin Entry saved before the flat job-type rates existed (#114) has no
// flatRates block; show the defaults so the form always has values to edit.
function withDandiFlatRates(domain: PricingConfigDomain, payload: unknown): unknown {
  if (domain !== 'dandi_pricing' || !payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  return record.flatRates ? payload : { ...record, flatRates: { ...dandiFlatRateDefaults } };
}

// Keeps the Thomson appliance list in step with the shared Appliance Master:
// a master appliance ticked for Thomson that Thomson does not list yet is
// added with ZERO rates and switched off (so nothing can be quoted at 0 AED
// until the admin sets its rates and ticks it Active in Thomson Pricing
// Admin); an appliance the master retires or un-ticks is switched off in
// Thomson. Existing rates, tiers and times are never touched.
async function syncThomsonWithMaster(
  client: PoolClient,
  master: ApplianceMasterInput,
  renames: { from: string; to: string }[],
  profileId: string,
  requestId: string,
) {
  const row = await getPricingConfig(client, 'thomson_pricing');
  const current = thomsonPricingSchema.parse(row?.payload ?? pricingConfigDefaults.thomson_pricing);
  let changed = false;
  const appliances = current.appliances.map((a) => ({ ...a }));
  // A renamed appliance keeps its Thomson rates, tiers and time: only the name
  // changes (skipped if Thomson already has a row under the new name).
  for (const rename of renames) {
    const fromKey = rename.from.trim().toLowerCase();
    const toKey = rename.to.trim().toLowerCase();
    const target = appliances.find((a) => a.name.trim().toLowerCase() === fromKey);
    if (target && !appliances.some((a) => a.name.trim().toLowerCase() === toKey)) {
      target.name = rename.to;
      changed = true;
    }
  }
  for (const item of master.appliances) {
    const key = item.name.trim().toLowerCase();
    const wanted = item.thomsonEnabled && item.active;
    const existing = appliances.find((a) => a.name.trim().toLowerCase() === key);
    if (!existing && item.thomsonEnabled) {
      appliances.push({
        name: item.name,
        rates: { Base: 0, '50+': 0, '150+': 0, '300+': 0, '500+': 0 },
        avgMin: 30,
        active: false,
      });
      changed = true;
    } else if (existing && !wanted && existing.active !== false) {
      existing.active = false;
      changed = true;
    }
  }
  if (!changed) return;
  const payload = { ...current, appliances };
  const saved = await upsertPricingConfig(client, 'thomson_pricing', payload, true, profileId);
  await insertAuditEvent(client, {
    actorProfileId: profileId,
    action: 'pricing_config.saved',
    targetType: 'pricing_config',
    targetId: saved.id,
    metadata: { domain: 'thomson_pricing', payload, syncedFrom: 'appliance_master' },
    requestId,
  });
}

export function createPricingConfigService(pool: Pool) {
  async function get(domain: PricingConfigDomain): Promise<PricingConfigView> {
    const client = await pool.connect();
    try {
      const row = await getPricingConfig(client, domain);
      if (!row && domain === 'appliance_master') {
        // First read of the shared Appliance Master: build it from whatever
        // the AMC and Thomson configurations hold right now (saved override or
        // Excel default), so no appliance or AMC price is lost.
        const amc = await getPricingConfig(client, 'amc_pricing');
        const thomson = await getPricingConfig(client, 'thomson_pricing');
        return {
          domain,
          payload: buildApplianceMaster(
            (amc?.payload ?? pricingConfigDefaults.amc_pricing) as Parameters<
              typeof buildApplianceMaster
            >[0],
            (thomson?.payload ?? pricingConfigDefaults.thomson_pricing) as Parameters<
              typeof buildApplianceMaster
            >[1],
          ),
          isOverride: false,
          updatedBy: null,
          updatedAt: null,
        };
      }
      if (row) {
        return {
          domain,
          payload: withDandiFlatRates(domain, row.payload),
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
    let payload = pricingConfigSchemaFor(domain).parse(input);
    // Appliance Master: renamedFrom marks a renamed row. It is applied to the
    // Thomson list below and never stored in the master itself.
    const renames: { from: string; to: string }[] = [];
    if (domain === 'appliance_master') {
      const master = payload as ApplianceMasterInput;
      payload = {
        appliances: master.appliances.map(({ renamedFrom, ...item }) => {
          if (renamedFrom && renamedFrom.toLowerCase() !== item.name.toLowerCase()) {
            renames.push({ from: renamedFrom, to: item.name });
          }
          return item;
        }),
      };
    }
    return withTransaction(pool, async (client) => {
      const row = await upsertPricingConfig(client, domain, payload, true, profileId);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'pricing_config.saved',
        targetType: 'pricing_config',
        targetId: row.id,
        metadata: renames.length ? { domain, payload, renames } : { domain, payload },
        requestId,
      });
      if (domain === 'appliance_master') {
        await syncThomsonWithMaster(
          client,
          payload as ApplianceMasterInput,
          renames,
          profileId,
          requestId,
        );
      }
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
