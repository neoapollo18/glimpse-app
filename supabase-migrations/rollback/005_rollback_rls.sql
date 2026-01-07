-- Rollback: Disable RLS (NOT RECOMMENDED for production)
-- Only use this if you need to revert the RLS migration

-- Drop policies first
DROP POLICY IF EXISTS "Service role has full access to shops" ON public.shops;
DROP POLICY IF EXISTS "Service role has full access to products" ON public.products;
DROP POLICY IF EXISTS "Service role has full access to product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "Service role has full access to analytics_events" ON public.analytics_events;
DROP POLICY IF EXISTS "Service role has full access to Session" ON public."Session";

-- Disable RLS
ALTER TABLE public.shops DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session" DISABLE ROW LEVEL SECURITY;
