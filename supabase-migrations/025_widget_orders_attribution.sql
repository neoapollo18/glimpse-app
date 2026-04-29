-- ============================================
-- MIGRATION: Widget orders attribution enrichment
-- Date: 2026-04-29
-- Description: Adds customerJourneySummary fields to widget_orders so we can
--              attribute orders to traffic sources, repeat-purchase status,
--              and time-to-conversion. Sourced from Shopify Admin GraphQL
--              `Order.customerJourneySummary` (Level 1 Protected Customer
--              Data Access — already approved).
-- ============================================

ALTER TABLE widget_orders
  -- First-touch attribution (originating visit before any purchase chain)
  ADD COLUMN IF NOT EXISTS first_touch_source         TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_source_type    TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_landing_page   TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_utm            JSONB,
  ADD COLUMN IF NOT EXISTS first_touch_at             TIMESTAMPTZ,
  -- Last-touch attribution (visit immediately preceding the purchase)
  ADD COLUMN IF NOT EXISTS last_touch_source          TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_source_type     TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_landing_page    TEXT,
  ADD COLUMN IF NOT EXISTS last_touch_utm             JSONB,
  ADD COLUMN IF NOT EXISTS last_touch_at              TIMESTAMPTZ,
  -- Customer-level signals
  ADD COLUMN IF NOT EXISTS customer_order_index       INT,
  ADD COLUMN IF NOT EXISTS days_to_conversion         INT,
  -- Derived: customer_order_index >= 2 means this isn't the customer's first
  -- order. NULL when index is unknown (e.g. journey enrichment failed).
  ADD COLUMN IF NOT EXISTS is_repeat_customer         BOOLEAN
    GENERATED ALWAYS AS (customer_order_index >= 2) STORED;

-- Speed up "top sources" queries from the analytics dashboard
CREATE INDEX IF NOT EXISTS idx_widget_orders_first_touch_source
  ON widget_orders(shop_id, first_touch_source)
  WHERE first_touch_source IS NOT NULL;

COMMENT ON COLUMN widget_orders.first_touch_source       IS 'Originating traffic source (e.g. "google", "instagram", "direct") from Shopify Order.customerJourneySummary.firstVisit';
COMMENT ON COLUMN widget_orders.last_touch_source        IS 'Last-touch traffic source — the visit that closed the conversion';
COMMENT ON COLUMN widget_orders.first_touch_utm          IS 'UTM parameters of the first visit ({source, medium, campaign})';
COMMENT ON COLUMN widget_orders.customer_order_index     IS '1 = customer''s first order, ≥2 = repeat purchase';
COMMENT ON COLUMN widget_orders.days_to_conversion       IS 'Days from first visit to this order (Shopify-computed)';
COMMENT ON COLUMN widget_orders.is_repeat_customer       IS 'Convenience flag: customer_order_index >= 2';

-- ============================================
-- Extended stats function: includes traffic source + repeat-purchase
-- ============================================
-- Drops + recreates because we're adding return columns. Existing callers
-- of get_conversion_stats() continue to work — same column subset still exists
-- and is appended to. Wrapped in a transaction so callers never observe a
-- moment when the function doesn't exist.

BEGIN;

DROP FUNCTION IF EXISTS get_conversion_stats(UUID, INTEGER);

CREATE OR REPLACE FUNCTION get_conversion_stats(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_orders                BIGINT,
  orders_with_widget_usage    BIGINT,
  conversion_rate             DECIMAL(5, 2),
  total_revenue               DECIMAL(12, 2),
  widget_attributed_revenue   DECIMAL(12, 2),
  repeat_orders               BIGINT,
  repeat_orders_with_widget   BIGINT,
  avg_days_to_conversion      DECIMAL(6, 2)
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
  ),
  order_stats AS (
    SELECT
      wo.id,
      wo.total_price,
      wo.is_repeat_customer,
      wo.days_to_conversion,
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
    COALESCE(SUM(total_price) FILTER (WHERE had_widget_usage), 0)::DECIMAL(12, 2) AS widget_attributed_revenue,
    COUNT(*) FILTER (WHERE is_repeat_customer)::BIGINT AS repeat_orders,
    COUNT(*) FILTER (WHERE is_repeat_customer AND had_widget_usage)::BIGINT AS repeat_orders_with_widget,
    COALESCE(ROUND(AVG(days_to_conversion) FILTER (WHERE had_widget_usage), 2), 0)::DECIMAL(6, 2) AS avg_days_to_conversion
  FROM order_stats;
END;
$$;

COMMENT ON FUNCTION get_conversion_stats IS 'Conversion attribution stats including widget-driven rate, revenue, repeat purchases, and average time-to-conversion.';

COMMIT;

-- ============================================
-- Top traffic sources for widget-attributed orders
-- ============================================
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

COMMENT ON FUNCTION get_top_traffic_sources IS 'Top first-touch traffic sources for widget-attributed orders, ordered by order count.';
