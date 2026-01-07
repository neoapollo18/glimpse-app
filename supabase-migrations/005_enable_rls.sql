-- Enable Row Level Security on all tables
-- This migration enables RLS and creates policies for secure access

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICIES FOR public.shops
-- ============================================

-- Allow service role full access (for server-side operations)
CREATE POLICY "Service role has full access to shops"
ON public.shops
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- POLICIES FOR public.products
-- ============================================

-- Allow service role full access
CREATE POLICY "Service role has full access to products"
ON public.products
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- POLICIES FOR public.product_variants
-- ============================================

-- Allow service role full access
CREATE POLICY "Service role has full access to product_variants"
ON public.product_variants
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- POLICIES FOR public.analytics_events
-- ============================================

-- Allow service role full access
CREATE POLICY "Service role has full access to analytics_events"
ON public.analytics_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- POLICIES FOR public.Session (Prisma/Shopify sessions)
-- ============================================

-- Allow service role full access
CREATE POLICY "Service role has full access to Session"
ON public."Session"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- VERIFICATION
-- ============================================

-- Run this to verify RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
