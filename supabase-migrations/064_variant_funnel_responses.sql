-- 064: Persist per-shade funnel responses on product_variants.
--
-- Variant prompts bake the product-level base prompt into a final string at
-- save time. Without the raw shade answers stored, editing a product's
-- funnel answers could not rebuild existing shade prompts (they silently
-- kept serving the OLD base prompt to the storefront), and re-opening a
-- "Configured" shade rendered a blank form whose partial save overwrote the
-- fuller config.
--
-- Keyed by category parameter NAME (matches the admin shade form state).
-- Additive; NULL = shade saved before this migration or a manual variant
-- prompt — those rows are never rebuilt and behave exactly as before.
--
-- Run BEFORE deploy.

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS funnel_responses JSONB;
