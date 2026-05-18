-- ============================================
-- MIGRATION: Enable RLS on chat_assistant_config
-- Date: 2026-05-17
-- Description: chat_assistant_config was created directly in the Supabase
--              dashboard (no CREATE TABLE migration exists for it), so it
--              never had row level security enabled. The Supabase linter
--              flags this as an error: the table lives in the `public`
--              schema and is therefore exposed via PostgREST to the `anon`
--              key, meaning storefront-facing merchant config could be read
--              or written by anyone with the public anon key.
--
--              Fix mirrors migration 027: enable RLS, grant the service role
--              full access, leave `anon` with nothing. All app reads/writes
--              already go through the server's service-role key, so this is
--              a no-op for the app and simply closes the anon hole.
-- ============================================

BEGIN;

ALTER TABLE public.chat_assistant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to chat_assistant_config"
  ON public.chat_assistant_config;
CREATE POLICY "Service role has full access to chat_assistant_config"
  ON public.chat_assistant_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
