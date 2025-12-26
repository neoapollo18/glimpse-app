-- ============================================
-- MIGRATION: Add Alternate Domains Support
-- Date: 2025-12-26
-- Description: Allow shops to have multiple domains (custom domains, dev domains, etc.)
-- ============================================

-- PROBLEM SOLVED:
-- When a shop uses a custom domain (e.g., glimpsedemo.myshopify.com) but is registered
-- in Supabase with their original domain (e.g., hx5hqt-na.myshopify.com), lookups fail.
-- This migration adds an alternate_domains column to support domain aliases.
-- 
-- AUTO-LINKING:
-- When a widget sends a request from an unknown domain but the product ID matches,
-- the system automatically registers the domain as an alternate for future lookups.

-- ============================================
-- STEP 1: Add alternate_domains column
-- ============================================
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS alternate_domains TEXT[] DEFAULT '{}';

-- ============================================
-- STEP 2: Add index for efficient array searches
-- ============================================
CREATE INDEX IF NOT EXISTS idx_shops_alternate_domains 
ON shops USING GIN (alternate_domains);

-- ============================================
-- STEP 3: Add RPC function for atomic domain addition
-- ============================================
CREATE OR REPLACE FUNCTION add_alternate_domain(p_shop_id UUID, p_domain TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE shops 
  SET alternate_domains = array_append(
    COALESCE(alternate_domains, '{}'),
    p_domain
  )
  WHERE id = p_shop_id 
    AND NOT (COALESCE(alternate_domains, '{}') @> ARRAY[p_domain]);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION add_alternate_domain IS 'Atomically adds a domain to alternate_domains if not already present';

-- ============================================
-- STEP 4: Add comment for documentation
-- ============================================
COMMENT ON COLUMN shops.alternate_domains IS 'Array of alternate/custom domains that map to this shop (e.g., custom storefronts, dev domains). Auto-populated when widgets call from unknown domains.';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Check column exists:
--   SELECT column_name, data_type FROM information_schema.columns 
--   WHERE table_name = 'shops' AND column_name = 'alternate_domains';
--
-- Check index exists:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_shops_alternate_domains';
--
-- Test array query:
--   SELECT * FROM shops WHERE 'glimpsedemo.myshopify.com' = ANY(alternate_domains);

-- ============================================
-- EXAMPLE: Add an alternate domain to a shop
-- ============================================
-- UPDATE shops 
-- SET alternate_domains = array_append(alternate_domains, 'glimpsedemo.myshopify.com')
-- WHERE shop_domain = 'hx5hqt-na.myshopify.com';

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

