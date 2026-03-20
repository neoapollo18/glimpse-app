-- Multiple reference images per product and per variant (JSON array of public URLs).
-- Legacy reference_image_url remains synced to the first URL for backward compatibility.

ALTER TABLE products ADD COLUMN IF NOT EXISTS reference_image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reference_image_urls JSONB DEFAULT '[]'::jsonb;

-- Backfill from single-URL column when set
UPDATE products
SET reference_image_urls = jsonb_build_array(reference_image_url)
WHERE reference_image_url IS NOT NULL
  AND btrim(reference_image_url) <> ''
  AND (
    reference_image_urls IS NULL
    OR reference_image_urls = '[]'::jsonb
    OR jsonb_array_length(COALESCE(reference_image_urls, '[]'::jsonb)) = 0
  );

UPDATE product_variants
SET reference_image_urls = jsonb_build_array(reference_image_url)
WHERE reference_image_url IS NOT NULL
  AND btrim(reference_image_url) <> ''
  AND (
    reference_image_urls IS NULL
    OR reference_image_urls = '[]'::jsonb
    OR jsonb_array_length(COALESCE(reference_image_urls, '[]'::jsonb)) = 0
  );

COMMENT ON COLUMN products.reference_image_urls IS 'JSON array of reference image URLs (max 5 in app). First item mirrors reference_image_url.';
COMMENT ON COLUMN product_variants.reference_image_urls IS 'JSON array of variant-specific reference URLs; when non-empty, used instead of product-level refs.';
