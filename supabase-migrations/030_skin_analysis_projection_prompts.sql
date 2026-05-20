-- ============================================
-- MIGRATION: Sun-damage projection prompts
-- Date: 2026-05-20
-- Description: Adds two nullable prompt columns to skin_analysis_config so
--              merchants can edit the prompts that drive the two AI-generated
--              "5 years from now" projection images shown on the storefront
--              widget (without treatment / with treatment).
--
--              Both nullable + code-side defaults so the feature works out
--              of the box for shops that haven't customized them.
-- ============================================

BEGIN;

ALTER TABLE skin_analysis_config
  ADD COLUMN IF NOT EXISTS projection_without_treatment_prompt   TEXT,
  ADD COLUMN IF NOT EXISTS projection_with_treatment_prompt TEXT;

COMMENT ON COLUMN skin_analysis_config.projection_without_treatment_prompt
  IS 'Merchant-edited prompt for the "5 years from now WITHOUT treatment" projection image. NULL = use built-in default.';
COMMENT ON COLUMN skin_analysis_config.projection_with_treatment_prompt
  IS 'Merchant-edited prompt for the "5 years from now WITH treatment" projection image. NULL = use built-in default.';

COMMIT;
