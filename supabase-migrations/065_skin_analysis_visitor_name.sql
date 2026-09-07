-- 065: Declare the visitor_name column saveSkinAnalysisPhoto already writes.
--
-- app/lib/supabase.server.ts inserts visitor_name into skin_analysis_uploads
-- (conference name↔face pairing) and admin.skin-uploads.csv selects/filters
-- it, but no migration ever created the column — only an inline code comment
-- suggesting a manual ALTER. On a schema without it, PostgREST rejects the
-- ENTIRE insert (unknown column), silently losing the index row while the
-- photo bytes orphan in the private bucket.
--
-- Idempotent: the live DB may already have this column from a manual ALTER.
--
-- Run BEFORE deploy.

ALTER TABLE skin_analysis_uploads ADD COLUMN IF NOT EXISTS visitor_name TEXT;
