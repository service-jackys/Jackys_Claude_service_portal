import type { Pool } from 'pg';
import type { DandiPricingInput, RateCardInput } from '../../../../packages/contracts/src/index.js';
import { createPricingConfigService } from '../pricing-config/service.js';

// The read-only Rate Card page (modification.md #54). It is just a price list
// for sales and the service desk, so it is open to every signed-in staff role
// (rate_card.view) instead of being tied to pricing_config.read, and it only
// returns what a price list should show: activity rates, the D+I / Installation
// base rates, quantity discounts and transport per trip. Internal cost inputs
// from D+I Admin Entry (technician cost per hour, minutes per appliance, load
// capacity per trip) are never returned.
export function createRateCardViewService(pool: Pool) {
  const pricing = createPricingConfigService(pool);

  async function view() {
    const [rateCard, dandi] = await Promise.all([
      pricing.get('rate_card'),
      pricing.get('dandi_pricing'),
    ]);
    const sections = rateCard.payload as RateCardInput;
    const config = dandi.payload as DandiPricingInput;
    const stamps = [rateCard.updatedAt, dandi.updatedAt].filter((value): value is string =>
      Boolean(value),
    );
    return {
      sections: sections.map((section) => ({
        key: section.key,
        label: section.label,
        activities: section.activities.map((activity) => ({
          name: activity.name,
          rate: activity.rate,
        })),
      })),
      dandi: {
        maxUnits: config.maxUnits,
        minUnitRate: config.minUnitRate,
        regions: config.regions.map((region) => ({
          name: region.name,
          roundTripCost: region.roundTripCost,
        })),
        groupings: config.groupings,
        crewFactors: config.crewFactors,
        modes: Object.fromEntries(
          Object.entries(config.modes).map(([key, mode]) => [
            key,
            {
              label: mode.label,
              transportAlways: mode.transportAlways,
              rates: mode.rates,
              discounts: mode.discounts.map((tier) => ({
                min: tier.min,
                max: tier.max,
                label: tier.label,
                rate: tier.rate,
              })),
            },
          ]),
        ),
      },
      customised: rateCard.isOverride || dandi.isOverride,
      updatedAt: stamps.length ? stamps.sort().at(-1) : null,
    };
  }

  return { view };
}

export type RateCardViewService = ReturnType<typeof createRateCardViewService>;
