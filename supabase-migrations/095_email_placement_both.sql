-- Migration 095: email capture placement 'both' (2026-10-21).
--
-- Merchants can ask for the email as its own step before results AND
-- keep the card under the results. A shopper who already gave their
-- email in the step sees the card as saved, never a second ask.
--
-- Only widens migration 080's CHECK; no data changes. Safe in any order
-- with the app deploy: until this runs, a Studio save of 'both' keeps
-- every other setting and says the placement needs this migration.

ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_quiz_email_placement_check,
  ADD CONSTRAINT chat_assistant_config_quiz_email_placement_check
    CHECK (quiz_email_placement IS NULL OR quiz_email_placement IN ('hook_start', 'gate_results', 'after_results', 'both', 'off'));

COMMENT ON COLUMN chat_assistant_config.quiz_email_placement IS
  'hook_start|gate_results|after_results|both|off. NULL = the template default (classic grid: the step before results). both = the step before results and the card under them.';
