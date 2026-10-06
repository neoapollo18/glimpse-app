-- Migration 082: per-answer rule sentences + store-wide always/never
-- (Recommendation Logic Spec v2, the new Check matches tab).
--
-- Every quiz answer gets ONE plain-English sentence describing what picking
-- it does to recommendations ("Lean toward warm reds and corals."). The
-- sentence is the source of truth; `resolved` is a cache of what it maps to
-- in the catalog (applies-to line, "only" narrowing).
--
-- ADDITIVE ONLY. Nothing here touches recommendation_rules, ai_guidance,
-- priority_product_ids or quiz_question_guidance. Existing logic keeps
-- running exactly as before:
--   - `active = false` rows are display-only. Sentences drafted for a quiz
--     that already had its own logic (rules, guidance, or a live surface)
--     are written inactive: they describe the quiz, they don't drive it.
--   - A sentence starts steering results only once it is active: drafted
--     for a brand-new quiz, or edited by the merchant (directly or via
--     Chat). No active rows + no global rules = the runtime is byte-for-byte
--     the pre-082 pipeline.
--
-- Keyed by (shop_id, axis_key, axis_value) TEXT with no FK, like
-- quiz_question_guidance (059): rows survive save_recommendation_config's
-- wipe-and-rewrite of the flow tables, and axis keys/values are stable
-- across edits (question-axis.server.ts).
--
-- quiz_global_rules is a quiz_* column on purpose: it rides version
-- snapshots/restores like every other quiz setting.
--
-- Run BEFORE deploying app code. Idempotent: safe to re-run. Zero impact on
-- live shops until rows exist.

CREATE TABLE IF NOT EXISTS quiz_answer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  axis_key TEXT NOT NULL,
  axis_value TEXT NOT NULL,
  sentence TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'none' CHECK (mode IN ('lean', 'only', 'none')),
  -- { product_ids: uuid[], labels: string[] (<=3), count: int } | null
  resolved JSONB,
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('resolved', 'unresolved', 'empty')),
  source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'edited', 'chat')),
  active BOOLEAN NOT NULL DEFAULT false,
  -- Hash of (sentence, catalog version) the cached `resolved` belongs to.
  resolved_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, axis_key, axis_value),
  CHECK (char_length(sentence) <= 400)
);

CREATE INDEX IF NOT EXISTS quiz_answer_rules_shop_active_idx
  ON quiz_answer_rules (shop_id) WHERE active;

ALTER TABLE quiz_answer_rules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE quiz_answer_rules IS
  'Spec v2: one plain-English rule sentence per quiz answer. active=false rows are display-only; only active rows reach the storefront runtime.';

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_global_rules JSONB;

COMMENT ON COLUMN chat_assistant_config.quiz_global_rules IS
  'Spec v2 store-wide rules: {"always": [{"id","label"}] (<=3 products, shown first), "never": [{"id","label","kind":"product"|"type"|"tag"|"vendor"}]}. NULL = none.';
