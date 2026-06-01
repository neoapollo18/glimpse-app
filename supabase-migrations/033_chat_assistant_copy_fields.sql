-- Migration 033: configurable chat header status + loading state copy
--
-- The widget was shipping hardcoded English nail-polish-flavored strings
-- for the header subtitle ("Your AI shade advisor") and the loading-hero
-- caption + 3-step checklist ("Reading skin tone" / "Confirming undertone"
-- / "Visualizing your shades"). That's wrong for any non-nail-polish shop
-- and for any merchant in a non-English locale. Move them to config.
--
-- Also drops the redundant index introduced in 032 if it slipped onto a
-- dev DB before the cleanup landed — safe no-op when missing. The
-- recommendation_questions.position column is similarly redundant (one
-- question per axis, axis position drives flow order) but harmless if
-- left in place, so we leave it alone.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS header_idle_status text NOT NULL DEFAULT 'Your AI assistant',
  ADD COLUMN IF NOT EXISTS header_working_status text NOT NULL DEFAULT 'Working on it…',
  ADD COLUMN IF NOT EXISTS header_done_status text NOT NULL DEFAULT 'Your {count} perfect picks',
  ADD COLUMN IF NOT EXISTS loading_caption text NOT NULL DEFAULT 'Working on your recommendations…',
  ADD COLUMN IF NOT EXISTS loading_steps jsonb NOT NULL DEFAULT
    '["Analyzing your photo","Personalizing results","Visualizing your picks"]'::jsonb;

COMMENT ON COLUMN chat_assistant_config.header_idle_status IS 'Subtitle line under assistant name when no request is in flight. e.g. "Your AI shade advisor".';
COMMENT ON COLUMN chat_assistant_config.header_working_status IS 'Subtitle while /chat-recommend is running. Default "Working on it…".';
COMMENT ON COLUMN chat_assistant_config.header_done_status IS 'Subtitle once recommendations arrive. Token {count} is replaced with the number of recommendations at render time.';
COMMENT ON COLUMN chat_assistant_config.loading_caption IS 'Caption shown above the loading hero halo while generating recommendations.';
COMMENT ON COLUMN chat_assistant_config.loading_steps IS 'Array of 3 short strings shown as the cosmetic progress checklist below the loading hero. Tick off on a fixed 2.5s timer per step.';

-- Drop the redundant index from 032 if it was applied before the cleanup.
DROP INDEX IF EXISTS idx_recommendation_rules_shop_criteria;
