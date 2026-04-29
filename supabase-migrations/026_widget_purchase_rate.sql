-- ============================================
-- MIGRATION: Widget → Purchase rate (Option A)
-- Date: 2026-04-29
-- Description: Extends get_conversion_stats with two new columns —
--              widget_sessions (distinct carts that had widget activity in
--              the window) and widget_sessions_converted (those that
--              resulted in an order). The dashboard divides them to get
--              "% of widget users who bought." The existing conversion_rate
--              column ("% of buyers who used widget") is now labeled as
--              "order coverage" in the UI.
--              Also drops avg_days_to_conversion from the return shape;
--              not currently surfaced in the dashboard.
--              Also fixes a pre-existing bug where widget_carts CTE didn't
--              scope by shop_id, allowing cross-shop cart_token collisions.
-- ============================================

BEGIN;

DROP FUNCTION IF EXISTS get_conversion_stats(UUID, INTEGER);

CREATE OR REPLACE FUNCTION get_conversion_stats(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_orders                BIGINT,
  orders_with_widget_usage    BIGINT,
  conversion_rate             DECIMAL(5, 2),    -- % of buyers who used widget (order coverage)
  total_revenue               DECIMAL(12, 2),
  widget_attributed_revenue   DECIMAL(12, 2),
  repeat_orders               BIGINT,
  repeat_orders_with_widget   BIGINT,
  widget_sessions             BIGINT,           -- distinct carts with widget activity in window
  widget_sessions_converted   BIGINT,           -- of those, how many placed an order
  widget_purchase_rate        DECIMAL(5, 2)     -- widget_sessions_converted / widget_sessions × 100
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
    -- Distinct cart_tokens that had widget activity for THIS shop in window
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.cart_token IS NOT NULL
      AND ae.event_type IN ('transformation', 'widget_view')
      AND ae.shop_id = p_shop_id
      AND ae.created_at >= v_date_threshold
  ),
  order_stats AS (
    SELECT
      wo.id,
      wo.cart_token,
      wo.total_price,
      wo.is_repeat_customer,
      (wc.cart_token IS NOT NULL) AS had_widget_usage
    FROM widget_orders wo
    LEFT JOIN widget_carts wc ON wo.cart_token = wc.cart_token AND wo.cart_token IS NOT NULL
    WHERE wo.shop_id = p_shop_id
      AND wo.shopify_created_at >= v_date_threshold
  ),
  -- Aggregate order_stats into a guaranteed single row (zeros when empty)
  order_aggregates AS (
    SELECT
      COUNT(*)::BIGINT AS total_orders,
      COUNT(*) FILTER (WHERE had_widget_usage)::BIGINT AS orders_with_widget_usage,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE had_widget_usage)::DECIMAL / COUNT(*) * 100), 2)
        ELSE 0
      END AS conversion_rate,
      COALESCE(SUM(total_price), 0)::DECIMAL(12, 2) AS total_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE had_widget_usage), 0)::DECIMAL(12, 2) AS widget_attributed_revenue,
      COUNT(*) FILTER (WHERE is_repeat_customer)::BIGINT AS repeat_orders,
      COUNT(*) FILTER (WHERE is_repeat_customer AND had_widget_usage)::BIGINT AS repeat_orders_with_widget
    FROM order_stats
  ),
  session_stats AS (
    SELECT
      (SELECT COUNT(*) FROM widget_carts)::BIGINT AS widget_sessions,
      (SELECT COUNT(DISTINCT cart_token) FROM order_stats WHERE had_widget_usage)::BIGINT AS widget_sessions_converted
  )
  SELECT
    oa.total_orders,
    oa.orders_with_widget_usage,
    oa.conversion_rate,
    oa.total_revenue,
    oa.widget_attributed_revenue,
    oa.repeat_orders,
    oa.repeat_orders_with_widget,
    ss.widget_sessions,
    ss.widget_sessions_converted,
    CASE
      WHEN ss.widget_sessions > 0
      THEN ROUND((ss.widget_sessions_converted::DECIMAL / ss.widget_sessions * 100), 2)
      ELSE 0
    END::DECIMAL(5, 2) AS widget_purchase_rate
  FROM order_aggregates oa
  CROSS JOIN session_stats ss;
END;
$$;

COMMENT ON FUNCTION get_conversion_stats IS 'Conversion attribution stats: order coverage (% of buyers who used widget), widget purchase rate (% of widget sessions that converted), revenue split, and repeat-purchase counts.';

COMMIT;
