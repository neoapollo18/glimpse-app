-- Migration 088: Boutique quiz style, grid results layout, nail-swatch
-- option style. Built for the Glamnetic "Find My Match UI v2" design;
-- every setting is opt-in and NULL for every shop until set.
--
--   quiz_ui_style = 'boutique'    classic quiz only: white cards with an
--     accent tint + check when selected, left-aligned steps with a bottom
--     Continue bar (sticky on phones), three-across tiles on desktop.
--     Implies the compact phone layout.
--   quiz_results_layout = 'grid'  classic quiz only: equal product cards
--     with per-card Add to bag and "See on me", a one-line answers summary,
--     a mix-and-match bundle bar (only when a bundle discount is live),
--     the email capture as a card under the results, and a sticky bag bar.
--   option_style 'nails'          nail-shaped color swatches (swatch +
--     swatch2 gradient, texture for glitter/rainbow/french).
--
-- Run BEFORE deploying app code: Studio saves write these columns through
-- the settings save. Safe to re-run.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_ui_style text,
  ADD COLUMN IF NOT EXISTS quiz_results_layout text;

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_ui_style_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_ui_style_check
  CHECK (quiz_ui_style IS NULL OR quiz_ui_style IN ('boutique'));

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_results_layout_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_results_layout_check
  CHECK (quiz_results_layout IS NULL OR quiz_results_layout IN ('grid'));

COMMENT ON COLUMN chat_assistant_config.quiz_ui_style IS
  'Classic quiz visual style. NULL = standard; boutique = white cards, tinted selected state with check, bottom Continue bar.';
COMMENT ON COLUMN chat_assistant_config.quiz_results_layout IS
  'Classic quiz results layout. NULL = featured match; grid = equal product cards, mix-and-match bundle bar, email card under results.';

ALTER TABLE recommendation_questions
  DROP CONSTRAINT IF EXISTS recommendation_questions_option_style_check;
ALTER TABLE recommendation_questions
  ADD CONSTRAINT recommendation_questions_option_style_check
  CHECK (option_style IS NULL OR option_style IN ('chips', 'boxed', 'list', 'visual', 'rich', 'vibe', 'nails'));
