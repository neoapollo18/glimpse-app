-- 063: Shopify-native billing state (Mantle replacement).
--
-- One Billing API subscription per paying shop: $0 recurring line +
-- usage line capped at the top tier ($399). A monthly cron posts one
-- usage record = the shop's session-tier fee. These columns track the
-- subscription and make the usage posting idempotent per billing cycle.
-- All additive; NULL = shop has no app-created subscription yet.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS shopify_subscription_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS usage_line_item_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS current_tier TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
-- Idempotency for usage posting: "<subscriptionId>:<currentPeriodEnd>".
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_usage_cycle_key TEXT;
