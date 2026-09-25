-- ============================================
-- MIGRATION 078: Quiz → purchase attribution
-- Date: 2026-09-24
-- Description: Two attribution questions the dashboard couldn't answer:
--   (a) Of shoppers who FINISHED the quiz (saw results), how many bought?
--       Join key: analytics_events.cart_token (quiz_results_shown) →
--       widget_orders.cart_token. Same-session attribution, mirroring
--       get_conversion_stats' widget purchase rate.
--   (b) Of shoppers who submitted an EMAIL on the quiz lead step, how many
--       bought within 60 days? Join key: quiz_leads.email →
--       widget_orders.customer_email (NEW column, captured from the
--       orders/create webhook payload). Cross-session attribution.
--
-- widget_orders.customer_email is only populated for orders created after
-- this migration deploys; lead conversion counts start accruing then.
-- ============================================

BEGIN;

ALTER TABLE widget_orders ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Lead-conversion lookups: per-shop probes by email.
CREATE INDEX IF NOT EXISTS idx_widget_orders_customer_email
  ON widget_orders (shop_id, customer_email)
  WHERE customer_email IS NOT NULL;

DROP FUNCTION IF EXISTS get_quiz_attribution(UUID, INTEGER);

CREATE OR REPLACE FUNCTION get_quiz_attribution(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  quiz_finisher_sessions      BIGINT,           -- distinct carts that saw quiz results in window
  quiz_finisher_converted     BIGINT,           -- of those, carts that placed an order
  quiz_purchase_rate          DECIMAL(5, 2),    -- converted / finishers × 100
  quiz_attributed_orders      BIGINT,           -- orders from finisher carts
  quiz_attributed_revenue     DECIMAL(12, 2),   -- revenue from those orders
  leads_total                 BIGINT,           -- email leads captured in window
  leads_converted_60d         BIGINT,           -- leads with an order ≤60 days after submit
  lead_purchase_rate          DECIMAL(5, 2),    -- converted / leads × 100
  lead_attributed_revenue     DECIMAL(12, 2)    -- revenue from those orders (deduped)
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
  WITH finisher_carts AS (
    -- Distinct carts that reached the results screen for THIS shop in window
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.cart_token IS NOT NULL
      AND ae.event_type = 'quiz_results_shown'
      AND ae.shop_id = p_shop_id
      AND ae.created_at >= v_date_threshold
  ),
  finisher_orders AS (
    SELECT wo.id, wo.cart_token, wo.total_price
    FROM widget_orders wo
    JOIN finisher_carts fc ON fc.cart_token = wo.cart_token
    WHERE wo.shop_id = p_shop_id
  ),
  window_leads AS (
    SELECT ql.id, LOWER(ql.email) AS email, ql.created_at
    FROM quiz_leads ql
    WHERE ql.shop_id = p_shop_id
      AND ql.email IS NOT NULL
      AND ql.created_at >= v_date_threshold
  ),
  -- Every (lead, order) pair where the order landed within 60 days of the
  -- lead submit. Distinct on each side below: a lead with three orders is
  -- ONE converted lead; an order matching two lead rows counts ONCE.
  lead_order_pairs AS (
    SELECT wl.id AS lead_id, wo.id AS order_id, wo.total_price
    FROM window_leads wl
    JOIN widget_orders wo
      ON wo.shop_id = p_shop_id
     AND wo.customer_email IS NOT NULL
     AND LOWER(wo.customer_email) = wl.email
     AND wo.shopify_created_at >= wl.created_at
     AND wo.shopify_created_at < wl.created_at + INTERVAL '60 days'
  ),
  quiz_stats AS (
    SELECT
      (SELECT COUNT(*) FROM finisher_carts)::BIGINT AS finishers,
      (SELECT COUNT(DISTINCT fo.cart_token) FROM finisher_orders fo)::BIGINT AS finishers_converted,
      (SELECT COUNT(*) FROM finisher_orders)::BIGINT AS orders_attributed,
      COALESCE((SELECT SUM(fo.total_price) FROM finisher_orders fo), 0)::DECIMAL(12, 2) AS revenue_attributed
  ),
  lead_stats AS (
    SELECT
      (SELECT COUNT(*) FROM window_leads)::BIGINT AS leads,
      (SELECT COUNT(DISTINCT lop.lead_id) FROM lead_order_pairs lop)::BIGINT AS leads_converted,
      COALESCE((SELECT SUM(t.total_price) FROM (
        SELECT DISTINCT lop.order_id, lop.total_price FROM lead_order_pairs lop
      ) t), 0)::DECIMAL(12, 2) AS lead_revenue
  )
  SELECT
    qs.finishers,
    qs.finishers_converted,
    CASE WHEN qs.finishers > 0
      THEN ROUND((qs.finishers_converted::DECIMAL / qs.finishers * 100), 2)
      ELSE 0
    END::DECIMAL(5, 2),
    qs.orders_attributed,
    qs.revenue_attributed,
    ls.leads,
    ls.leads_converted,
    CASE WHEN ls.leads > 0
      THEN ROUND((ls.leads_converted::DECIMAL / ls.leads * 100), 2)
      ELSE 0
    END::DECIMAL(5, 2),
    ls.lead_revenue
  FROM quiz_stats qs
  CROSS JOIN lead_stats ls;
END;
$$;

COMMENT ON COLUMN widget_orders.customer_email IS
  'Buyer email from the orders/create webhook (lowercased). Joins to quiz_leads.email for lead → purchase attribution.';
COMMENT ON FUNCTION get_quiz_attribution IS
  'Quiz attribution: % of quiz finishers (results shown) whose cart converted, attributed order count/revenue, and email-lead → purchase conversion within 60 days.';

COMMIT;
