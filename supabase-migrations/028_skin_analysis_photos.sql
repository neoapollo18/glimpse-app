-- ============================================
-- MIGRATION: Persist skincare-analysis selfies
-- Date: 2026-05-17
-- Description: Adds a PRIVATE storage bucket + index table for the customer
--              selfies uploaded to the AI skin-analysis feature.
--
--              This intentionally reverses the in-memory-only handling
--              described in migration 027 / legal/PRIVACY_POLICY.md §5.2:
--              selfies are now retained. The bucket is PRIVATE — these are
--              customer face photos, so (unlike `reference-images`) there
--              are no public URLs. Read access is via the service role or
--              short-lived signed URLs only.
--
--              TODO before this is used at scale beyond the single
--              early-access shop: update the privacy policy, add a
--              capture-time consent notice, and add a retention/auto-delete
--              job (face photos are "sensitive personal information" under
--              CPRA).
-- ============================================

BEGIN;

-- Private bucket — note `public = false`, unlike the `reference-images` bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('skin-analysis-photos', 'skin-analysis-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Index of every persisted selfie. One row per upload. The image bytes live
-- in the storage bucket above; this table just records where + when.
CREATE TABLE IF NOT EXISTS skin_analysis_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- Path within the `skin-analysis-photos` bucket, e.g. "shop_com/1747.._ab12cd.jpg".
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE skin_analysis_uploads
  IS 'Index of customer selfies uploaded to the skin-analysis feature. Image bytes live in the private skin-analysis-photos storage bucket at storage_path.';

CREATE INDEX IF NOT EXISTS skin_analysis_uploads_shop_id_idx
  ON skin_analysis_uploads (shop_id, created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- Mirrors migration 027: RLS enabled, service role has full access, anon
-- gets nothing. All reads/writes go through the server's service-role key.
-- ============================================
ALTER TABLE public.skin_analysis_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to skin_analysis_uploads"
  ON public.skin_analysis_uploads;
CREATE POLICY "Service role has full access to skin_analysis_uploads"
  ON public.skin_analysis_uploads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
