-- Migration 071: configurable bundle size for the results "add all" button
-- (migration 070). 0 = every match (070's behavior). N>0 = the shopper
-- picks N of the matches (top N pre-selected); the button adds exactly
-- those N. Built for Glamnetic's "Select 3 and buy at a 20% discount".
--
-- ⚠ Run BEFORE deploying app code: getChatAssistantConfig selects the
-- column via the row spread, and the studio Results save writes it.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_bundle_size integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN chat_assistant_config.quiz_bundle_size IS
  'Results bundle button size: 0 adds every match; N>0 lets the shopper pick exactly N matches (top N pre-selected).';

DO $$
DECLARE updated integer;
BEGIN
  UPDATE chat_assistant_config
    SET quiz_bundle_size = 3
    WHERE shop_domain = 'glamrco.myshopify.com';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 glamrco.myshopify.com config row, updated %', updated;
  END IF;
END $$;
