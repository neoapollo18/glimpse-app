-- Migration 094: quiz try-on is switched on by the Gleame team only
-- (2026-10-20).
--
-- Merchants could turn try-on on from the Studio ("Generate try-on
-- photos"), but most stores never set up products for try-on, so the
-- "Try them on me" button did nothing (Shopify App Review flagged it).
-- From now on only /admin writes quiz_tryon_enabled: the Studio shows it
-- read-only, and saveLiveQuizConfig / Build with AI skip the key.
--
-- This migration only changes the default for NEW stores. Existing rows
-- are untouched here; scripts/tryon-admin-backfill.mts (dry run first)
-- turns try-on off only for stores with no product set up for try-on,
-- which already show shoppers no try-on (quiz-config checks readiness
-- since 753f505). Stores with try-on working keep it.
--
-- Safe in any order with the app deploy: the app never relies on the
-- column default (CHAT_ASSISTANT_DEFAULTS is false too).

ALTER TABLE chat_assistant_config
  ALTER COLUMN quiz_tryon_enabled SET DEFAULT false;

COMMENT ON COLUMN chat_assistant_config.quiz_tryon_enabled IS
  'Gleame-admin only (set in /admin since 2026-10-20). When false, the quiz never generates try-on images (hero auto-transform, "See on me" buttons, post-results upsell) and quiz-tryon rejects server-side. Shoppers also see try-on only when a product is set up for it. Photo step, shade detection, and manual shade picking are unaffected.';
