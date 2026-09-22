-- Migration 074: per-card merchant note under every quiz match card.
--
-- Locks & Mane (2026-09-22): the merchant wants a "we're always learning,
-- email us for a second opinion" line under EVERY product recommendation,
-- not just on the no-match verdict. Generic field: any shop can set it;
-- NULL/empty = no note, no behavior change for existing shops.
--
-- The widget linkifies email addresses in the text into mailto links.
--
-- ⚠ Run BEFORE deploying app code: getChatAssistantConfig maps the column
-- and the studio Results editor writes it.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_match_footnote text;

COMMENT ON COLUMN chat_assistant_config.quiz_match_footnote IS
  'Small note rendered under every quiz results match card (e.g. "email us for a second opinion"). Email addresses become mailto links client-side. NULL/empty = hidden.';

-- Locks & Mane: the shop this was built for. Raises if the config row is
-- missing so a silent 0-row UPDATE can't read as success.
DO $$
DECLARE updated integer;
BEGIN
  UPDATE chat_assistant_config
    SET quiz_match_footnote = 'Our shade matching tool is always learning and getting better. If your match doesn''t look quite right - or you''d like a second opinion - send us a photo of your hair in natural light to info@locksandmane.com and we''ll be happy to help you find your perfect shade!'
    WHERE shop_domain = 'locks-mane.myshopify.com';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 locks-mane.myshopify.com config row, updated %', updated;
  END IF;
END $$;
