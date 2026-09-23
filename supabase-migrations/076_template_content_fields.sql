-- Migration 076: v2 template content fields (docs/overhaul/V2-SPEC.md).
--
-- Storage for the per-template content the v2 widget renders when a
-- template (t1..t5) is assigned. All nullable; legacy shops (template
-- NULL) never read or write them. Written by the generator (trust lines)
-- and the studio (prose, archetype, hero image, image slots).
--
-- quiz_trust_lines: up to 3 verbatim-or-computed lines for the T2
--   results-computation screen. Never model-invented (spec 5.6).
-- quiz_results_prose: T1 Salon consultation prose template
--   ({answers}/{answer}/{top_match}/{second_match} tokens).
-- quiz_archetype_title / quiz_archetype_line: T4 Pop reveal copy.
-- quiz_hero_image: T1 hero image URL (brand library pick).
-- quiz_image_slots: {slotKey: url} object from the studio Images rail.
--
-- Run BEFORE deploying app code: the widget reads these defensively
-- (missing columns resolve to null), but studio/generator saves write
-- the columns directly.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_trust_lines jsonb,
  ADD COLUMN IF NOT EXISTS quiz_results_prose text,
  ADD COLUMN IF NOT EXISTS quiz_archetype_title text,
  ADD COLUMN IF NOT EXISTS quiz_archetype_line text,
  ADD COLUMN IF NOT EXISTS quiz_hero_image text,
  ADD COLUMN IF NOT EXISTS quiz_image_slots jsonb;

COMMENT ON COLUMN chat_assistant_config.quiz_trust_lines IS
  'v2 templates: up to 3 verbatim-sourced or catalog-computed trust lines for the T2 results-computation screen. NULL for legacy shops.';
COMMENT ON COLUMN chat_assistant_config.quiz_image_slots IS
  'v2 templates: {slotKey: url} image-slot assignments from the studio Images rail. NULL for legacy shops.';
