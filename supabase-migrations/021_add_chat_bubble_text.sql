-- Migration 021: add bubble_text column to chat_assistant_config
--
-- The storefront chat bubble was changed from a circle with a logo to a
-- horizontal pill with a call-to-action label ("Try on a shade" by default).
-- Merchants need to be able to customize the pill text so it matches their
-- catalog (e.g. "Try this fragrance", "Preview on my skin", etc.).

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS bubble_text text NOT NULL DEFAULT 'Try on a shade';

COMMENT ON COLUMN chat_assistant_config.bubble_text IS 'Call-to-action label shown inside the closed chat pill on the storefront';
