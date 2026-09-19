-- Migration 072: Overhaul release one foundations (spec Parts 1-2).
--
-- brand_profiles: one row per shop holding the frozen Brand Profile JSON
-- (docs/overhaul/CONTRACTS.md Contract 1) — extracted design tokens with
-- per-token source/confidence, theme identity, homepage signals, and the
-- template assignment payload. Re-extraction upserts by shop_id.
--
-- chat_assistant_config.quiz_template / quiz_preset: the merchant-facing
-- template selection (Contract 3). NULL template = legacy rendering, so
-- every existing shop renders exactly as before until assigned.
--
-- shops.overhaul_enabled: per-shop flag for the new install flow (R2);
-- pairs with the OVERHAUL_ONBOARDING env flag. Default false everywhere.
--
-- ⚠ Run BEFORE deploying app code.

CREATE TABLE IF NOT EXISTS brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  theme_name text,
  theme_version text,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_profiles_shop_unique UNIQUE (shop_id)
);

COMMENT ON TABLE brand_profiles IS
  'Per-shop extracted brand data (design tokens, tone, category, imagery signals, template assignment). Schema frozen in docs/overhaul/CONTRACTS.md.';

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_template text
    CHECK (quiz_template IS NULL OR quiz_template IN ('t1', 't2', 't3', 't4', 't5')),
  ADD COLUMN IF NOT EXISTS quiz_preset text;

COMMENT ON COLUMN chat_assistant_config.quiz_template IS
  'Overhaul template id (t1-t5). NULL = legacy rendering (pre-template look), never auto-migrated for existing shops.';
COMMENT ON COLUMN chat_assistant_config.quiz_preset IS
  'Preset id from the template registry, when the merchant picked a preset (or extraction confidence was low).';

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS overhaul_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shops.overhaul_enabled IS
  'Per-shop opt-in to the overhaul install flow (scope -> build -> Reveal). ORLY, L&M, Glamnetic must never be enrolled.';
