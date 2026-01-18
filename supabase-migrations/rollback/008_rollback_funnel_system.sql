-- ============================================
-- ROLLBACK: Funnel-Based Prompt System
-- Date: 2026-01-16
-- Description: Removes all tables and columns added by 008_funnel_system.sql
-- ============================================

-- WARNING: This will DELETE all funnel configuration data!
-- Existing products will retain their transformation_prompt values
-- but will lose category_id, funnel_responses, is_funnel_generated

-- ============================================
-- STEP 1: Drop RLS Policies
-- ============================================

DROP POLICY IF EXISTS "Service role has full access to categories" ON categories;
DROP POLICY IF EXISTS "Service role has full access to category_parameters" ON category_parameters;
DROP POLICY IF EXISTS "Service role has full access to parameter_levels" ON parameter_levels;
DROP POLICY IF EXISTS "Service role has full access to variant_color_profiles" ON variant_color_profiles;

-- ============================================
-- STEP 2: Drop indexes
-- ============================================

DROP INDEX IF EXISTS idx_category_parameters_category_id;
DROP INDEX IF EXISTS idx_parameter_levels_parameter_id;
DROP INDEX IF EXISTS idx_products_category_id;
DROP INDEX IF EXISTS idx_variant_color_profiles_variant_id;
DROP INDEX IF EXISTS idx_category_parameters_category_sort;
DROP INDEX IF EXISTS idx_parameter_levels_parameter_level;

-- ============================================
-- STEP 3: Remove columns from products table
-- ============================================
-- Must drop category_id last due to foreign key

ALTER TABLE products DROP COLUMN IF EXISTS is_funnel_generated;
ALTER TABLE products DROP COLUMN IF EXISTS funnel_responses;
ALTER TABLE products DROP COLUMN IF EXISTS category_id;

-- ============================================
-- STEP 4: Drop tables (order matters for foreign keys)
-- ============================================

DROP TABLE IF EXISTS variant_color_profiles;
DROP TABLE IF EXISTS parameter_levels;
DROP TABLE IF EXISTS category_parameters;
DROP TABLE IF EXISTS categories;

-- ============================================
-- VERIFICATION
-- ============================================
-- Confirm tables are gone:
--   SELECT table_name FROM information_schema.tables 
--   WHERE table_schema = 'public' 
--   AND table_name IN ('categories', 'category_parameters', 'parameter_levels', 'variant_color_profiles');
--   -- Should return 0 rows
--
-- Confirm columns are gone from products:
--   SELECT column_name FROM information_schema.columns 
--   WHERE table_name = 'products' 
--   AND column_name IN ('category_id', 'funnel_responses', 'is_funnel_generated');
--   -- Should return 0 rows

-- ============================================
-- ROLLBACK COMPLETE
-- ============================================
