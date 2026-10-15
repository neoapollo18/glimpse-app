// Studio Matching panel + camera hint (moved from the retired Quiz settings
// page, 2026-10-15). Validates the partial patch the save-match-settings
// intent writes to chat_assistant_config. Pure (no server imports) so it is
// unit tested; the tuning mapper is passed in because its defaults live
// with the config reader (supabase.server mapRecommendationTuning).

export interface MatchSettingsPatch {
  num_recommendations?: number;
  product_scope?: "all_configured" | "selected";
  selected_product_ids?: string[];
  recommendation_mode?: "matrix" | "ai" | "hybrid";
  ai_guidance?: string;
  priority_product_ids?: string[];
  recommendation_tuning?: unknown;
  photo_frame_hint?: string;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Keys absent from `raw` stay absent (the upsert leaves those columns
 * untouched), so a partial save never resets settings it didn't send. */
export function validateMatchSettingsPatch<T>(
  raw: unknown,
  mapTuning: (v: unknown) => T,
): { ok: true; patch: Omit<MatchSettingsPatch, "recommendation_tuning"> & { recommendation_tuning?: T } } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Malformed settings" };
  const r = raw as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(r, k);
  const patch: Omit<MatchSettingsPatch, "recommendation_tuning"> & { recommendation_tuning?: T } = {};

  if (has("num_recommendations")) {
    const n = Number(r.num_recommendations);
    if (!Number.isInteger(n) || n < 1 || n > 8) return { ok: false, error: "Show between 1 and 8 matches" };
    patch.num_recommendations = n;
  }
  if (has("product_scope")) patch.product_scope = pick(r.product_scope, ["all_configured", "selected"] as const, "all_configured");
  if (has("selected_product_ids")) patch.selected_product_ids = strings(r.selected_product_ids);
  if (has("recommendation_mode")) patch.recommendation_mode = pick(r.recommendation_mode, ["matrix", "ai", "hybrid"] as const, "matrix");
  // A non-string guidance is ignored, never written as "" (that would blank
  // a generated rulebook).
  if (has("ai_guidance") && typeof r.ai_guidance === "string") patch.ai_guidance = r.ai_guidance;
  if (has("priority_product_ids")) patch.priority_product_ids = strings(r.priority_product_ids);
  if (has("recommendation_tuning")) patch.recommendation_tuning = mapTuning(r.recommendation_tuning);
  if (has("photo_frame_hint")) {
    patch.photo_frame_hint = typeof r.photo_frame_hint === "string" ? r.photo_frame_hint.trim().slice(0, 200) : "";
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save" };
  return { ok: true, patch };
}
