-- ============================================
-- MIGRATION: AI Skincare Analysis (M1 schema)
-- Date: 2026-05-02
-- Description: Adds the feature flag and per-shop config table for the new
--              skin-analysis feature. Default OFF for every shop — must be
--              flipped manually from the founders admin (/admin) page.
--
--              No table for individual analyses: per privacy policy
--              (legal/PRIVACY_POLICY.md §5.2) selfies are processed in
--              memory only and discarded after the API response, and we
--              also choose not to persist the score outputs (no analytics
--              tie-in for this feature). Only merchant-facing config is
--              stored here.
-- ============================================

BEGIN;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS is_skin_analysis_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN shops.is_skin_analysis_enabled
  IS 'Feature flag for the AI skin-analysis product. Off by default; flipped manually by Gleame founders for early-access shops.';

CREATE TABLE IF NOT EXISTS skin_analysis_config (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  -- Optional override for the system prompt. NULL = use default in code.
  system_prompt TEXT,
  -- Optional emphasis pills selected by the merchant (e.g. ["wrinkles","firmness"]).
  -- Programmatically appended to the prompt so merchants can steer narration
  -- without editing the safety-critical sections of the prompt.
  emphasis_concerns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- concern_product_map: { "wrinkles": ["gid://shopify/Product/123", ...], ... }
  -- For each detected concern, the products to surface. Falls back to
  -- tag-derived defaults at runtime if a concern key is missing.
  concern_product_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE skin_analysis_config
  IS 'Per-shop merchant configuration for the AI skin-analysis feature: optional prompt override, emphasis concerns, and concern→products mapping for recommendations.';

-- Auto-populate updated_at on every UPDATE so we can tell when a merchant
-- last touched their config from the admin UI.
CREATE OR REPLACE FUNCTION skin_analysis_config_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skin_analysis_config_set_updated_at ON skin_analysis_config;
CREATE TRIGGER skin_analysis_config_set_updated_at
  BEFORE UPDATE ON skin_analysis_config
  FOR EACH ROW
  EXECUTE FUNCTION skin_analysis_config_touch_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- Mirrors migration 005's pattern: RLS enabled, service role has full access.
-- The anon role gets nothing — all reads/writes go through the server which
-- uses the service-role key.
-- ============================================
ALTER TABLE public.skin_analysis_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to skin_analysis_config"
  ON public.skin_analysis_config;
CREATE POLICY "Service role has full access to skin_analysis_config"
  ON public.skin_analysis_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
