-- Migration 054: admin toggle for the quiz photo step's manual shade picker.
--
-- The photo/upload gate shows a manual rail ("No photo handy?" / merchant
-- copy like "I know my shade") letting shoppers pick a shade instead of
-- uploading a selfie. Some merchants (L&M request, 2026-08-11) want that
-- rail OFF so the upload step pushes photo-or-skip only.
--
-- Scope: the toggle hides the manual rail on the PHOTO STEP only. The
-- results page's shade gate keeps its manual picker — it is the recovery
-- path that keeps no-photo shoppers from dead-ending in partial results.
--
-- Default TRUE = no behavior change for any existing shop.
--
-- ⚠ Run BEFORE deploying app code: the quiz-settings admin save WRITES this
-- column on every save and would fail wholesale until the column exists.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_manual_shade_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN chat_assistant_config.quiz_manual_shade_enabled IS
  'When false, the quiz photo step hides its manual shade rail ("No photo handy?") — shoppers upload a photo or skip. The results-page shade gate''s manual picker is unaffected.';
