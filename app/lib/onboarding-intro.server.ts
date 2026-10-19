// Welcome intro (2026-10-18): the slides a new install sees before the
// scope screen ("Ready to build your quiz"). Welcome, how it works, what
// the merchant wants from the quiz, then "How do you want to get started?"
// (build it with AI, or free setup by our team).
//
// No migration: progress lives in analytics_events (the same sink as the
// setup offer and the overhaul funnel), goals in the long-standing
// shops.onboarding_goals column.
//
// Who sees it: quiz-less shops that have neither finished the intro nor
// been through the scope screen before it existed (scope_selected), so no
// merchant who already started onboarding is sent back to the beginning.

import { supabase, saveOnboardingSurvey } from "./supabase.server";
import { recordOverhaulEvent } from "./overhaul-events.server";

export const INTRO_DONE_EVENTS = ["onboarding_intro_completed", "scope_selected"] as const;

export const INTRO_GOALS = ["choose", "emails", "returns", "insights"] as const;
export type IntroGoal = (typeof INTRO_GOALS)[number];

export type IntroPath = "ai" | "expert" | "skip";

/** Slides in the intro (welcome, goals, path). */
export const INTRO_STEP_COUNT = 3;

// Positive cache: a shop that finished the intro never needs the query again.
const done = new Set<string>();

/** True once the shop has finished (or skipped) the intro, or started
 * onboarding before the intro existed. A failed lookup counts as done: a
 * merchant never gets stuck behind slides because of a read error. */
export async function introDone(shopId: string | null | undefined): Promise<boolean> {
  if (!shopId) return true;
  if (done.has(shopId)) return true;
  const { count, error } = await supabase
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("event_type", INTRO_DONE_EVENTS as unknown as string[]);
  if (error) {
    console.warn(`[onboarding-intro] lookup failed for shop ${shopId}:`, error.message);
    return true;
  }
  if ((count ?? 0) > 0) {
    done.add(shopId);
    return true;
  }
  return false;
}

/** The path the shop picked on the last slide, if any (the scope screen
 * drops its setup-offer card once the merchant has answered it here). */
export async function introPathChosen(shopId: string | null | undefined): Promise<IntroPath | null> {
  if (!shopId) return null;
  const { data, error } = await supabase
    .from("analytics_events")
    .select("properties")
    .eq("shop_id", shopId)
    .eq("event_type", "onboarding_intro_completed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const path = (data[0].properties as { path?: unknown } | null)?.path;
  return path === "ai" || path === "expert" || path === "skip" ? path : null;
}

export function cleanGoals(raw: unknown): IntroGoal[] {
  const list = Array.isArray(raw) ? raw : [];
  return INTRO_GOALS.filter((g) => list.includes(g));
}

export async function saveIntroGoals(shopDomain: string, goals: IntroGoal[]): Promise<boolean> {
  return saveOnboardingSurvey(shopDomain, goals);
}

/** Finish the intro: records the path (and the step it was left on, for
 * a skip) so the shop goes straight to the scope screen from now on. */
export async function completeIntro(
  shopDomain: string,
  shopId: string | null | undefined,
  props: { path: IntroPath; step?: number; goals?: IntroGoal[] },
): Promise<void> {
  if (shopId) done.add(shopId);
  await recordOverhaulEvent(shopDomain, "onboarding_intro_completed", props);
}
