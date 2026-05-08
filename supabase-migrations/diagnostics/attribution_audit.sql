-- ============================================
-- DIAGNOSTIC (not a migration): Attribution audit
-- Purpose: Quantify why the dashboard's widget→purchase rate looks low.
--          Distinguishes "structural attribution gap" (cart-token nulls,
--          accelerated checkout, cross-session) from a real counting bug.
-- How to run: Paste into the Supabase SQL editor. Replace the shop_id +
--             window in the params CTE at the top of each query.
-- Read-only: only SELECTs. Safe to run on prod.
-- ============================================

-- Tip: find your shop_id with:
--   SELECT id, shop_domain FROM shops WHERE shop_domain ILIKE '%your-store%';

-- ============================================
-- Q1: Order-side gap — what fraction of orders even *can* be attributed?
-- A null cart_token here means the order bypassed the cart (Shop Pay,
-- Buy It Now, Apple/Google Pay, gift cards, draft orders). These count
-- in total_orders but can never match a widget event.
-- ============================================
WITH params AS (
  SELECT 'PASTE-SHOP-UUID-HERE'::UUID AS shop_id,
         30 AS days_back
)
SELECT
  COUNT(*)                                                    AS total_orders,
  COUNT(*) FILTER (WHERE cart_token IS NOT NULL)              AS orders_with_cart_token,
  COUNT(*) FILTER (WHERE cart_token IS NULL)                  AS orders_without_cart_token,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE cart_token IS NULL) / NULLIF(COUNT(*), 0),
    1
  )                                                           AS pct_unattributable
FROM widget_orders wo, params
WHERE wo.shop_id = params.shop_id
  AND wo.shopify_created_at >= NOW() - (params.days_back || ' days')::INTERVAL;

-- ============================================
-- Q2: Widget-side gap — what fraction of analytics events have a cart_token?
-- Broken down by event_type. widget_view typically fires before /cart.js
-- resolves, so most rows are expected to be null there. transformation
-- should have a cart_token nearly always — if it doesn't, that's a bug.
-- ============================================
WITH params AS (
  SELECT 'PASTE-SHOP-UUID-HERE'::UUID AS shop_id,
         30 AS days_back
)
SELECT
  ae.event_type,
  COUNT(*)                                                       AS events,
  COUNT(*) FILTER (WHERE ae.cart_token IS NOT NULL)              AS with_cart_token,
  COUNT(*) FILTER (WHERE ae.cart_token IS NULL)                  AS without_cart_token,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ae.cart_token IS NOT NULL) / NULLIF(COUNT(*), 0),
    1
  )                                                              AS pct_with_cart_token
FROM analytics_events ae, params
WHERE ae.shop_id = params.shop_id
  AND ae.created_at >= NOW() - (params.days_back || ' days')::INTERVAL
GROUP BY ae.event_type
ORDER BY events DESC;

-- ============================================
-- Q3: Funnel summary — exactly the numbers the dashboard derives from.
-- Mirrors get_conversion_stats logic so you can see each line item.
-- ============================================
WITH params AS (
  SELECT 'PASTE-SHOP-UUID-HERE'::UUID AS shop_id,
         30 AS days_back
),
widget_carts AS (
  SELECT DISTINCT ae.cart_token
  FROM analytics_events ae, params
  WHERE ae.shop_id = params.shop_id
    AND ae.cart_token IS NOT NULL
    AND ae.event_type IN ('transformation', 'widget_view')
    AND ae.created_at >= NOW() - (params.days_back || ' days')::INTERVAL
),
orders_in_window AS (
  SELECT wo.id, wo.cart_token, wo.total_price,
         (wc.cart_token IS NOT NULL) AS had_widget_usage
  FROM widget_orders wo
  CROSS JOIN params
  LEFT JOIN widget_carts wc ON wo.cart_token = wc.cart_token AND wo.cart_token IS NOT NULL
  WHERE wo.shop_id = params.shop_id
    AND wo.shopify_created_at >= NOW() - (params.days_back || ' days')::INTERVAL
)
SELECT
  (SELECT COUNT(*) FROM widget_carts)                                          AS widget_sessions,
  (SELECT COUNT(DISTINCT cart_token) FROM orders_in_window
     WHERE had_widget_usage)                                                   AS widget_sessions_converted,
  (SELECT COUNT(*) FROM orders_in_window)                                      AS total_orders,
  (SELECT COUNT(*) FROM orders_in_window WHERE had_widget_usage)               AS orders_with_widget_usage,
  (SELECT COUNT(*) FROM orders_in_window WHERE cart_token IS NULL)             AS orders_with_null_cart_token,
  (SELECT COUNT(*) FROM orders_in_window
     WHERE cart_token IS NOT NULL AND NOT had_widget_usage)                    AS orders_with_token_but_no_match;

-- ============================================
-- Q4: Unattributed widget sessions — distinct carts that did a transformation
-- but never produced an order in the same window. Big number here = either
-- normal abandonment or cross-session loss (they bought later from a new cart).
-- ============================================
WITH params AS (
  SELECT 'PASTE-SHOP-UUID-HERE'::UUID AS shop_id,
         30 AS days_back
),
transform_carts AS (
  SELECT DISTINCT ae.cart_token
  FROM analytics_events ae, params
  WHERE ae.shop_id = params.shop_id
    AND ae.event_type = 'transformation'
    AND ae.cart_token IS NOT NULL
    AND ae.created_at >= NOW() - (params.days_back || ' days')::INTERVAL
),
converted AS (
  SELECT DISTINCT wo.cart_token
  FROM widget_orders wo, params
  WHERE wo.shop_id = params.shop_id
    AND wo.cart_token IS NOT NULL
    AND wo.shopify_created_at >= NOW() - (params.days_back || ' days')::INTERVAL
)
SELECT
  (SELECT COUNT(*) FROM transform_carts)                                       AS transform_sessions,
  (SELECT COUNT(*) FROM transform_carts tc
     INNER JOIN converted c ON tc.cart_token = c.cart_token)                   AS transform_sessions_converted,
  (SELECT COUNT(*) FROM transform_carts tc
     LEFT JOIN converted c ON tc.cart_token = c.cart_token
     WHERE c.cart_token IS NULL)                                               AS transform_sessions_unconverted;
