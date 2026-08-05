-- Migration 051: recommendation tuning knobs (extends migration 050).
--
-- One jsonb column instead of a column per knob: the tuning surface is
-- expected to keep growing (thresholds, boost strengths, model choices) and
-- every knob has a code-side default, so absent keys mean "shipped
-- behavior" and future knobs never need another migration. The mapper in
-- supabase.server.ts (mapRecommendationTuning) is the single source of
-- truth for shape + defaults; malformed values degrade to defaults.
--
-- Keys as of this migration:
--   colorFilter        'off' | 'loose' | 'normal' | 'strict'
--                      (ΔE00 gate 45 / 30 / 18; replaces migration 050's
--                      boolean color_filter_enabled — backfilled below,
--                      then the column is dead and unread by app code)
--   mismatchGuard      boolean, default true — always-on egregious-mismatch
--                      filter (ΔE00 > 60 vs the shopper's picked swatch) on
--                      AI-ordered picks, independent of colorFilter
--   priorityStyle      'boost' | 'pin', default 'boost'
--   priorityBoostSlots integer 1-10, default 3
--   rankerModel        'lite' | 'flash' | 'pro', default 'flash'
--   productDiversity   boolean, default true
--   llmReasons         boolean, default true
--   maxLlmCandidates   integer 50-400, default 200
--
-- ⚠ Run BEFORE deploying app code that selects this column.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS recommendation_tuning jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN chat_assistant_config.recommendation_tuning IS
  'Tuning knobs for the LLM recommendation engine (migration 051). Absent keys fall back to code-side defaults in mapRecommendationTuning.';

-- One-time fold of migration 050's boolean into the tuning blob, in case
-- 050 was applied and any shop enabled the toggle before this ran. App
-- code no longer reads or writes color_filter_enabled after 051.
UPDATE chat_assistant_config
SET recommendation_tuning = jsonb_set(recommendation_tuning, '{colorFilter}', '"normal"')
WHERE color_filter_enabled = true
  AND NOT recommendation_tuning ? 'colorFilter';
