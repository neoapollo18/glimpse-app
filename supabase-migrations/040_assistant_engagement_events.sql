-- 040_assistant_engagement_events.sql
--
-- Capture the chat assistant engagement funnel in analytics_events.
--
-- The chat assistant already fires funnel events client-side (chat_open,
-- chat_recommend_start, chat_photo_upload, chat_recommendation_shown,
-- chat_view_product, chat_add_bundle_to_bag, hero_view, hero_cta_click), but
-- they were being rejected server-side because (a) they aren't tied to a
-- product and (b) the event-type allowlist didn't include them. These events
-- are shop-level, not product-level, so product_id must be nullable.
--
-- Safe to run repeatedly: DROP NOT NULL is a no-op if already nullable, and the
-- index uses IF NOT EXISTS.

ALTER TABLE analytics_events ALTER COLUMN product_id DROP NOT NULL;

-- The assistant funnel queries count events by shop + event_type within a time
-- window. This composite index serves those counts directly.
CREATE INDEX IF NOT EXISTS idx_analytics_events_shop_event_created
  ON analytics_events (shop_id, event_type, created_at);
