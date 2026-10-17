-- Rollback for migration 093. NOT RECOMMENDED: it reopens these tables and
-- functions to the anon key. Only for the case where the app lost database
-- access after 093, which means its key is not the service-role key.
BEGIN;

DROP POLICY IF EXISTS "Service role has full access to quiz_leads" ON public.quiz_leads;
DROP POLICY IF EXISTS "Service role has full access to brand_profiles" ON public.brand_profiles;
DROP POLICY IF EXISTS "Service role has full access to brand_library" ON public.brand_library;

ALTER TABLE IF EXISTS public.quiz_leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.brand_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.brand_library DISABLE ROW LEVEL SECURITY;

-- Back to the default grants these had before 093. save_recommendation_config
-- is left out: it has been service-role only since 039.
GRANT EXECUTE ON FUNCTION public.add_alternate_domain(uuid, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversion_stats(uuid, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_traffic_sources(uuid, integer, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_attribution(uuid, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_order_stats(uuid, timestamptz, timestamptz) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_product_orders(uuid, timestamptz, timestamptz) TO PUBLIC, anon, authenticated;

COMMIT;
