-- 057: Catalog sync foundations (quiz-first overhaul, Phase 1).
-- All statements additive and idempotent. Existing rows keep identical
-- behavior: status NULL is treated as active everywhere, and
-- shops.catalog_sync_enabled defaults FALSE so live merchants (ORLY, L&M)
-- are never synced and product webhooks no-op for them.
--
-- RUN BEFORE deploying the catalog-sync code (repo convention).

-- shops: per-shop gate + sync bookkeeping
ALTER TABLE shops ADD COLUMN IF NOT EXISTS catalog_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS catalog_last_synced_at TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS catalog_sync_cursor TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS catalog_product_count INTEGER;

-- products: catalog metadata (verified 2026-08-26: none of these exist yet).
-- All nullable; legacy rows read as status NULL = active.
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT
  CHECK (status IS NULL OR status IN ('active', 'draft', 'archived', 'deleted'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
-- products has no created_at today (known gotcha). Two steps so EXISTING
-- rows stay NULL ("unknown creation time"): adding the column WITH a
-- default would stamp every legacy ORLY/L&M row with the migration
-- timestamp, silently lying to any future recency logic.
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE products ALTER COLUMN created_at SET DEFAULT now();

-- product_variants: catalog metadata (created_at/updated_at already exist)
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS status TEXT
  CHECK (status IS NULL OR status IN ('active', 'deleted'));
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price NUMERIC;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Catalog sync inserts prompt-less rows; no-op if already nullable
ALTER TABLE products ALTER COLUMN transformation_prompt DROP NOT NULL;
ALTER TABLE product_variants ALTER COLUMN transformation_prompt DROP NOT NULL;

-- Idempotent upsert targets. Verified 2026-08-26: zero duplicates in prod.
-- Guard anyway: if dupes ever exist, fail loudly with the offenders listed --
-- resolve manually (NEVER auto-delete; live-merchant rows may be referenced
-- by recommendation_rules).
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(shop_id::text || ' / ' || shopify_id, ', ')
    INTO dupes
    FROM (
      SELECT shop_id, shopify_id
      FROM products
      GROUP BY shop_id, shopify_id
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate (shop_id, shopify_id) in products - resolve manually before 057: %', dupes;
  END IF;
END $$;

DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(product_id::text || ' / ' || shopify_variant_id, ', ')
    INTO dupes
    FROM (
      SELECT product_id, shopify_variant_id
      FROM product_variants
      GROUP BY product_id, shopify_variant_id
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate (product_id, shopify_variant_id) in product_variants - resolve manually before 057: %', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS products_shop_shopify_uidx
  ON products (shop_id, shopify_id);
CREATE UNIQUE INDEX IF NOT EXISTS variants_product_shopify_uidx
  ON product_variants (product_id, shopify_variant_id);
