-- ============================================
-- ADD DISPLAY COLOR TO PRODUCT VARIANTS
-- Date: 2026-03-23
-- Description: Adds a display_color column (hex string, e.g. '#FF6B6B') to
--              product_variants so merchants can configure a swatch color for
--              the storefront variant selection modal.
--              Nullable — no swatch is shown when NULL.
-- ============================================

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS display_color TEXT DEFAULT NULL;

-- Verification:
-- SELECT id, variant_title, display_color FROM product_variants LIMIT 5;
