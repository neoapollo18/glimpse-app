-- Migration 043: full-page quiz experience ("Find My Fit")
--
-- The chat assistant is gaining a second storefront surface: a full-page,
-- step-based quiz rendered by a theme app extension section block. Merchants
-- choose the surface per shop via assistant_mode; the quiz reuses the same
-- recommendation matrix, candidate pool, and photo-axis classification as
-- the chat, plus a fast criteria-only recommendation path.
--
-- Two groups of changes:
--   1. chat_assistant_config — assistant_mode + quiz page copy/style fields.
--      Copy defaults live in code (getChatAssistantConfig), matching the
--      convention for the chat copy fields; only structural defaults are
--      set here.
--   2. Recommendation flow tables — per-question helper text, per-option
--      reason bullets, per-axis-value swatch colors (manual shade picker),
--      and per-rule quantity ("2 sets").

-- ==========================================================================
-- chat_assistant_config: surface mode
-- ==========================================================================
-- 'chat'  — floating bubble only (default; existing merchants unchanged)
-- 'quiz'  — quiz page only (bubble self-disables)
-- 'both'  — bubble and quiz page active simultaneously
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS assistant_mode text NOT NULL DEFAULT 'chat';

DO $$ BEGIN
  ALTER TABLE chat_assistant_config
    ADD CONSTRAINT chat_assistant_config_assistant_mode_check
    CHECK (assistant_mode IN ('chat', 'quiz', 'both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN chat_assistant_config.assistant_mode IS
  'Which storefront surface(s) the assistant uses: chat (floating bubble), quiz (full-page quiz), or both.';

-- ==========================================================================
-- chat_assistant_config: quiz landing copy
-- ==========================================================================
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_eyebrow text,
  ADD COLUMN IF NOT EXISTS quiz_headline text,
  ADD COLUMN IF NOT EXISTS quiz_subtext text,
  ADD COLUMN IF NOT EXISTS quiz_trust_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz_before_image_url text,
  ADD COLUMN IF NOT EXISTS quiz_after_image_url text,
  ADD COLUMN IF NOT EXISTS quiz_visual_caption text,
  ADD COLUMN IF NOT EXISTS quiz_alt_audience_label text,
  ADD COLUMN IF NOT EXISTS quiz_alt_audience_url text;

-- ==========================================================================
-- chat_assistant_config: try-on gate + privacy
-- ==========================================================================
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_gate_headline text,
  ADD COLUMN IF NOT EXISTS quiz_gate_helper text,
  ADD COLUMN IF NOT EXISTS quiz_gate_photo_label text,
  ADD COLUMN IF NOT EXISTS quiz_gate_skip_label text,
  ADD COLUMN IF NOT EXISTS quiz_privacy_note text;

-- ==========================================================================
-- chat_assistant_config: results + shade gate copy
-- ==========================================================================
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_results_headline_photo text,
  ADD COLUMN IF NOT EXISTS quiz_results_headline_nophoto text,
  ADD COLUMN IF NOT EXISTS quiz_best_match_pill text,
  ADD COLUMN IF NOT EXISTS quiz_also_matched_label text,
  ADD COLUMN IF NOT EXISTS quiz_add_button_template text,
  ADD COLUMN IF NOT EXISTS quiz_view_product_label text,
  ADD COLUMN IF NOT EXISTS quiz_retake_label text,
  ADD COLUMN IF NOT EXISTS quiz_shade_headline text,
  ADD COLUMN IF NOT EXISTS quiz_shade_body text,
  ADD COLUMN IF NOT EXISTS quiz_shade_cta_photo text,
  ADD COLUMN IF NOT EXISTS quiz_shade_cta_manual text;

-- ==========================================================================
-- chat_assistant_config: quiz style
-- ==========================================================================
-- NULLs mean "inherit": quiz_accent_color falls back to accent_color, the
-- font overrides fall back to runtime theme-font detection in the widget.
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_accent_color text,
  ADD COLUMN IF NOT EXISTS quiz_button_radius integer,
  ADD COLUMN IF NOT EXISTS quiz_heading_font_override text,
  ADD COLUMN IF NOT EXISTS quiz_body_font_override text;

COMMENT ON COLUMN chat_assistant_config.quiz_heading_font_override IS
  'CSS font-family for quiz headings. NULL = inherit from the host theme at runtime.';
COMMENT ON COLUMN chat_assistant_config.quiz_body_font_override IS
  'CSS font-family for quiz body text. NULL = inherit from the host theme at runtime.';

-- ==========================================================================
-- Recommendation flow: quiz-facing copy fields
-- ==========================================================================
-- Sub-line rendered under the question heading on the quiz page
-- ("This helps us pick the right length for you."). Chat ignores it.
ALTER TABLE recommendation_questions
  ADD COLUMN IF NOT EXISTS helper_text text;

COMMENT ON COLUMN recommendation_questions.helper_text IS
  'Optional helper sub-line under the question heading on the quiz page. Chat flow ignores it.';

-- Reason bullet shown on quiz result cards when this option was picked
-- ("Adds length past your shoulders"). Falls back to "{question}: {option}".
ALTER TABLE recommendation_question_options
  ADD COLUMN IF NOT EXISTS reason_text text;

COMMENT ON COLUMN recommendation_question_options.reason_text IS
  'Optional reason bullet for quiz result cards when this option was selected.';

-- Swatch color for the manual shade picker on the quiz''s shade gate
-- ("I know my shade" dot row). Hex like #8b5a2b. Values without a swatch
-- render as text chips.
ALTER TABLE recommendation_axis_values
  ADD COLUMN IF NOT EXISTS swatch_color text;

COMMENT ON COLUMN recommendation_axis_values.swatch_color IS
  'Optional hex color for the quiz shade-picker dot representing this value.';

-- Per-rule quantity: how many units of the target the rule recommends
-- ("2 sets for your thicker hair"). The quiz multiplies unit price by this
-- for the add-to-bag CTA and passes it to /cart/add.js.
ALTER TABLE recommendation_rules
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE recommendation_rules
    ADD CONSTRAINT recommendation_rules_quantity_check CHECK (quantity > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN recommendation_rules.quantity IS
  'Units of the target product/variant this rule recommends (e.g. 2 sets). Quiz add-to-bag uses it; chat ignores it.';
