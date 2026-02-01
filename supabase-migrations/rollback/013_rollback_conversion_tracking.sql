-- Rollback: Remove conversion tracking
-- Run this to undo 013_conversion_tracking.sql

-- Drop the function first (depends on tables)
DROP FUNCTION IF EXISTS get_conversion_stats(UUID, INTEGER);

-- Drop the widget_orders table
DROP TABLE IF EXISTS widget_orders;

-- Remove cart_token column from analytics_events
ALTER TABLE analytics_events DROP COLUMN IF EXISTS cart_token;

-- Note: Index will be dropped automatically with column
