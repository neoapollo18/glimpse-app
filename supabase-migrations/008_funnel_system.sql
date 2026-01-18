-- ============================================
-- MIGRATION: Funnel-Based Prompt System
-- Date: 2026-01-16
-- Description: Categories, parameters, levels for question-based product configuration
-- ============================================

-- NOTE: ADDITIVE ONLY
-- - Does NOT modify existing data in products table
-- - Existing products.transformation_prompt continues to work unchanged
-- - New columns have defaults (NULL or false) so existing rows unaffected
-- - Can be rolled back safely using rollback script

-- ============================================
-- STEP 1: Create categories table
-- ============================================
-- Stores the 11 beauty product categories (Skin Refinement, Blush, etc.)

CREATE TABLE IF NOT EXISTS categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  base_prompt     TEXT NOT NULL,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE categories IS 'Beauty product categories for funnel-based prompt configuration';
COMMENT ON COLUMN categories.name IS 'Display name (e.g., "Skin Refinement")';
COMMENT ON COLUMN categories.slug IS 'URL-safe identifier (e.g., "skin-refinement")';
COMMENT ON COLUMN categories.base_prompt IS 'Base transformation prompt for this category';
COMMENT ON COLUMN categories.sort_order IS 'Display order in category selector';

-- ============================================
-- STEP 2: Create category_parameters table
-- ============================================
-- Stores parameters/questions for each category (e.g., "evenness", "hydration_glow")

CREATE TABLE IF NOT EXISTS category_parameters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  question_text   TEXT,
  is_locked       BOOLEAN DEFAULT false,
  locked_prompt   TEXT,
  max_levels      INT DEFAULT 4,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE category_parameters IS 'Parameters/questions for each category. Locked params are auto-appended guardrails.';
COMMENT ON COLUMN category_parameters.name IS 'Internal identifier (e.g., "evenness")';
COMMENT ON COLUMN category_parameters.display_name IS 'UI label (e.g., "Skin Evenness")';
COMMENT ON COLUMN category_parameters.question_text IS 'Question shown to merchant (NULL for locked params)';
COMMENT ON COLUMN category_parameters.is_locked IS 'If true, auto-appended to prompt without merchant input';
COMMENT ON COLUMN category_parameters.locked_prompt IS 'Guardrail prompt text for locked parameters';
COMMENT ON COLUMN category_parameters.max_levels IS 'Number of answer options (2, 3, or 4)';

-- ============================================
-- STEP 3: Create parameter_levels table
-- ============================================
-- Stores the answer options and their prompt text for each parameter

CREATE TABLE IF NOT EXISTS parameter_levels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id    UUID NOT NULL REFERENCES category_parameters(id) ON DELETE CASCADE,
  level           INT NOT NULL,
  label           TEXT NOT NULL,
  prompt_text     TEXT NOT NULL,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parameter_id, level)
);

COMMENT ON TABLE parameter_levels IS 'Answer options for each parameter with associated prompt text';
COMMENT ON COLUMN parameter_levels.level IS 'Level number (1, 2, 3, or 4)';
COMMENT ON COLUMN parameter_levels.label IS 'Answer label shown to merchant (e.g., "Subtle", "Moderate")';
COMMENT ON COLUMN parameter_levels.prompt_text IS 'Prompt text appended when this level is selected';

-- ============================================
-- STEP 4: Create variant_color_profiles table
-- ============================================
-- Stores shade/color info for Blush, Bronzer, Highlighter, Eyebrow products
-- Links to existing product_variants table (created in migration 001)

CREATE TABLE IF NOT EXISTS variant_color_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id     UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  shade_name             TEXT,
  base_color_description TEXT,
  hue_family             TEXT,
  undertone              TEXT,
  deep_skin_strategy     TEXT,
  target_hair_color      TEXT,
  warmth_bias            TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_variant_id)
);

