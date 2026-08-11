-- Migration 052: multi-set try-on prompt (Locks & Mane "2 sets" case).
--
-- chat_assistant_config.quiz_multi_set_prompt — optional addendum appended to
-- the resolved transformation prompt whenever the recommendation being tried
-- on carries quantity >= 2. Product/variant prompts describe a SINGLE set;
-- without this, a "2 sets" recommendation renders the same as one set.
-- Appended (not substituted) so variant-level shade prompts keep their shade.
-- Supports a {count} placeholder replaced with the recommended quantity.
-- NULL = no change for any shop (single-set prompt used at every quantity).
--
-- ⚠ Run BEFORE deploying app code that selects this column.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_multi_set_prompt text;

COMMENT ON COLUMN chat_assistant_config.quiz_multi_set_prompt IS
  'Appended to the try-on transformation prompt when the recommendation''s quantity >= 2 (the base prompts describe one set). {count} is replaced with the quantity. NULL = quantity never alters the prompt.';
