-- Migration 050: LLM-powered recommendation engine (opt-in per shop).
--
-- Replaces the "random shuffle" fallback with a real ranking pipeline:
-- deterministic filters (stock, color distance) -> Gemini Flash listwise
-- ranking with per-pick reasons -> merchant priority boost. The hand-authored
-- rule matrix stays fully supported; the new mode column decides who ranks.
--
-- 1. chat_assistant_config.recommendation_mode — which engine orders picks:
--    'matrix' (default, exactly today's behavior), 'ai' (LLM ranks the whole
--    pool; matrix rules are ignored), 'hybrid' (matrix rules win when they
--    match; the LLM replaces the random shuffle everywhere the matrix
--    doesn't apply).
-- 2. chat_assistant_config.priority_product_ids — products the merchant
--    wants surfaced first when equally suitable. Soft boost (bounded rank
--    lift + LLM hint), never a hard pin: an unsuitable priority product is
--    still allowed to lose.
-- 3. chat_assistant_config.ai_guidance — merchant-written positioning notes
--    fed verbatim to the ranking prompt ("our hero product is X", "push
--    bundles for first-time buyers", ...).
-- 4. chat_assistant_config.color_filter_enabled — opt-in deterministic
--    CIELAB Delta E pre-filter: when the shopper's answered shade has a
--    swatch color and a variant has display_color, variants perceptually
--    far from the pick are dropped BEFORE the LLM ranks (fail-open when
--    color data is missing or the filter would empty the pool).
--
-- ⚠ Run BEFORE deploying app code that selects these columns.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS recommendation_mode text NOT NULL DEFAULT 'matrix'
    CHECK (recommendation_mode IN ('matrix', 'ai', 'hybrid')),
  ADD COLUMN IF NOT EXISTS priority_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color_filter_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chat_assistant_config.recommendation_mode IS
  'Ranking engine: matrix = merchant rule matrix only (legacy default), ai = LLM listwise ranking over the candidate pool, hybrid = matrix rules first with LLM replacing the random fallback.';
COMMENT ON COLUMN chat_assistant_config.priority_product_ids IS
  'JSON array of internal product UUIDs the merchant prioritizes. Applied in ai/hybrid modes; style (bounded boost vs pin-to-front) is set by recommendation_tuning.priorityStyle (migration 051).';
COMMENT ON COLUMN chat_assistant_config.ai_guidance IS
  'Merchant-written positioning notes included verbatim in the LLM ranking prompt. Empty = no extra guidance.';
COMMENT ON COLUMN chat_assistant_config.color_filter_enabled IS
  'When true, candidates whose variant display_color is perceptually far (CIEDE2000) from the shopper''s answered shade swatch are dropped before LLM ranking. Fail-open on missing color data.';
