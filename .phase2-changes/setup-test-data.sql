-- ================================================
-- PHASE 2 TEST DATA SETUP
-- ================================================
-- Run this in Supabase SQL Editor to set up test data

-- ================================================
-- STEP 1: View your existing products
-- ================================================
SELECT 
  id,
  product_name,
  shopify_id,
  LEFT(transformation_prompt, 50) || '...' as prompt_preview
FROM products
ORDER BY created_at DESC
LIMIT 5;

-- Copy one of the 'id' values (UUID) from above
-- You'll need it for the next step!

-- ================================================
-- STEP 2: Insert test variants
-- ================================================
-- IMPORTANT: Replace 'YOUR-PRODUCT-ID-HERE' with actual UUID from Step 1

-- Test Variant 1: Red variant
INSERT INTO product_variants (
  product_id,
  shopify_variant_id,
  variant_title,
  transformation_prompt
) VALUES (
  'YOUR-PRODUCT-ID-HERE',  -- ← REPLACE THIS!
  'gid://shopify/ProductVariant/TEST_RED_123',
  'Test Red Variant',
  'TEST VARIANT: Apply vibrant red cosmetic enhancement to the person, making a dramatic red effect'
);

-- Test Variant 2: Blue variant
INSERT INTO product_variants (
  product_id,
  shopify_variant_id,
  variant_title,
  transformation_prompt
) VALUES (
  'YOUR-PRODUCT-ID-HERE',  -- ← REPLACE THIS!
  'gid://shopify/ProductVariant/TEST_BLUE_456',
  'Test Blue Variant',
  'TEST VARIANT: Apply cool blue cosmetic enhancement to the person, creating a subtle blue tone'
);

-- Test Variant 3: Green variant  
INSERT INTO product_variants (
  product_id,
  shopify_variant_id,
  variant_title,
  transformation_prompt
) VALUES (
  'YOUR-PRODUCT-ID-HERE',  -- ← REPLACE THIS!
  'gid://shopify/ProductVariant/TEST_GREEN_789',
  'Test Green Variant',
  'TEST VARIANT: Apply natural green cosmetic enhancement to the person, giving an earthy green glow'
);

-- ================================================
-- STEP 3: Verify test data was inserted
-- ================================================
SELECT 
  pv.variant_title,
  pv.shopify_variant_id,
  pv.transformation_prompt,
  p.product_name as product
FROM product_variants pv
JOIN products p ON pv.product_id = p.id
WHERE pv.variant_title LIKE 'Test%'
ORDER BY pv.created_at DESC;

-- You should see 3 test variants listed

-- ================================================
-- STEP 4: Get test data for API testing
-- ================================================
-- Copy these values to use in your API tests:

SELECT 
  p.shopify_id as product_id_for_api,
  pv.shopify_variant_id as variant_id_for_api,
  pv.variant_title,
  'Use these in your test!' as note
FROM product_variants pv
JOIN products p ON pv.product_id = p.id
WHERE pv.variant_title LIKE 'Test%'
ORDER BY pv.created_at DESC;

-- ================================================
-- CLEANUP (run after testing)
-- ================================================
-- Uncomment to delete test data:

/*
DELETE FROM product_variants 
WHERE variant_title LIKE 'Test%';

-- Verify cleanup
SELECT COUNT(*) as remaining_test_variants
FROM product_variants 
WHERE variant_title LIKE 'Test%';
-- Should return 0
*/

-- ================================================
-- TROUBLESHOOTING QUERIES
-- ================================================

-- Check all variants for a product:
/*
SELECT * FROM product_variants 
WHERE product_id = 'YOUR-PRODUCT-ID-HERE';
*/

-- Check if foreign key is working:
/*
SELECT 
  pv.id,
  pv.variant_title,
  p.product_name,
  CASE 
    WHEN p.id IS NULL THEN '❌ Orphaned'
    ELSE '✅ Linked'
  END as status
FROM product_variants pv
LEFT JOIN products p ON pv.product_id = p.id;
*/

-- Count variants per product:
/*
SELECT 
  p.product_name,
  COUNT(pv.id) as variant_count
FROM products p
LEFT JOIN product_variants pv ON p.id = pv.product_id
GROUP BY p.id, p.product_name
ORDER BY variant_count DESC;
*/

