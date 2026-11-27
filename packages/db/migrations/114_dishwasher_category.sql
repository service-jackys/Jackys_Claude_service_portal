-- Modification #324: Dishwasher becomes a fourth D+I rate category (technical team
-- meeting 27 Nov 2026, rate card effective 25 Nov 2026), priced like the washing
-- machine: D+I 60 special / 100 market, Installation only 60 / 60, minimum 35.
--
--  1. category_mappings: the ERP group DISH WASHER (Grp Name in the Item Listing) is
--     installable and prices as Freestanding Dishwasher. Built-in dishwashers sit in
--     other groups and keep following the Thomson calculator.
--  2. A saved D+I Admin Entry keeps its own copy of the rates, capacities and labour
--     minutes, so add the dishwasher entries to it (capacity and labour minutes copy
--     the washing machine). Only where they are missing, so nothing typed since is lost.
INSERT INTO category_mappings (group_name, installable, pricing_category, notes)
VALUES (
  'DISH WASHER', true, 'Freestanding Dishwasher',
  'Freestanding dishwashers only (rate card effective 25 Nov 2026). Built-in dishwashers follow the Thomson calculator.'
)
ON CONFLICT DO NOTHING;

UPDATE pricing_configs
SET payload = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            payload,
            '{capacities,dishwasher}', COALESCE(payload #> '{capacities,washer}', '10'::jsonb)),
          '{laborMinutes,dishwasher}', COALESCE(payload #> '{laborMinutes,washer}', '25'::jsonb)),
        '{modes,dandi,rates,dishwasher}', '{"batch": 60, "standard": 100}'::jsonb),
      '{modes,install,rates,dishwasher}', '{"batch": 60, "standard": 60}'::jsonb),
    updated_at = now()
WHERE domain = 'dandi_pricing'
  AND payload #> '{capacities,dishwasher}' IS NULL
  AND payload #> '{modes,dandi,rates}' IS NOT NULL
  AND payload #> '{modes,install,rates}' IS NOT NULL;
