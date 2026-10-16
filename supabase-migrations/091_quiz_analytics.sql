-- Migration 091: quiz analytics revamp (2026-10-15).
--
-- 1. widget_order_lines: line items of orders whose cart reached quiz
--    results, written by the orders/create webhook. Only quiz-touched
--    orders are stored, so large stores stay small here. Powers "ordered"
--    per product on the analytics Products tab.
-- 2. get_quiz_order_stats(shop, from, to): store orders and revenue, quiz
--    finisher orders and revenue, and leads who bought (same cart, or same
--    email within 60 days) for any window, so the dashboard can compare a
--    range with the one before it.
-- 3. get_quiz_product_orders(shop, from, to): orders, units and revenue per
--    product from widget_order_lines.
--
-- Run BEFORE deploying the app code. The dashboard hides the parts these
-- power when they are missing, but the webhook writes the new table.
-- Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS widget_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id text NOT NULL,
  line_item_id text NOT NULL,
  cart_token text,
  product_id text,
  variant_id text,
  title text,
  quantity integer NOT NULL DEFAULT 1,
  price numeric(12, 2),
  ordered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_widget_order_lines_shop_ordered
  ON widget_order_lines (shop_id, ordered_at);

ALTER TABLE widget_order_lines ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE widget_order_lines IS
  'Line items of orders whose cart reached quiz results. Written by the orders webhook for quiz analytics.';

DROP FUNCTION IF EXISTS get_quiz_order_stats(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION get_quiz_order_stats(
  p_shop_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  store_orders bigint,
  store_revenue numeric,
  finisher_carts bigint,
  quiz_orders bigint,
  quiz_buyer_carts bigint,
  quiz_revenue numeric,
  leads_total bigint,
  leads_bought bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH fin AS (
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.shop_id = p_shop_id
      AND ae.event_type = 'quiz_results_shown'
      AND ae.cart_token IS NOT NULL
      AND ae.created_at >= p_from
      AND ae.created_at < p_to
  ),
  store AS (
    SELECT COUNT(*)::bigint AS n, COALESCE(SUM(wo.total_price), 0)::numeric AS rev
    FROM widget_orders wo
    WHERE wo.shop_id = p_shop_id
      AND wo.shopify_created_at >= p_from
      AND wo.shopify_created_at < p_to
  ),
  quiz AS (
    SELECT COUNT(wo.id)::bigint AS n,
           COUNT(DISTINCT wo.cart_token)::bigint AS carts,
           COALESCE(SUM(wo.total_price), 0)::numeric AS rev
    FROM widget_orders wo
    JOIN fin ON fin.cart_token = wo.cart_token
    WHERE wo.shop_id = p_shop_id
      AND wo.shopify_created_at >= p_from
      AND wo.shopify_created_at < p_to
  ),
  lds AS (
    SELECT ql.id, ql.email, ql.cart_token, ql.created_at
    FROM quiz_leads ql
    WHERE ql.shop_id = p_shop_id
      AND ql.created_at >= p_from
      AND ql.created_at < p_to
  ),
  buyers AS (
    SELECT DISTINCT l.id
    FROM lds l
    JOIN widget_orders wo
      ON wo.shop_id = p_shop_id
     AND wo.shopify_created_at >= l.created_at
     AND wo.shopify_created_at < l.created_at + INTERVAL '60 days'
     AND (
       (l.cart_token IS NOT NULL AND wo.cart_token = l.cart_token)
       OR (l.email IS NOT NULL AND wo.customer_email = l.email)
     )
  )
  SELECT
    store.n,
    store.rev,
    (SELECT COUNT(*) FROM fin)::bigint,
    quiz.n,
    quiz.carts,
    quiz.rev,
    (SELECT COUNT(*) FROM lds)::bigint,
    (SELECT COUNT(*) FROM buyers)::bigint
  FROM store, quiz;
END;
$$;

DROP FUNCTION IF EXISTS get_quiz_product_orders(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION get_quiz_product_orders(
  p_shop_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  product_id text,
  orders bigint,
  units bigint,
  revenue numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wol.product_id,
    COUNT(DISTINCT wol.shopify_order_id)::bigint,
    COALESCE(SUM(wol.quantity), 0)::bigint,
    COALESCE(SUM(wol.price * wol.quantity), 0)::numeric
  FROM widget_order_lines wol
  WHERE wol.shop_id = p_shop_id
    AND wol.product_id IS NOT NULL
    AND wol.ordered_at >= p_from
    AND wol.ordered_at < p_to
  GROUP BY wol.product_id
  ORDER BY 2 DESC, 3 DESC
  LIMIT 100;
END;
$$;
