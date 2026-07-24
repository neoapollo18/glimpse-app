-- Migration 049: quiz design tokens — merchant-tunable style optionality.
--
-- Until now the quiz's look was fixed in gleame-quiz.css apart from accent
-- color, button radius, and the two font overrides. These columns open the
-- rest of the design surface WITHOUT touching the shipped design: every
-- column is nullable and NULL means "the stylesheet default", so existing
-- shops render pixel-identically until a merchant sets a value.
--
--   quiz_ink_color        main text color (--gq-ink; soft/faint text derives from it)
--   quiz_card_bg_color    card/modal surfaces (--gq-card-bg, default #ffffff)
--   quiz_line_color       borders + dividers (--gq-line, default #eae7e4)
--   quiz_cta_color        dark commerce buttons (--gq-dark, default #16161a)
--   quiz_card_radius      card corner radius in px (--gq-radius-card, default 18)
--   quiz_progress_style   'pips' (default nail pips) | 'bar' | 'counter' | 'none'
--   quiz_intro_layout     'split' (default two-column) | 'centered'
--   quiz_animation_style  'full' (default) | 'minimal' (fades only) | 'off'
--
-- ⚠ Run BEFORE deploying the app code. Reads are safe pre-migration
-- (select('*') + null-coalesced defaults), but the quiz admin save WRITES
-- these columns unconditionally — against an unmigrated DB every save on
-- /app/assistant/quiz fails, including pure copy edits.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_ink_color text,
  ADD COLUMN IF NOT EXISTS quiz_card_bg_color text,
  ADD COLUMN IF NOT EXISTS quiz_line_color text,
  ADD COLUMN IF NOT EXISTS quiz_cta_color text,
  ADD COLUMN IF NOT EXISTS quiz_card_radius integer,
  ADD COLUMN IF NOT EXISTS quiz_progress_style text,
  ADD COLUMN IF NOT EXISTS quiz_intro_layout text,
  ADD COLUMN IF NOT EXISTS quiz_animation_style text;

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_card_radius_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_card_radius_check
  CHECK (quiz_card_radius IS NULL OR quiz_card_radius BETWEEN 0 AND 60);

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_progress_style_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_progress_style_check
  CHECK (quiz_progress_style IS NULL OR quiz_progress_style IN ('pips', 'bar', 'counter', 'none'));

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_intro_layout_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_intro_layout_check
  CHECK (quiz_intro_layout IS NULL OR quiz_intro_layout IN ('split', 'centered'));

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_animation_style_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_animation_style_check
  CHECK (quiz_animation_style IS NULL OR quiz_animation_style IN ('full', 'minimal', 'off'));

COMMENT ON COLUMN chat_assistant_config.quiz_ink_color IS
  'Optional quiz main text color (--gq-ink). NULL = stylesheet default #16161a; soft/faint text derives from it client-side.';
COMMENT ON COLUMN chat_assistant_config.quiz_card_bg_color IS
  'Optional quiz card/modal surface color (--gq-card-bg). NULL = #ffffff.';
COMMENT ON COLUMN chat_assistant_config.quiz_line_color IS
  'Optional quiz border/divider color (--gq-line). NULL = #eae7e4.';
COMMENT ON COLUMN chat_assistant_config.quiz_cta_color IS
  'Optional quiz commerce-button color (--gq-dark: Add to Bag, Continue). NULL = #16161a.';
COMMENT ON COLUMN chat_assistant_config.quiz_card_radius IS
  'Optional quiz card corner radius in px (--gq-radius-card). NULL = 18.';
COMMENT ON COLUMN chat_assistant_config.quiz_progress_style IS
  'Quiz progress indicator: pips (nail pips) | bar | counter | none. NULL = pips (the shipped design).';
COMMENT ON COLUMN chat_assistant_config.quiz_intro_layout IS
  'Quiz landing layout: split (two-column copy/visual) | centered. NULL = split (the shipped design).';
COMMENT ON COLUMN chat_assistant_config.quiz_animation_style IS
  'Quiz animation intensity: full | minimal (fades only) | off. NULL = full (the shipped design).';
