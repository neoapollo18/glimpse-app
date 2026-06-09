-- Migration 035: let recommendation matrix rules target a whole product
--
-- Until now recommendation_rules.variant_id was NOT NULL with a FK to
-- product_variants. Merchants who configure products at the PRODUCT level
-- (no per-shade variants) had no way to assign those products in the matrix
-- editor — the cell dropdown only listed configured variants, and the rule
-- table physically couldn't store a product reference.
--
-- This migration lets a rule reference EITHER a variant OR a product:
--   - variant_id  → a specific configured shade (existing behavior)
--   - product_id  → the whole product (new; for products without variants)
-- enforced mutually-exclusive by an XOR check so a rule always has exactly
-- one target.
--
-- Backward compatible: existing rows keep variant_id set / product_id null,
-- which satisfies the XOR check. No data backfill needed.

-- variant_id becomes optional (a no-op if already nullable on re-run).
ALTER TABLE recommendation_rules
  ALTER COLUMN variant_id DROP NOT NULL;

-- New optional product target. ON DELETE CASCADE mirrors variant_id so a
-- deleted product cleans up its matrix cells automatically.
ALTER TABLE recommendation_rules
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE CASCADE;

-- Exactly one of (variant_id, product_id) is set per rule. Dropped first so
-- the migration is idempotent (CHECK has no IF NOT EXISTS form).
ALTER TABLE recommendation_rules
  DROP CONSTRAINT IF EXISTS recommendation_rules_target_xor;
ALTER TABLE recommendation_rules
  ADD CONSTRAINT recommendation_rules_target_xor
    CHECK ((variant_id IS NOT NULL) <> (product_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_recommendation_rules_product
  ON recommendation_rules(product_id);

COMMENT ON COLUMN recommendation_rules.product_id IS 'Whole-product target for a matrix cell when the merchant assigns a product that has no specific variant. Mutually exclusive with variant_id (see recommendation_rules_target_xor).';
