-- 066: Allow created_by='seed' on quiz_config_versions.
--
-- initDraftFromLive auto-seeds a draft via saveQuizDraft(shopId, draft,
-- "seed") so a never-edited auto-seed can be told apart from real merchant
-- edits (hasQuizDraft excludeSeeded; any real edit overwrites created_by),
-- but 058's inline CHECK only allows ('ai','manual','system') — the seed
-- INSERT fails 23514, initDraftFromLive throws, and every shop with a live
-- quiz gets the create-from-scratch wizard instead of an editor seeded from
-- live. Relax the CHECK to include 'seed'. Postgres auto-named 058's inline
-- column constraint quiz_config_versions_created_by_check.
--
-- RUN BEFORE deploying (repo convention).

ALTER TABLE quiz_config_versions
  DROP CONSTRAINT IF EXISTS quiz_config_versions_created_by_check;

ALTER TABLE quiz_config_versions
  ADD CONSTRAINT quiz_config_versions_created_by_check
  CHECK (created_by IN ('ai', 'manual', 'system', 'seed'));
