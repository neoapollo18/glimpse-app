-- Migration 070: "add all to bag" bundle button on the quiz results page.
--
-- Glamnetic demo (2026-09-17): one button under the match grid that adds
-- every recommended product to the cart in a single /cart/add.js items
-- call, then hands off to the existing per-theme cart sync. Merchant
-- toggle + label template ({count}/{set_word}/{total} replaced
-- client-side, same vocabulary as quiz_add_button_template).
--
-- Default FALSE = no behavior change for any existing shop.
--
-- ⚠ Run BEFORE deploying app code: getChatAssistantConfig selects the
-- columns via the row spread, and the studio Results save writes them.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_bundle_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_bundle_label text;

COMMENT ON COLUMN chat_assistant_config.quiz_bundle_enabled IS
  'When true and results have 2+ matches, the quiz results page shows one "add all to bag" button that adds every match in a single cart call.';
COMMENT ON COLUMN chat_assistant_config.quiz_bundle_label IS
  'Label template for the results bundle button; {count}/{set_word}/{total} replaced client-side. NULL uses the app default.';

-- Glamnetic: the shop this button was built for. Raises if the config row
-- is missing so a silent 0-row UPDATE can't read as success.
DO $$
DECLARE updated integer;
BEGIN
  UPDATE chat_assistant_config
    SET quiz_bundle_enabled = true,
        quiz_bundle_label = 'Select {count} and buy at a 20% discount'
    WHERE shop_domain = 'glamrco.myshopify.com';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 glamrco.myshopify.com config row, updated %', updated;
  END IF;
END $$;
