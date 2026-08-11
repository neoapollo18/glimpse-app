-- Migration 053: per-product/per-variant multi-set try-on prompts (L&M 2-sets).
--
-- Supersedes the shop-level addendum semantics of migration 052: the 2-set
-- prompts turned out to be COMPLETE standalone prompts per product (with
-- per-shade 2-set reference photos), not a tack-on. Resolution when the
-- recommendation's quantity >= 2:
--   variant.multi_set_prompt → product.multi_set_prompt →
--   chat_assistant_config.quiz_multi_set_prompt (now a full REPLACEMENT
--   fallback, no longer appended) → the normal single-set prompt.
-- Reference images resolve the same way: variant.multi_set_reference_urls →
-- product.multi_set_reference_urls → the normal reference images.
--
-- No admin UI: these columns are script-managed (see
-- scripts/backfill-lm-two-set.cjs), mirroring how L&M's base prompts are set.
--
-- ⚠ Run BEFORE deploying app code that selects these columns.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS multi_set_prompt text,
  ADD COLUMN IF NOT EXISTS multi_set_reference_urls jsonb;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS multi_set_prompt text,
  ADD COLUMN IF NOT EXISTS multi_set_reference_urls jsonb;

COMMENT ON COLUMN products.multi_set_prompt IS
  'Standalone transformation prompt used INSTEAD of transformation_prompt when the recommendation''s quantity >= 2 (e.g. "2 sets" of clip-in extensions). Variant-level value wins when present. NULL = fall through (shop-level quiz_multi_set_prompt, else the single-set prompt).';
COMMENT ON COLUMN products.multi_set_reference_urls IS
  'JSON array of reference image URLs used with multi_set_prompt (quantity >= 2). Variant-level value wins; NULL falls back to the normal reference images.';
COMMENT ON COLUMN product_variants.multi_set_prompt IS
  'Variant-level override of products.multi_set_prompt (quantity >= 2).';
COMMENT ON COLUMN product_variants.multi_set_reference_urls IS
  'JSON array of shade-specific multi-set reference image URLs (e.g. the finished look of TWO sets in this shade). Used with the multi-set prompt when quantity >= 2.';

-- Migration 052's column is repurposed from "appended addendum" to
-- "shop-wide fallback replacement". Any value saved under 052 semantics was
-- written as a tack-on fragment (no product/shade/canvas instructions) and
-- would be actively harmful as a full prompt — clear them all rather than
-- letting the meaning silently invert under existing data.
UPDATE chat_assistant_config
SET quiz_multi_set_prompt = NULL
WHERE quiz_multi_set_prompt IS NOT NULL;

COMMENT ON COLUMN chat_assistant_config.quiz_multi_set_prompt IS
  'Shop-wide FALLBACK transformation prompt used instead of the base prompt when the recommendation''s quantity >= 2 and neither the variant nor the product defines multi_set_prompt (migration 053). {count} is replaced with the quantity. NULL = quantity never alters the prompt.';
