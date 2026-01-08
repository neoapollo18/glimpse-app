-- Fix function search paths for security
-- This prevents potential SQL injection through schema manipulation

-- Fix add_alternate_domain function
CREATE OR REPLACE FUNCTION public.add_alternate_domain(p_shop_id UUID, p_domain TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shops
  SET alternate_domains = array_append(
    COALESCE(alternate_domains, ARRAY[]::TEXT[]),
    p_domain
  )
  WHERE id = p_shop_id
  AND NOT (p_domain = ANY(COALESCE(alternate_domains, ARRAY[]::TEXT[])));
END;
$$;

-- Fix update_updated_at_column function (common trigger function)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
