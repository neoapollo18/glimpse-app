-- Migration 038: consultation opening message + separate hero background/text colors
--
-- 1. opening_message — the bot message sent immediately after the shopper
--    clicks the hero's "Start consultation" CTA, shown right before the
--    first recommendation-flow question. Empty/NULL = jump straight to the
--    question (previous behavior).
--
-- 2. The hero's top panel color was derived only from hero_accent_color
--    (a tint gradient), so merchants couldn't pick an exact background.
--    This splits the controls:
--
--    hero_background_color → exact background for the hero top panel.
--                            NULL = soft tint of the accent (existing behavior).
--    hero_text_color       → headline color on that panel, so merchants can
--                            keep the text readable on a custom background.
--                            NULL = default dark gray (#111827).

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS opening_message text,
  ADD COLUMN IF NOT EXISTS hero_background_color text,
  ADD COLUMN IF NOT EXISTS hero_text_color text;

COMMENT ON COLUMN chat_assistant_config.opening_message IS 'Bot message sent right after the hero CTA opens the chat, before the first question. NULL/empty skips it.';
COMMENT ON COLUMN chat_assistant_config.hero_background_color IS 'Optional hex background for the hero top panel. NULL falls back to a tint of the hero/global accent.';
COMMENT ON COLUMN chat_assistant_config.hero_text_color IS 'Optional hex color for the hero headline. NULL falls back to the default dark gray.';
