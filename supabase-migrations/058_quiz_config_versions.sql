-- 058: Quiz config draft/publish + version history (quiz-first overhaul, Phase 2).
-- Brand-new table; zero impact on live merchants. The storefront read path
-- never touches this table — publishing writes through the existing
-- save_recommendation_config RPC + chat_assistant_config upsert.
--
-- config jsonb shape: { "flow": <SaveRecommendationConfigInput>,
--                       "settings": <Partial<ChatAssistantConfig>> }
--
-- RUN BEFORE deploying the quiz-draft code (repo convention).

CREATE TABLE IF NOT EXISTS quiz_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  config JSONB NOT NULL,
  label TEXT,
  created_by TEXT NOT NULL DEFAULT 'manual' CHECK (created_by IN ('ai', 'manual', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Exactly one draft per shop (upsert target for saveQuizDraft)
CREATE UNIQUE INDEX IF NOT EXISTS quiz_config_versions_one_draft
  ON quiz_config_versions (shop_id) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS quiz_config_versions_shop_idx
  ON quiz_config_versions (shop_id, created_at DESC);

-- Repo invariant (migration 005): every table gets RLS. The app uses the
-- service-role key (bypasses RLS); without this, the anon key could read
-- every shop's full quiz config history.
ALTER TABLE quiz_config_versions ENABLE ROW LEVEL SECURITY;
