-- ============================================
-- MIGRATION 079: attribution + GDPR hardening (post-review fixes)
-- Date: 2026-09-25
-- Description: Three fixes from the HEAD~2..HEAD code review:
--   1. Redact permanence. customers/redact nulls widget_orders.customer_email,
--      but recordOrder upserts the FULL row on webhook redelivery, which
--      could re-populate a redacted email from the payload. New column
--      email_redacted_at + a BEFORE trigger make redaction sticky at the
--      database layer — no app code path can resurrect the value.
--   2. Index use. get_quiz_attribution wrapped the join column in LOWER(),
--      which the raw-column partial index can't serve. Writes are already
--      canonically lowercased (normalizeEmail in the orders webhook), so
--      the wrapper bought nothing. Dropped.
--   3. Window consistency. finisher_orders had no date bound, so the quiz
--      metrics counted orders outside the requested window while the
--      adjacent get_conversion_stats widget metrics windowed theirs.
--      Orders are now bounded to the same window.
-- ============================================

BEGIN;

-- ---- 1. Redact permanence ----

ALTER TABLE widget_orders ADD COLUMN IF NOT EXISTS email_redacted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION widget_orders_email_redaction_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- Once redacted, always redacted: a webhook redelivery's upsert cannot
  -- restore the email or clear the stamp.
  IF OLD.email_redacted_at IS NOT NULL THEN
    NEW.customer_email := NULL;
    NEW.email_redacted_at := OLD.email_redacted_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS widget_orders_email_redaction_guard_trg ON widget_orders;
CREATE TRIGGER widget_orders_email_redaction_guard_trg
  BEFORE UPDATE ON widget_orders
  FOR EACH ROW
  EXECUTE FUNCTION widget_orders_email_redaction_guard();

COMMENT ON COLUMN widget_orders.email_redacted_at IS
  'Set by GDPR customers/redact. The BEFORE UPDATE trigger keeps customer_email NULL for stamped rows.';

-- ---- 2 + 3. get_quiz_attribution: index-friendly join, windowed orders ----

DROP FUNCTION IF EXISTS get_quiz_attribution(UUID, INTEGER);

CREATE OR REPLACE FUNCTION get_quiz_attribution(
  p_shop_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  quiz_finisher_sessions      BIGINT,
  quiz_finisher_converted     BIGINT,
  quiz_purchase_rate          DECIMAL(5, 2),
  quiz_attributed_orders      BIGINT,
  quiz_attributed_revenue     DECIMAL(12, 2),
  leads_total                 BIGINT,
  leads_converted_60d         BIGINT,
  lead_purchase_rate          DECIMAL(5, 2),
  lead_attributed_revenue     DECIMAL(12, 2)
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
    SELECT DISTINCT ae.cart_token
    FROM analytics_events ae
    WHERE ae.cart_token IS NOT NULL
      AND ae.event_type = 'quiz_results_shown'
      AND ae.shop_id = p_shop_id
      AND ae.created_at >= v_date_threshold
  ),
  -- Orders bounded to the SAME window as the events, matching
  -- get_conversion_stats' definition so the two dashboard sections agree.
  finisher_orders AS (
    SELECT wo.id, wo.cart_token, wo.total_price
    FROM widget_orders wo
    JOIN finisher_carts fc ON fc.cart_token = wo.cart_token
    WHERE wo.shop_id = p_shop_id
      AND wo.shopify_created_at >= v_date_threshold
  ),
  window_leads AS (
    -- quiz_leads.email is written lowercased (saveQuizLead); no wrapper.
    SELECT ql.id, ql.email, ql.created_at
    FROM quiz_leads ql
    WHERE ql.shop_id = p_shop_id
      AND ql.email IS NOT NULL
      AND ql.created_at >= v_date_threshold
  ),
  -- widget_orders.customer_email is written lowercased (normalizeEmail in
  -- the orders webhook); the bare column keeps the partial index usable.
  lead_order_pairs AS (
    SELECT wl.id AS lead_id, wo.id AS order_id, wo.total_price
    FROM window_leads wl
    JOIN widget_orders wo
      ON wo.shop_id = p_shop_id
     AND wo.customer_email = wl.email
     AND wo.shopify_created_at >= wl.created_at
     AND wo.shopify_created_at < wl.created_at + INTERVAL '60 days'
  ),
  -- A lead with three orders is ONE converted lead; an order matching two
  -- lead rows counts ONCE toward revenue.
  lead_orders AS (
    SELECT DISTINCT lop.order_id, lop.total_price FROM lead_order_pairs lop
  ),
  quiz_stats AS (
    SELECT
      COUNT(DISTINCT fo.cart_token)::BIGINT AS finishers_converted,
      COUNT(fo.id)::BIGINT AS orders_attributed,
      COALESCE(SUM(fo.total_price), 0)::DECIMAL(12, 2) AS revenue_attributed
    FROM finisher_orders fo
  ),
  lead_stats AS (
    SELECT
      (SELECT COUNT(DISTINCT lop.lead_id) FROM lead_order_pairs lop)::BIGINT AS leads_converted,
      (SELECT COALESCE(SUM(lo.total_price), 0) FROM lead_orders lo)::DECIMAL(12, 2) AS lead_revenue
  ),
  counts AS (
    SELECT
      (SELECT COUNT(*) FROM finisher_carts)::BIGINT AS finishers,
      (SELECT COUNT(*) FROM window_leads)::BIGINT AS leads
  )
  SELECT
    c.finishers,
    qs.finishers_converted,
    CASE WHEN c.finishers > 0
      THEN ROUND((qs.finishers_converted::DECIMAL / c.finishers * 100), 2)
      ELSE 0
    END::DECIMAL(5, 2),
    qs.orders_attributed,
    qs.revenue_attributed,
    c.leads,
    ls.leads_converted,
    CASE WHEN c.leads > 0
      THEN ROUND((ls.leads_converted::DECIMAL / c.leads * 100), 2)
      ELSE 0
    END::DECIMAL(5, 2),
    ls.lead_revenue
  FROM counts c
  CROSS JOIN quiz_stats qs
  CROSS JOIN lead_stats ls;
END;
$$;

COMMENT ON FUNCTION get_quiz_attribution IS
  'Quiz attribution v2 (079): windowed finisher orders, index-friendly email join, redact-aware via email_redacted_at trigger.';

COMMIT;
