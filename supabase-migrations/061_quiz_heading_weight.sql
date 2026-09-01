-- 061: Heading font-weight override for the quiz theme.
--
-- The storefront already renders headings with var(--gq-heading-weight)
-- (detected from the theme, default 600); this column lets merchants pick
-- the weight explicitly from the studio Theme editor, next to the heading
-- font. NULL = inherit theme / default (zero behavior change on deploy).
-- Values are CSS font-weight keywords limited to a safe set.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_heading_weight_override TEXT;

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_heading_weight_check;

ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_heading_weight_check
  CHECK (
    quiz_heading_weight_override IS NULL
    OR quiz_heading_weight_override IN ('300', '400', '500', '600', '700', '800')
  );
