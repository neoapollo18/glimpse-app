-- ============================================
-- MIGRATION: Fix get_top_traffic_sources widget_carts CTE
-- Date: 2026-05-06
-- Description: The widget_carts CTE in get_top_traffic_sources (introduced in
--              025_widget_orders_attribution.sql) was missing two filters that
--              the analogous CTE in get_conversion_stats already has after
--              026_widget_purchase_rate.sql:
--                1. shop_id scoping — same cross-shop cart_token bug 026 fixed
--                   for get_conversion_stats. Cart tokens are effectively
--                   unique per storefront so real corruption is unlikely, but
--                   the function was reading cross-shop rows.
--                2. Date threshold — widget events from outside the requested
--                   p_days_back window could join in-window orders, inflating
--                   traffic-source counts vs. what get_conversion_stats
--                   reports for the same window.
--              Function signature unchanged.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION get_top_traffic_sources(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  source           TEXT,
  orders           BIGINT,
  revenue          DECIMAL(12, 2)
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
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.cart_token IS NOT NULL
      AND ae.event_type IN ('transformation', 'widget_view')
      AND ae.shop_id = p_shop_id
      AND ae.created_at >= v_date_threshold
  )
  SELECT
    COALESCE(NULLIF(wo.first_touch_source, ''), 'direct')::TEXT AS source,
    COUNT(*)::BIGINT AS orders,
    COALESCE(SUM(wo.total_price), 0)::DECIMAL(12, 2) AS revenue
  FROM widget_orders wo
  INNER JOIN widget_carts wc ON wo.cart_token = wc.cart_token AND wo.cart_token IS NOT NULL
  WHERE wo.shop_id = p_shop_id
    AND wo.shopify_created_at >= v_date_threshold
  GROUP BY COALESCE(NULLIF(wo.first_touch_source, ''), 'direct')
  ORDER BY orders DESC
  LIMIT p_limit;
END;
$$;

COMMIT;
