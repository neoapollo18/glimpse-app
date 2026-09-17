-- Migration 069: merchant toggle for quiz try-on GENERATION, separate from
-- the photo step itself.
--
-- Locks & Mane (2026-09-17): shade detection stays, but the generated
-- try-on photos misrepresent hair color next to the detected shade label,
-- so the merchant wants no VTO on the quiz at all. Migration 068's
-- quiz_gate_enabled is the wrong lever for them — turning the photo step
-- off would also kill shade detection.
--
-- Scope: when false, the widget never generates try-on images (no hero
-- auto-transform, no "See on me" buttons, no post-results try-on upsell)
-- and /api/storefront/quiz-tryon rejects the shop server-side. The photo
-- step, shade detection, shade gate, and manual picker are all unaffected.
--
-- Default TRUE = no behavior change for any existing shop.
--
-- ⚠ Run BEFORE deploying app code: getChatAssistantConfig selects the
-- column via the row spread, and the studio Photo-step save writes it.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_tryon_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN chat_assistant_config.quiz_tryon_enabled IS
  'When false, the quiz never generates try-on images (hero auto-transform, "See on me" buttons, post-results upsell) and quiz-tryon rejects server-side. Photo step, shade detection, and manual shade picking are unaffected.';

-- Locks & Mane: shade detection only, no VTO (the request that motivated
-- this column). Raises if the config row is missing so a silent 0-row
-- UPDATE can't read as success.
DO $$
DECLARE updated integer;
BEGIN
  UPDATE chat_assistant_config
    SET quiz_tryon_enabled = false
    WHERE shop_domain = 'locks-mane.myshopify.com';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 locks-mane.myshopify.com config row, updated %', updated;
  END IF;
END $$;
