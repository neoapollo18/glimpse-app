-- Add reference_image_url column to products table
-- Stores a URL to a reference image that gets sent to Gemini alongside the user's selfie
-- Use case: wig try-on, specific product placement, etc.
ALTER TABLE products ADD COLUMN IF NOT EXISTS reference_image_url TEXT;

-- Also add to product_variants for variant-specific reference images
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reference_image_url TEXT;

COMMENT ON COLUMN products.reference_image_url IS 'URL to a reference product image fed to Gemini during transformation';
COMMENT ON COLUMN product_variants.reference_image_url IS 'URL to a variant-specific reference image fed to Gemini during transformation';
