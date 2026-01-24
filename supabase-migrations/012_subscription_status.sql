-- Add subscription status tracking to shops table
-- This allows the transform API to quickly check if a shop has access

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';

-- Valid values: 'active', 'trial', 'grace_period', 'cancelled', 'grandfathered', 'none'

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Comments for documentation
COMMENT ON COLUMN shops.subscription_status IS 'Current subscription status: active, trial, grace_period, cancelled, grandfathered, none';
COMMENT ON COLUMN shops.subscription_expires_at IS 'When subscription/grace period expires. NULL if grandfathered or no subscription.';

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_shops_subscription_status ON shops (subscription_status);
