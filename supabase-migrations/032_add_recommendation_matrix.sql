-- Migration 032: structured recommendation logic (matrix) for the chat assistant
--
-- Replaces the old single-axis "preference question" flow (one freeform
-- prompt, one answer, LLM picks variants) with a configurable N-axis
-- criteria system:
--
--   axes:    e.g. "depth" (sourced from photo) and "undertone" (sourced
--            from a user question)
--   values:  enumerated possible values per axis (e.g. fair/medium/deep)
--   questions + options: how the chat collects user_question axes
--                        (prompt + per-option bot response personality)
--   rules:   deterministic lookup table mapping (criteria → variants)
--
-- Strict matching only: each criteria combination maps to exactly one
-- ordered variant set. When the matrix is sparse and no rule matches, the
-- chat-recommend endpoint falls back to its existing AI-pick behavior.
--
-- Per-variant tagline is added in this migration too — needed for the
-- "A warm red with subtle shimmer — your undertones will make this glow"
-- italic descriptions on the product cards.

-- ==========================================================================
-- recommendation_axes
-- ==========================================================================
CREATE TABLE IF NOT EXISTS recommendation_axes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  source text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, key),
  CHECK (source IN ('photo', 'user_question')),
  CHECK (key ~ '^[a-z_][a-z0-9_]*$')  -- machine-readable; lower snake_case
);

CREATE INDEX IF NOT EXISTS idx_recommendation_axes_shop ON recommendation_axes(shop_id, position);

COMMENT ON TABLE recommendation_axes IS 'Per-shop criteria axes for the recommendation matrix. e.g. depth, undertone.';
COMMENT ON COLUMN recommendation_axes.source IS 'photo: value extracted from selfie analysis. user_question: collected via chat question.';
COMMENT ON COLUMN recommendation_axes.key IS 'Machine-readable axis identifier used in rule criteria JSONB. Must be lower snake_case.';

-- ==========================================================================
-- recommendation_axis_values
-- ==========================================================================
CREATE TABLE IF NOT EXISTS recommendation_axis_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id uuid NOT NULL REFERENCES recommendation_axes(id) ON DELETE CASCADE,
  value text NOT NULL,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (axis_id, value),
  CHECK (value ~ '^[a-z_][a-z0-9_]*$')
);

CREATE INDEX IF NOT EXISTS idx_recommendation_axis_values_axis ON recommendation_axis_values(axis_id, position);

COMMENT ON TABLE recommendation_axis_values IS 'Enumerated possible values for an axis. e.g. fair/medium/deep for depth.';

-- ==========================================================================
-- recommendation_questions
-- ==========================================================================
-- One question per user_question axis. The question prompt + per-option
-- mapping to axis values + per-option bot response copy.
CREATE TABLE IF NOT EXISTS recommendation_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id uuid NOT NULL UNIQUE REFERENCES recommendation_axes(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_questions_position ON recommendation_questions(position);

COMMENT ON TABLE recommendation_questions IS 'Chat-side question for a user_question axis. UNIQUE(axis_id) — one question per axis.';

-- ==========================================================================
-- recommendation_question_options
-- ==========================================================================
CREATE TABLE IF NOT EXISTS recommendation_question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES recommendation_questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  axis_value_id uuid NOT NULL REFERENCES recommendation_axis_values(id) ON DELETE CASCADE,
  bot_response text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_question_options_question
  ON recommendation_question_options(question_id, position);

COMMENT ON TABLE recommendation_question_options IS 'Button options shown for a question. Each maps to one axis value + an optional bot-response personality line.';

-- ==========================================================================
-- recommendation_rules
-- ==========================================================================
-- One row per (criteria combination × variant assignment). rank=1 is the
-- top match. criteria is a JSONB object like {"depth":"fair","undertone":"warm"};
-- a SELECT WHERE criteria = $1 is a single index hit.
CREATE TABLE IF NOT EXISTS recommendation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  criteria jsonb NOT NULL,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, criteria, rank),
  CHECK (rank > 0)
);

-- The UNIQUE constraint above creates a btree index on (shop_id, criteria,
-- rank) which the planner uses for "shop_id = X AND criteria = Y::jsonb
-- ORDER BY rank" lookups. No separate index needed — adding one on
-- (shop_id, (criteria::text)) wouldn't be used (the expressions differ)
-- and a GIN on criteria is overkill for strict equality matching.

COMMENT ON TABLE recommendation_rules IS 'Matrix cells: (shop, criteria combination) → ordered variant list. Strict equality match only.';
COMMENT ON COLUMN recommendation_rules.criteria IS 'JSONB of {axis_key: axis_value}, e.g. {"depth":"fair","undertone":"warm"}. Must match an axis value combination defined for this shop.';

-- ==========================================================================
-- product_variants.tagline
-- ==========================================================================
-- Optional per-shade copy line for the product card ("A warm red with subtle
-- shimmer — your undertones will make this glow"). Nullable: card omits the
-- italic line when empty.
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS tagline text;

COMMENT ON COLUMN product_variants.tagline IS 'Short italic copy line shown beneath the variant title on the chat product card. Optional.';

-- ==========================================================================
-- RLS (matches the pattern used elsewhere)
-- ==========================================================================
ALTER TABLE recommendation_axes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_axis_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_rules ENABLE ROW LEVEL SECURITY;

-- Service-role has full access (the Remix app uses the service key); we
-- don't expose these tables to the anon role.
CREATE POLICY "service role full access" ON recommendation_axes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full access" ON recommendation_axis_values
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full access" ON recommendation_questions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full access" ON recommendation_question_options
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full access" ON recommendation_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
