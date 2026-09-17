-- Migration 068: merchant toggle for the quiz photo step (the try-on gate).
--
-- Some merchants (glimpse-testing request, 2026-09-17) don't want a photo
-- step at all: after the questions (and the lead step, if enabled) the quiz
-- should go straight to results.
--
-- Scope: when false, the widget's routeAfterQuestions skips the gate and
-- fetches results directly; browser Back from results resolves to the last
-- question (clampStep), never to the hidden gate. The results-page shade
-- gate and the post-results try-on upsell are unaffected. The studio
-- preview still renders the Photo slide so merchants can style it before
-- turning it back on.
--
-- Default TRUE = no behavior change for any existing shop.
--
-- ⚠ Run BEFORE deploying app code: the quiz-settings save WRITES this
-- column and would fail wholesale until the column exists.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_gate_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN chat_assistant_config.quiz_gate_enabled IS
  'When false, the quiz skips the photo/try-on gate step entirely: questions (and lead step, if on) route straight to results. Results-page shade gate and try-on upsell are unaffected.';
