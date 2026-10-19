import { supabase, getChatAssistantConfig, getRecommendationCounts } from "./supabase.server";
import { enabledColumnarSpec } from "./columnar/engine.server";
import { matchingReadiness, type MatchingReadiness } from "./matching-readiness";

/**
 * Active answer sentences that change results (lean / prefer / only),
 * limited to the quiz's current axes so rows left over from a deleted
 * question don't count. A read error (migration 082 not run) counts as
 * none, the same as the runtime's fail-open answer layer.
 */
export async function countActiveAnswerRules(shopId: string, axisKeys?: string[]): Promise<number> {
  if (axisKeys && axisKeys.length === 0) return 0;
  let q = supabase
    .from("quiz_answer_rules")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("active", true)
    .neq("mode", "none")
    .not("sentence", "is", null)
    .neq("sentence", "");
  if (axisKeys) q = q.in("axis_key", axisKeys);
  const { count, error } = await q;
  if (error) {
    console.warn(`[matching-readiness] answer rules read failed for ${shopId}: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

async function axisKeysFor(shopId: string): Promise<string[] | undefined> {
  const { data, error } = await supabase.from("recommendation_axes").select("key").eq("shop_id", shopId);
  if (error) return undefined;
  return (data ?? []).map((r: { key: string }) => r.key);
}

/** Fresh read of every matching source for one shop. */
export async function getMatchingReadiness(shopId: string, shopDomain: string): Promise<MatchingReadiness> {
  const axisKeys = await axisKeysFor(shopId);
  const [counts, cfg, answerRules] = await Promise.all([
    getRecommendationCounts(shopId).catch(() => null),
    getChatAssistantConfig(shopDomain).catch(() => null),
    countActiveAnswerRules(shopId, axisKeys),
  ]);
  return matchingReadiness({
    ruleCount: counts?.rules ?? 0,
    mode: cfg?.recommendation_mode ?? "matrix",
    columnar: Boolean(enabledColumnarSpec(cfg)),
    answerRules,
  });
}
