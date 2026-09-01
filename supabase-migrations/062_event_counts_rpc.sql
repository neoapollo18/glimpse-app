-- 062: Grouped event counts for the analytics page.
--
-- getQuizEngagement + getAssistantEngagement issued one exact head-count
-- query per (event type x device x range) — up to ~100 round trips per
-- page view. One GROUP BY returns the same numbers in a single query per
-- range. The app falls back to per-event counts if this function is
-- missing, so deploy order doesn't matter.

CREATE OR REPLACE FUNCTION get_event_counts(p_shop_id UUID, p_since TIMESTAMPTZ)
RETURNS TABLE(event_type TEXT, device_type TEXT, cnt BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT ae.event_type, ae.device_type, count(*)::bigint AS cnt
  FROM analytics_events ae
  WHERE ae.shop_id = p_shop_id
    AND ae.created_at >= p_since
  GROUP BY ae.event_type, ae.device_type;
$$;
