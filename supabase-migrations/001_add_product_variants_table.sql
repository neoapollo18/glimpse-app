-- ============================================
-- MIGRATION: Add Product Variants Support
-- Date: 2024-11-24
-- Description: Adds variant-level transformation prompts
-- ============================================

-- SAFETY NOTE: This migration is ADDITIVE ONLY
-- - Does NOT modify existing tables
-- - Does NOT delete any data
-- - Existing products table remains unchanged as fallback
-- - Can be rolled back safely using rollback script

-- ============================================
-- STEP 1: Document Current Schema
-- ============================================
-- Existing tables (DO NOT MODIFY):
--   • shops (id, shop_domain, shopify_id, shop_name, created_at)
--   • products (id, shop_id, shopify_id, product_name, transformation_prompt, created_at)
--   • analytics_events (id, shop_id, product_id, event_type, created_at)

-- ============================================
-- STEP 2: Create product_variants table
-- ============================================
CREATE TABLE IF NOT EXISTS product_variants (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to products table
  product_id UUID NOT NULL,
  
  -- Shopify variant identifier (e.g., "gid://shopify/ProductVariant/123456789")
  shopify_variant_id TEXT NOT NULL,
  
  -- Human-readable variant name (e.g., "Red Eyeliner", "Small / Cotton")
  variant_title TEXT NOT NULL,
  
  -- Variant-specific transformation prompt
  transformation_prompt TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_product
    FOREIGN KEY (product_id) 
    REFERENCES products(id) 
    ON DELETE CASCADE,
  
  -- Ensure one prompt per variant per product
  CONSTRAINT unique_product_variant
    UNIQUE(product_id, shopify_variant_id)
);

-- ============================================
-- STEP 3: Add indexes for performance
-- ============================================
-- Index for fast lookups by product_id
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id 
  ON product_variants(product_id);

-- Index for fast lookups by shopify_variant_id
CREATE INDEX IF NOT EXISTS idx_product_variants_shopify_variant_id 
  ON product_variants(shopify_variant_id);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_product_variants_product_shopify 
  ON product_variants(product_id, shopify_variant_id);

-- ============================================
-- STEP 4: Add updated_at trigger
-- ============================================
-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
DROP TRIGGER IF EXISTS update_product_variants_updated_at ON product_variants;
CREATE TRIGGER update_product_variants_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STEP 5: Add comments for documentation
-- ============================================
COMMENT ON TABLE product_variants IS 'Stores variant-specific AI transformation prompts. Falls back to product-level prompt if no variant config exists.';
COMMENT ON COLUMN product_variants.product_id IS 'References the parent product in products table';
COMMENT ON COLUMN product_variants.shopify_variant_id IS 'Shopify variant GID (e.g., gid://shopify/ProductVariant/123)';
COMMENT ON COLUMN product_variants.variant_title IS 'Human-readable variant name for admin UI';
COMMENT ON COLUMN product_variants.transformation_prompt IS 'AI prompt specific to this variant';

-- ============================================
-- VERIFICATION QUERIES (Run these to verify)
-- ============================================
-- Check table exists:
--   SELECT * FROM information_schema.tables WHERE table_name = 'product_variants';
--
-- Check columns:
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_variants';
--
-- Check indexes:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'product_variants';
--
-- Check constraints:
--   SELECT conname, contype FROM pg_constraint WHERE conrelid = 'product_variants'::regclass;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Next steps:
-- 1. Run this migration in Supabase SQL editor
-- 2. Verify tables created successfully
-- 3. Test with sample data
-- 4. Keep rollback script ready (002_rollback.sql)

