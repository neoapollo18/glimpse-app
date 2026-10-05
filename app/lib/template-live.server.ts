// Per-shop template go-live gate (migration 081).
//
// History: after the 2026-09-25 incident (stale quiz_template values flipped
// live stores to templates at deploy), a global env switch,
// QUIZ_TEMPLATES_LIVE, kept EVERY shop on the classic quiz. That made
// template quizzes impossible to publish: Studio showed "Preview only", and a
// template shop that turned its quiz on anyway was served the classic layout
// (Studio and storefront disagreed, spec 6.4).
//
// The incident's real cause was that "a template is assigned" doubled as "the
// template is live". Those are now separate:
//   - quiz_template     = what the merchant is building (Studio, gallery,
//                         generator write it freely)
//   - template_live_at  = the merchant deliberately published a template quiz
//                         (Publish sheet, Live tab "Turn on", dashboard mode
//                         switch that turns the quiz on). Turning the quiz
//                         off clears it: the app's surface writer does, and
//                         migration 081's trigger enforces it for every
//                         other writer of enabled / assistant_mode.
// The storefront serves a template only when both are set. A template switch
// on an already-published quiz goes live immediately, like every other
// Studio edit (save-to-live model).
//
// QUIZ_TEMPLATES_LIVE survives as an emergency kill: any value other than
// unset / true / on / 1 / yes (e.g. "off", "false", "no") forces the classic
// quiz everywhere and pauses template publishing. Unset or an on-value = the
// per-shop stamp decides ("true" no longer means "serve every template").

import { isTemplateId } from "./quiz-templates";

// Fails CLOSED: during an incident any spelling of "off" (no, disabled,
// kill...) must kill. Only unset or an explicit on-value lets the per-shop
// stamp decide.
const NOT_KILLED = new Set(["", "true", "on", "1", "yes"]);

export function templatesKilled(): boolean {
  const v = (process.env.QUIZ_TEMPLATES_LIVE ?? "").trim().toLowerCase();
  return !NOT_KILLED.has(v);
}

/** Can this config's template render on a storefront at all (a known
 * template, not killed)? The stamp-free half of templateServedLive, used
 * as-is by the signed on-store preview, which shows what Publish would put
 * live. */
export function templateRenderable(config: { quiz_template: string | null | undefined }): boolean {
  return !templatesKilled() && isTemplateId(config.quiz_template);
}

/** Does the storefront serve this shop's template right now? */
export function templateServedLive(config: {
  quiz_template: string | null | undefined;
  template_live_at: string | null | undefined;
}): boolean {
  return templateRenderable(config) && Boolean(config.template_live_at);
}

export const TEMPLATES_PAUSED_ERROR =
  "Template quizzes can't go live right now. Your shoppers keep seeing your current quiz.";

/** Migration 081 (template_live_at) has not run yet. */
export const TEMPLATES_NEED_MIGRATION_ERROR =
  "Publishing templates needs a quick database update on our side. Please try again shortly.";

/**
 * The template_live_at patch that goes with a quiz-surface change.
 *   - surface OFF: clear the stamp (the next turn-on is a fresh publish).
 *   - surface ON, template quiz: stamp now (refused while killed).
 *   - surface ON, classic quiz: clear a leftover stamp so a later template
 *     assignment can't go live without its own publish.
 * The column is only written when it actually changes, so classic shops
 * never touch it (and keep working if migration 081 hasn't run yet).
 */
export function templateLivePatch(
  current: { quiz_template: string | null | undefined; template_live_at: string | null | undefined },
  quizSurfaceOn: boolean,
): { ok: true; patch: { template_live_at?: string | null } } | { ok: false; error: string } {
  const clear = current.template_live_at ? { template_live_at: null } : {};
  if (!quizSurfaceOn || !isTemplateId(current.quiz_template)) return { ok: true, patch: clear };
  if (templatesKilled()) return { ok: false, error: TEMPLATES_PAUSED_ERROR };
  return { ok: true, patch: { template_live_at: new Date().toISOString() } };
}

const quizSurfaceOn = (c: { enabled?: boolean | null; assistant_mode?: string | null }) =>
  Boolean(c.enabled) && (c.assistant_mode === "quiz" || c.assistant_mode === "both");

/**
 * For writers that save `enabled` / `assistant_mode` as part of a bigger
 * settings form (assistant settings page, internal admin toggle). Only a
 * real quiz-surface transition touches the stamp, so an unrelated save never
 * publishes or un-publishes a template. Never fails the caller's save: while
 * killed, a template quiz turned on here simply serves the classic layout.
 */
export function templateLivePatchForSave(
  before: {
    enabled?: boolean | null;
    assistant_mode?: string | null;
    quiz_template: string | null | undefined;
    template_live_at: string | null | undefined;
  },
  after: { enabled?: boolean | null; assistant_mode?: string | null },
): { template_live_at?: string | null } {
  const merged = {
    enabled: after.enabled ?? before.enabled,
    assistant_mode: after.assistant_mode ?? before.assistant_mode,
  };
  const wasOn = quizSurfaceOn(before);
  const nowOn = quizSurfaceOn(merged);
  if (wasOn === nowOn) return {};
  const r = templateLivePatch(before, nowOn);
  return r.ok ? r.patch : {};
}
