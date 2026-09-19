-- Migration 073: Overhaul instrumentation (spec Part 6).
--
-- analytics_events.properties: jsonb payload for the overhaul funnel
-- events (template scores, publish path, stage durations…). Existing
-- events never wrote properties — NULL means "legacy event", no backfill.
--
-- shops.install_id: the shared id every Part 6 event carries, minted once
-- per shop row. Distinct from shop_id so re-installs (shop row reused)
-- can be distinguished later if we ever reset it on uninstall.
--
-- ⚠ Run BEFORE deploying app code.

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS properties jsonb;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS install_id uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN analytics_events.properties IS
  'Overhaul funnel event payload (Part 6): template scores, publish path, stage durations. NULL for legacy events.';
COMMENT ON COLUMN shops.install_id IS
  'Shared id on every overhaul funnel event for the install -> publish funnel.';
