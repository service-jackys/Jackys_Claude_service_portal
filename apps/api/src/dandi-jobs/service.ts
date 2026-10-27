import type { Pool } from 'pg';
import { z } from 'zod';
import type { DandiPricingInput } from '../../../../packages/contracts/src/index.js';
import { resolveItemCategories } from '../../../../packages/db/src/category-mappings.js';
import { createPricingConfigService } from '../pricing-config/service.js';
import { engineMasterFromDandi, priceDeliveryNote, type EngineResult } from './pricing-engine.js';

export const priceNoteSchema = z
  .object({
    region: z.string().trim().max(50),
    lines: z
      .array(
        z
          .object({
            itemCode: z.string().trim().min(1).max(100),
            qty: z.number(),
            type: z.enum(['CSIDI', 'CSIDO', 'CSIII']),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type PriceNoteInput = z.infer<typeof priceNoteSchema>;

export type PricedNote = EngineResult & {
  /** What the item master and the category mapping said about each line's item. */
  items: { itemCode: string; groupName: string | null; installable: boolean | null }[];
};

/**
 * Prices a delivery note from item codes: looks every item up in the stock
 * master and the category mapping, reads the rates from the D+I pricing master
 * and runs the pricing engine. Nothing is saved.
 */
export function createDandiPricingService(pool: Pool) {
  const pricing = createPricingConfigService(pool);

  async function price(input: unknown): Promise<PricedNote> {
    const data = priceNoteSchema.parse(input);
    const dandi = (await pricing.get('dandi_pricing')).payload as DandiPricingInput;
    const client = await pool.connect();
    let resolved;
    try {
      resolved = await resolveItemCategories(
        client,
        data.lines.map((line) => line.itemCode),
      );
    } finally {
      client.release();
    }
    const items = data.lines.map((line) => resolved.get(line.itemCode)!);
    const result = priceDeliveryNote(engineMasterFromDandi(dandi), {
      region: data.region,
      lines: data.lines.map((line, i) => ({
        qty: line.qty,
        type: line.type,
        pricingCategory: items[i]!.pricingCategory,
        installable: items[i]!.installable,
      })),
    });
    return {
      ...result,
      items: items.map((item) => ({
        itemCode: item.itemCode,
        groupName: item.groupName,
        installable: item.installable,
      })),
    };
  }

  return { price };
}

export type DandiPricingService = ReturnType<typeof createDandiPricingService>;
