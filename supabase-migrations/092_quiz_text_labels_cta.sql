-- Migration 092: editable shopper text, body typography, results CTA and
-- per-product "why this fits" lines (2026-10-16 merchant requests).
--
--   quiz_ui_text          jsonb map of key -> text: merchant overrides for
--     every fixed string the quiz shows (Studio -> Text & labels). Keys
--     are listed in app/lib/quiz-ui-text.ts; NULL = shipped English.
--   quiz_body_weight      body text weight: '400' | '500' | '600'.
--     NULL = inherit the theme (today's rendering).
--   quiz_body_color       body/secondary text color (#rrggbb). NULL =
--     derived from the text color, as today.
--   quiz_results_primary_cta  'add' | 'view': the button on each result
--     card. NULL = add to cart (today).
--   quiz_results_secondary_link  the small link under the button (the
--     other action). NULL/true = shown (today); false = hidden.
--   quiz_product_why      jsonb map of products.id (uuid) -> one line
--     shown under that product on result cards. NULL/missing = nothing.
--
-- Every column is NULL for every shop until set, so nothing changes on
-- any storefront by running this. Run BEFORE deploying the app code:
-- Studio saves write these columns. Safe to re-run.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_ui_text jsonb,
  ADD COLUMN IF NOT EXISTS quiz_body_weight text,
  ADD COLUMN IF NOT EXISTS quiz_body_color text,
  ADD COLUMN IF NOT EXISTS quiz_results_primary_cta text,
  ADD COLUMN IF NOT EXISTS quiz_results_secondary_link boolean,
  ADD COLUMN IF NOT EXISTS quiz_product_why jsonb;

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_body_weight_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_body_weight_check
  CHECK (quiz_body_weight IS NULL OR quiz_body_weight IN ('400', '500', '600'));

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_body_color_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_body_color_check
  CHECK (quiz_body_color IS NULL OR quiz_body_color ~ '^#[0-9a-fA-F]{6}$');

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_results_primary_cta_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_results_primary_cta_check
  CHECK (quiz_results_primary_cta IS NULL OR quiz_results_primary_cta IN ('add', 'view'));

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_ui_text_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_ui_text_check
  CHECK (quiz_ui_text IS NULL OR jsonb_typeof(quiz_ui_text) = 'object');

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_product_why_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_quiz_product_why_check
  CHECK (quiz_product_why IS NULL OR jsonb_typeof(quiz_product_why) = 'object');

COMMENT ON COLUMN chat_assistant_config.quiz_ui_text IS
  'Merchant overrides for fixed quiz text, key -> string (keys in app/lib/quiz-ui-text.ts). NULL = shipped English.';
COMMENT ON COLUMN chat_assistant_config.quiz_body_weight IS
  'Quiz body text weight (400/500/600). NULL = inherit the theme.';
COMMENT ON COLUMN chat_assistant_config.quiz_body_color IS
  'Quiz body/secondary text color #rrggbb. NULL = derived from the text color.';
COMMENT ON COLUMN chat_assistant_config.quiz_results_primary_cta IS
  'Result card button: add (to cart) or view (product page). NULL = add.';
COMMENT ON COLUMN chat_assistant_config.quiz_results_secondary_link IS
  'Show the small link for the other action under the result card button. NULL/true = shown.';
COMMENT ON COLUMN chat_assistant_config.quiz_product_why IS
  'products.id -> "why this fits" line under that product on result cards. Missing = nothing shown.';
