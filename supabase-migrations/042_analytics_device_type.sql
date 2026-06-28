-- 042_analytics_device_type.sql
--
-- Capture the shopper's device (mobile vs desktop) on analytics events so the
-- chat assistant funnel can be split by device. The widget already detects this
-- client-side (isMobile() in gleame-chat.js) but never sent it server-side.
--
-- device_type is nullable: events recorded before this migration — and any
-- event where the widget couldn't classify the device — have a NULL device_type
-- and count toward funnel totals but not toward the mobile/desktop split.
--
-- Safe to run repeatedly: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- are both no-ops if already applied.

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS device_type TEXT;

-- The assistant funnel queries count events by shop + event_type within a time
-- window, optionally filtered by device_type. This composite index serves both
-- the device-filtered and unfiltered counts.
CREATE INDEX IF NOT EXISTS idx_analytics_events_shop_event_device_created
  ON analytics_events (shop_id, event_type, device_type, created_at);