COMMENT ON TABLE variant_color_profiles IS 'Shade-specific color profiles for makeup products (Blush, Bronzer, Highlighter, Eyebrow)';
COMMENT ON COLUMN variant_color_profiles.shade_name IS 'Display name of shade (e.g., "Mocha Flush")';
COMMENT ON COLUMN variant_color_profiles.base_color_description IS 'Color description (e.g., "warm terracotta")';
COMMENT ON COLUMN variant_color_profiles.hue_family IS 'Color family: pink, rose, coral, berry, terracotta, brown, mauve, neutral, etc.';
COMMENT ON COLUMN variant_color_profiles.undertone IS 'cool, neutral, or warm';
COMMENT ON COLUMN variant_color_profiles.deep_skin_strategy IS 'Blush visibility strategy: increase_saturation, shift_to_berry, increase_brightness';
COMMENT ON COLUMN variant_color_profiles.target_hair_color IS 'For eyebrow products: target hair color';
COMMENT ON COLUMN variant_color_profiles.warmth_bias IS 'For eyebrow products: warmth bias';

-- ============================================
-- STEP 5: Alter products table (ADDITIVE - backward compatible)
-- ============================================
-- Add columns to support funnel configuration
-- Existing transformation_prompt column remains unchanged!

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS funnel_responses JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_funnel_generated BOOLEAN DEFAULT false;

COMMENT ON COLUMN products.category_id IS 'FK to categories table for funnel-configured products';
COMMENT ON COLUMN products.funnel_responses IS 'JSON object mapping parameter_id to selected level';
COMMENT ON COLUMN products.is_funnel_generated IS 'true if prompt was generated via funnel, false for legacy manual prompts';

-- ============================================
-- STEP 6: Create indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_category_parameters_category_id 
  ON category_parameters(category_id);

CREATE INDEX IF NOT EXISTS idx_parameter_levels_parameter_id 
  ON parameter_levels(parameter_id);

CREATE INDEX IF NOT EXISTS idx_products_category_id 
  ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_variant_color_profiles_variant_id 
  ON variant_color_profiles(product_variant_id);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_category_parameters_category_sort 
  ON category_parameters(category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_parameter_levels_parameter_level 
  ON parameter_levels(parameter_id, level);

-- ============================================
-- STEP 7: Enable Row Level Security
-- ============================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE parameter_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_color_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 8: Create RLS Policies (service_role full access)
-- ============================================
-- Matches pattern from 005_enable_rls.sql

CREATE POLICY "Service role has full access to categories"
ON categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to category_parameters"
ON category_parameters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to parameter_levels"
ON parameter_levels
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to variant_color_profiles"
ON variant_color_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- VERIFICATION QUERIES (Run these to verify)
-- ============================================
-- Check tables exist:
--   SELECT table_name FROM information_schema.tables 
--   WHERE table_schema = 'public' 
--   AND table_name IN ('categories', 'category_parameters', 'parameter_levels', 'variant_color_profiles');
--
-- Check new columns on products:
--   SELECT column_name, data_type 
--   FROM information_schema.columns 
--   WHERE table_name = 'products' 
--   AND column_name IN ('category_id', 'funnel_responses', 'is_funnel_generated');
--
-- Check indexes:
--   SELECT indexname FROM pg_indexes 
--   WHERE tablename IN ('category_parameters', 'parameter_levels', 'products', 'variant_color_profiles')
--   AND indexname LIKE 'idx_%';
--
-- Check RLS enabled:
--   SELECT tablename, rowsecurity FROM pg_tables 
--   WHERE schemaname = 'public' 
--   AND tablename IN ('categories', 'category_parameters', 'parameter_levels', 'variant_color_profiles');
--
-- Check policies:
--   SELECT tablename, policyname FROM pg_policies 
--   WHERE schemaname = 'public' 
--   AND tablename IN ('categories', 'category_parameters', 'parameter_levels', 'variant_color_profiles');

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Next steps:
-- 1. Run this migration in Supabase SQL editor
-- 2. Run verification queries to confirm success
-- 3. Run seed-categories.sql to populate category data
-- 4. Keep rollback script ready (rollback/008_rollback_funnel_system.sql)
