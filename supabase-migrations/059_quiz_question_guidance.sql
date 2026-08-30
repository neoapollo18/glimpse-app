-- 059: Per-question merchant guidance for the self-serve recommendation
-- logic flow. One row per (shop, quiz question axis key) holding the
-- merchant's free-text notes on how answers to that question should steer
-- recommendations; the reserved key '__general' holds store-wide guidance.
--
-- Deliberately keyed by axis_key TEXT (not axis_id): the
-- save_recommendation_config RPC wipes and rewrites recommendation_axes on
-- every save, so an FK would cascade-delete merchant notes. Axis keys are
-- stable per question (derived once at creation), so notes survive question
-- renames and full config saves from any editor. Orphaned rows (question
-- deleted) are surfaced in the admin UI and only removed on explicit action.
--
-- Brand-new table; zero impact on live merchants (no rows = no behavior
-- change). The storefront read path never touches this table — generated
-- guidance is written to chat_assistant_config.ai_guidance as before.
--
-- RUN BEFORE deploying the recommendation-logic page code (repo convention).

CREATE TABLE IF NOT EXISTS quiz_question_guidance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  axis_key TEXT NOT NULL,
  merchant_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, axis_key)
);

-- Repo invariant (migration 005): every table gets RLS. The app uses the
-- service-role key (bypasses RLS); without this, the anon key could read
-- every shop's merchandising notes.
ALTER TABLE quiz_question_guidance ENABLE ROW LEVEL SECURITY;
