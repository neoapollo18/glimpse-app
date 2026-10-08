-- Migration 085: merchant page-background color for the quiz.
--
-- The Studio Style panel had no way to set the quiz's background: "Card
-- background" only colors answer cards, so a merchant asking for a white
-- quiz on a template with a tinted ground (Counter, Editorial, Ritual,
-- Pop) could not get one. NULL = the template's own background.
--
-- Run BEFORE deploying app code: Studio saves write the full settings row,
-- so a missing column fails every Style-panel save. Safe to re-run.

ALTER TABLE chat_assistant_config ADD COLUMN IF NOT EXISTS quiz_bg_color TEXT;

COMMENT ON COLUMN chat_assistant_config.quiz_bg_color IS
  'Quiz page background (#rrggbb). NULL = the template''s own background.';
