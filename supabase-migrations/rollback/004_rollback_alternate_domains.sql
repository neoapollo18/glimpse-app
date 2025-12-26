-- ============================================
-- ROLLBACK: Remove Alternate Domains Support
-- Date: 2025-12-26
-- ============================================

-- Remove the RPC function
DROP FUNCTION IF EXISTS add_alternate_domain(UUID, TEXT);

-- Remove the index
DROP INDEX IF EXISTS idx_shops_alternate_domains;

-- Remove the column
ALTER TABLE shops DROP COLUMN IF EXISTS alternate_domains;

-- ============================================
-- ROLLBACK COMPLETE
-- ============================================

