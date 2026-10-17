-- Migration 093: security hardening (2026-10-16).
--
-- Supabase serves every public table and function over its REST API to
-- anyone holding the project's anon key. The app never uses that key: all
-- reads, writes and RPC calls go through the server's service-role key,
-- which bypasses RLS and is granted EXECUTE below. So nothing changes for
-- the app; this closes the anon path the rest of the schema already closes.
--
-- 1. Row level security on quiz_leads (shopper emails and phones),
--    brand_profiles and brand_library, the three tables created without
--    it. Same service-role policy as 005/027/029, nothing for anon or
--    authenticated.
-- 2. EXECUTE on every SECURITY DEFINER function in these migrations limited
--    to service_role, as 039 did for save_recommendation_config. Definer
--    functions bypass RLS: the analytics ones return any shop's revenue for
--    a shop id, and add_alternate_domain writes to shops.
--
-- Dropping and recreating a function resets its grants (026, 078, 079 and
-- 091 do that), so re-run this after re-running any of them, and repeat
-- the REVOKE/GRANT in any future migration that recreates one of these.
--
-- Run any time, before or after deploying: no app code depends on it.
-- Idempotent and safe to re-run while the app serves traffic; anything
-- missing is skipped.

BEGIN;

-- Fail fast instead of queueing live queries behind a table lock. If it
-- times out, nothing was applied: run it again.
SET LOCAL lock_timeout = '5s';

-- ==========================================================================
-- 1. Row level security
-- ==========================================================================
ALTER TABLE IF EXISTS public.quiz_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.brand_library ENABLE ROW LEVEL SECURITY;

-- Policy only when missing, so a re-run leaves existing policies alone.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quiz_leads', 'brand_profiles', 'brand_library'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'Service role has full access to ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'Service role has full access to ' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 2. SECURITY DEFINER functions: service_role only
-- ==========================================================================
-- Signatures are from each function's latest definition. anon and
-- authenticated are named because Supabase grants them EXECUTE directly,
-- so revoking from PUBLIC alone would leave them in.
DO $$
BEGIN
  -- 006. Never called by the app.
  IF to_regprocedure('public.add_alternate_domain(uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.add_alternate_domain(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.add_alternate_domain(uuid, text) TO service_role;
  END IF;

  -- 006. Trigger function: its triggers keep firing, since EXECUTE is
  -- checked when a trigger is created, not each time it fires (and the
  -- app's writes run as service_role, which keeps it).
  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
  END IF;

  -- 026
  IF to_regprocedure('public.get_conversion_stats(uuid, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_conversion_stats(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_conversion_stats(uuid, integer) TO service_role;
  END IF;

  -- 028
  IF to_regprocedure('public.get_top_traffic_sources(uuid, integer, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_top_traffic_sources(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_top_traffic_sources(uuid, integer, integer) TO service_role;
  END IF;

  -- 055. Already locked down since 039; re-asserted so this list is complete.
  IF to_regprocedure('public.save_recommendation_config(uuid, jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.save_recommendation_config(uuid, jsonb) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.save_recommendation_config(uuid, jsonb) TO service_role;
  END IF;

  -- 079
  IF to_regprocedure('public.get_quiz_attribution(uuid, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_quiz_attribution(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_quiz_attribution(uuid, integer) TO service_role;
  END IF;

  -- 091
  IF to_regprocedure('public.get_quiz_order_stats(uuid, timestamptz, timestamptz)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_quiz_order_stats(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_quiz_order_stats(uuid, timestamptz, timestamptz) TO service_role;
  END IF;

  -- 091
  IF to_regprocedure('public.get_quiz_product_orders(uuid, timestamptz, timestamptz)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_quiz_product_orders(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_quiz_product_orders(uuid, timestamptz, timestamptz) TO service_role;
  END IF;
END $$;

COMMIT;

-- Verify afterwards. The first should show true three times. The second
-- lists any definer function anon can still run and should come back
-- empty; a row there was created outside these migrations (in the
-- dashboard) and needs the same REVOKE/GRANT.
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace
--     AND relname IN ('quiz_leads', 'brand_profiles', 'brand_library');
--
--   SELECT p.oid::regprocedure FROM pg_proc p
--   WHERE p.pronamespace = 'public'::regnamespace
--     AND p.prosecdef
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
