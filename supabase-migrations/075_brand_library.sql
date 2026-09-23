-- Migration 075: Brand library (Overhaul v2 Part 4.1 / G1).
--
-- brand_library: per-store image index built at catalog sync. Every image
-- the store already owns (product media beyond image 1, variant swatches,
-- collection banners, homepage + Brand API assets, merchant uploads),
-- heuristically tagged with a role so the Studio image picker and the
-- template eligibility gates (T1 hero, T2 per-answer, T3 lifestyle) can
-- resolve imagery without any merchant action.
--
-- Additive only: no columns on existing tables. Indexing only runs for
-- shops with catalog_sync_enabled, so live merchants (ORLY, Locks & Mane,
-- Glamnetic) see zero behavior change.
--
-- ⚠ Run BEFORE deploying app code. (The runtime feature-detects a missing
-- table and no-ops with a warning, but the library simply won't build
-- until this exists.)

CREATE TABLE IF NOT EXISTS brand_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  url text NOT NULL,
  source text NOT NULL CHECK (source IN (
    'product_media', 'variant_image', 'collection_banner',
    'homepage', 'brand_api', 'upload'
  )),
  role text NOT NULL CHECK (role IN (
    'packshot', 'on-model', 'lifestyle', 'swatch', 'texture',
    'banner', 'logo', 'hero', 'unknown'
  )),
  width int,
  height int,
  ratio numeric,
  dominant_colors jsonb,
  product_ids jsonb NOT NULL DEFAULT '[]',
  filename text,
  position int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_library_shop_url_unique UNIQUE (shop_id, url)
);

CREATE INDEX IF NOT EXISTS idx_brand_library_shop_role
  ON brand_library (shop_id, role);

COMMENT ON TABLE brand_library IS
  'Per-store image index built at catalog sync (V2-SPEC Part 4.1). Heuristic role tagging; product_ids = Supabase products.id uuids the image belongs to.';
COMMENT ON COLUMN brand_library.role IS
  'Heuristic tag: source + ratio + filename keywords + media position. See tagLibraryImage in app/lib/brand-library.server.ts.';
COMMENT ON COLUMN brand_library.ratio IS
  'width / height, when both dimensions are known.';
