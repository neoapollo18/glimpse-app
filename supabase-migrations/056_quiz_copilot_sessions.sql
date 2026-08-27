-- 056: AI quiz copilot chat sessions (quiz-first overhaul, Phase 5/7).
-- Brand-new table; zero impact on live merchants.
--
-- messages:  raw Anthropic MessageParam[] history (incl. tool_use/tool_result
--            blocks) so the copilot resumes with full context.
-- snapshots: [{id, label, draft, createdAt}] draft snapshots taken before
--            each applied tool call — powers per-change Undo. Capped at the
--            newest 20 by the application on write.
--
-- RUN BEFORE deploying the copilot code (repo convention).

CREATE TABLE IF NOT EXISTS quiz_copilot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_copilot_sessions_shop_idx
  ON quiz_copilot_sessions (shop_id, updated_at DESC);

-- Repo invariant (migration 005): every table gets RLS. The app uses the
-- service-role key (bypasses RLS); without this, the anon key could read
-- full Claude transcripts and draft snapshots for every shop.
ALTER TABLE quiz_copilot_sessions ENABLE ROW LEVEL SECURITY;
