-- Migration: Add conversion tracking support
-- Purpose: Track which orders came from customers who used the widget
-- Date: 2026-01-25

-- ============================================
-- 1. Add cart_token to analytics_events
-- ============================================
-- Cart token links widget usage to eventual purchase
ALTER TABLE analytics_events 
ADD COLUMN IF NOT EXISTS cart_token TEXT;

-- Index for efficient cart_token lookups
CREATE INDEX IF NOT EXISTS idx_analytics_events_cart_token 
ON analytics_events(cart_token) 
WHERE cart_token IS NOT NULL;

-- ============================================
-- 2. Create widget_orders table
-- ============================================
-- Stores orders from shops using Gleame widgets
-- Used to calculate conversion attribution
CREATE TABLE IF NOT EXISTS widget_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  cart_token TEXT,
  order_number TEXT,
  total_price DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',
  customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  shopify_created_at TIMESTAMPTZ,
  
  -- Ensure no duplicate orders per shop
  UNIQUE(shop_id, shopify_order_id)
);

-- Index for cart_token joins with analytics_events
CREATE INDEX IF NOT EXISTS idx_widget_orders_cart_token 
ON widget_orders(cart_token) 
WHERE cart_token IS NOT NULL;

-- Index for shop analytics queries
CREATE INDEX IF NOT EXISTS idx_widget_orders_shop_created 
ON widget_orders(shop_id, shopify_created_at DESC);

-- ============================================
-- 3. Enable RLS on widget_orders
-- ============================================
ALTER TABLE widget_orders ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for API operations)
CREATE POLICY "Service role full access to widget_orders" ON widget_orders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 4. Create helper function for conversion stats
-- ============================================
CREATE OR REPLACE FUNCTION get_conversion_stats(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_orders BIGINT,
  orders_with_widget_usage BIGINT,
  conversion_rate DECIMAL(5, 2),
  total_revenue DECIMAL(12, 2),
  widget_attributed_revenue DECIMAL(12, 2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_threshold TIMESTAMPTZ;
BEGIN
  v_date_threshold := NOW() - (p_days_back || ' days')::INTERVAL;
  
  RETURN QUERY
  WITH widget_carts AS (
    -- Pre-compute distinct cart tokens that had widget usage
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.cart_token IS NOT NULL
    AND ae.event_type IN ('transformation', 'widget_view')
  ),
  order_stats AS (
    SELECT 
      wo.id,
      wo.total_price,
      (wc.cart_token IS NOT NULL) AS had_widget_usage
    FROM widget_orders wo
    LEFT JOIN widget_carts wc ON wo.cart_token = wc.cart_token AND wo.cart_token IS NOT NULL
    WHERE wo.shop_id = p_shop_id
    AND wo.shopify_created_at >= v_date_threshold
  )
  SELECT 
    COUNT(*)::BIGINT AS total_orders,
    COUNT(*) FILTER (WHERE had_widget_usage)::BIGINT AS orders_with_widget_usage,
    CASE 
      WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE had_widget_usage)::DECIMAL / COUNT(*) * 100), 2)
      ELSE 0
    END AS conversion_rate,
    COALESCE(SUM(total_price), 0)::DECIMAL(12, 2) AS total_revenue,
    COALESCE(SUM(total_price) FILTER (WHERE had_widget_usage), 0)::DECIMAL(12, 2) AS widget_attributed_revenue
  FROM order_stats;
END;
$$;

-- ============================================
-- Comments for documentation
-- ============================================
COMMENT ON COLUMN analytics_events.cart_token IS 'Shopify cart token to link widget usage to orders';
COMMENT ON TABLE widget_orders IS 'Orders from shops using Gleame, for conversion attribution';
COMMENT ON FUNCTION get_conversion_stats IS 'Calculate widget conversion rate and revenue attribution';
