-- ============================================
-- VERIFICATION SCRIPT
-- Run these queries to verify migration success
-- ============================================

-- ============================================
-- SECTION 1: Table Verification
-- ============================================
SELECT 
  '✓ Table Exists' as status,
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_name = 'product_variants';
-- Expected: 1 row with table_name = 'product_variants'

-- ============================================
-- SECTION 2: Column Verification
-- ============================================
SELECT 
  '✓ Column Structure' as status,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'product_variants'
ORDER BY ordinal_position;
-- Expected: 7 columns (id, product_id, shopify_variant_id, variant_title, transformation_prompt, created_at, updated_at)

-- ============================================
-- SECTION 3: Index Verification
-- ============================================
SELECT 
  '✓ Indexes' as status,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename = 'product_variants';
-- Expected: 4 indexes (1 primary key + 3 custom indexes)

-- ============================================
-- SECTION 4: Constraint Verification
-- ============================================
SELECT 
  '✓ Constraints' as status,
  conname as constraint_name,
  CASE contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
  END as constraint_type
FROM pg_constraint 
WHERE conrelid = 'product_variants'::regclass;
-- Expected: Primary key, foreign key to products, unique constraint

-- ============================================
-- SECTION 5: Trigger Verification
-- ============================================
SELECT 
  '✓ Triggers' as status,
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'product_variants';
-- Expected: 1 trigger for updated_at

-- ============================================
-- SECTION 6: Foreign Key Relationship Test
-- ============================================
-- This verifies the foreign key works (requires at least one product)
SELECT 
  '✓ Foreign Key Relationship' as status,
  p.id as product_id,
  p.product_name,
  COUNT(pv.id) as variant_count
FROM products p
LEFT JOIN product_variants pv ON p.id = pv.product_id
GROUP BY p.id, p.product_name
ORDER BY p.created_at DESC
LIMIT 5;
-- Expected: Shows products with their variant count (0 if none configured yet)

-- ============================================
-- SECTION 7: Data Integrity Check
-- ============================================
-- Verify no orphaned variants exist
SELECT 
  '✓ No Orphaned Variants' as status,
  COUNT(*) as orphaned_count
FROM product_variants pv
LEFT JOIN products p ON pv.product_id = p.id
WHERE p.id IS NULL;
-- Expected: 0 orphaned variants

-- ============================================
-- SECTION 8: Performance Check
-- ============================================
-- Test query performance with EXPLAIN
EXPLAIN ANALYZE
SELECT pv.*
FROM product_variants pv
WHERE pv.product_id = 'test-uuid'
  AND pv.shopify_variant_id = 'gid://shopify/ProductVariant/12345';
-- Expected: Should use index, execution time < 1ms

-- ============================================
-- SECTION 9: Full System Check
-- ============================================
-- Verify all tables still exist and are accessible
SELECT 
  '✓ All Tables Intact' as status,
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE columns.table_name = tables.table_name) as column_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('shops', 'products', 'analytics_events', 'product_variants')
ORDER BY table_name;
-- Expected: 4 tables (shops, products, analytics_events, product_variants)

-- ============================================
-- SECTION 10: Sample Data Test (OPTIONAL)
-- ============================================
-- Uncomment and modify to test with real data
/*
-- Insert test variant (replace with real product_id from your database)
INSERT INTO product_variants (product_id, shopify_variant_id, variant_title, transformation_prompt)
VALUES (
  (SELECT id FROM products LIMIT 1), -- Uses first product
  'gid://shopify/ProductVariant/TEST',
  'Test Red Variant',
  'Apply red eyeliner to the person''s eyes'
)
RETURNING *;

-- Verify insert
SELECT * FROM product_variants WHERE variant_title = 'Test Red Variant';

-- Test update timestamp trigger
UPDATE product_variants 
SET variant_title = 'Test Red Variant Updated'
WHERE variant_title = 'Test Red Variant'
RETURNING *, updated_at > created_at as timestamp_updated;
-- Expected: timestamp_updated should be true

-- Clean up test data
DELETE FROM product_variants WHERE shopify_variant_id = 'gid://shopify/ProductVariant/TEST';
*/

-- ============================================
-- MIGRATION VERIFICATION COMPLETE
-- ============================================
-- If all queries above return expected results, migration is successful!
-- Next step: Update application code to use the new table

