-- Migration 081: per-shop template go-live stamp.
--
-- Replaces the global QUIZ_TEMPLATES_LIVE gate (2026-09-25 incident) with an
-- explicit, per-shop publish act. The storefront serves a template ONLY when
-- the merchant published (or turned on) a template quiz, which stamps this
-- column. A quiz_template value written by anything else (generator,
-- gallery, stale rows like the 09-25 incident) keeps serving the classic
-- quiz until the merchant publishes. Turning the quiz off clears it.
--
-- Deliberately NOT prefixed quiz_: every quiz_* key flows through version
-- snapshots/restores and copilot setting writes. Going live must never be a
-- side effect of restoring an old version.
--
-- No backfill: every shop starts unpublished (classic rendering), which is
-- exactly what shoppers see today with QUIZ_TEMPLATES_LIVE off.
--
-- Run BEFORE deploying app code. Reads tolerate the column missing (treated
-- as unpublished); the publish/turn-on write needs it. Idempotent: safe to
-- re-run (re-run it if an earlier copy without the trigger was applied).

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS template_live_at timestamptz;

COMMENT ON COLUMN chat_assistant_config.template_live_at IS
  'When the merchant last published a template quiz. NULL = storefront serves the classic quiz even if quiz_template is set.';

-- "Turning the quiz off clears it", enforced for EVERY writer. The app's
-- surface writers (Studio Turn off, unpublish, the dashboard mode switch,
-- the AI Assistant settings save, the /admin toggle) clear the stamp
-- themselves; this trigger is the backstop for everything else that can
-- switch the quiz surface off: a turn-off whose config read failed (it
-- writes the bare flag), one-off scripts, and any future writer. A stamp
-- that survived one of those would let a later turn-on through a
-- non-publishing path serve a template (possibly one switched in while the
-- quiz was off) without a fresh publish.
--
-- The same goes for a quiz that drops its template (a restore of a
-- pre-template version): a classic quiz holds no stamp, so a template that
-- comes back later needs its own publish (templateLivePatch's rule).
--
-- The quiz surface is on when enabled AND assistant_mode IN (quiz, both)
-- (api.storefront.quiz-config). BEFORE UPDATE only: a PostgREST upsert on an
-- existing row fires it with the merged row, and no writer inserts a new
-- row with a stamp (a stamp is only written together with the surface on).
CREATE OR REPLACE FUNCTION chat_assistant_config_template_live_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quiz_template IS NULL
     OR NOT (COALESCE(NEW.enabled, false) AND COALESCE(NEW.assistant_mode, 'chat') IN ('quiz', 'both')) THEN
    NEW.template_live_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_assistant_config_template_live_guard_trg ON chat_assistant_config;
CREATE TRIGGER chat_assistant_config_template_live_guard_trg
  BEFORE UPDATE ON chat_assistant_config
  FOR EACH ROW
  WHEN (NEW.template_live_at IS NOT NULL)
  EXECUTE FUNCTION chat_assistant_config_template_live_guard();
