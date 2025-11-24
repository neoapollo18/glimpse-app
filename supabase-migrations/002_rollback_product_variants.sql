-- ============================================
-- ROLLBACK: Remove Product Variants Support
-- Date: 2024-11-24
-- Description: Safely removes variant-level support
-- ============================================

-- ⚠️ WARNING: This will delete all variant configurations!
-- ⚠️ Product-level configurations will remain intact
-- ⚠️ Only run this if you need to undo the migration

-- SAFETY CHECK: Verify what data will be lost
-- Run this first to see what will be deleted:
--   SELECT COUNT(*) as variant_configs FROM product_variants;
--   SELECT * FROM product_variants LIMIT 10;

-- ============================================
-- STEP 1: Drop trigger
-- ============================================
DROP TRIGGER IF EXISTS update_product_variants_updated_at ON product_variants;

-- ============================================
-- STEP 2: Drop function
-- ============================================
DROP FUNCTION IF EXISTS update_updated_at_column();

-- ============================================
-- STEP 3: Drop indexes
-- ============================================
DROP INDEX IF EXISTS idx_product_variants_product_shopify;
DROP INDEX IF EXISTS idx_product_variants_shopify_variant_id;
DROP INDEX IF EXISTS idx_product_variants_product_id;

-- ============================================
-- STEP 4: Drop table (CASCADE removes foreign key constraints)
-- ============================================
DROP TABLE IF EXISTS product_variants CASCADE;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Verify table is gone:
--   SELECT * FROM information_schema.tables WHERE table_name = 'product_variants';
--   (Should return 0 rows)
--
-- Verify products table still exists:
--   SELECT COUNT(*) FROM products;
--   (Should return your product count)

-- ============================================
-- ROLLBACK COMPLETE
-- ============================================
-- Your system should now be in the same state as before the migration
-- All product-level configurations are preserved

