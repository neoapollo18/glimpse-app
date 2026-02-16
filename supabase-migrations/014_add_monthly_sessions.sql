-- Add monthly_sessions tracking to shops table
-- This allows the admin page to display session counts without calling Shopify API
-- Session counts are updated by the cron job

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS monthly_sessions INTEGER DEFAULT NULL;

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS sessions_updated_at TIMESTAMPTZ DEFAULT NULL;

-- Comments for documentation
COMMENT ON COLUMN shops.monthly_sessions IS 'Average monthly sessions from Shopify analytics (90 day average). Updated by cron job.';
COMMENT ON COLUMN shops.sessions_updated_at IS 'When the monthly_sessions was last updated by the cron job.';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_shops_monthly_sessions ON shops(monthly_sessions) WHERE monthly_sessions IS NOT NULL;
