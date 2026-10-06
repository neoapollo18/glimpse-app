// Recommendation Logic Spec v2, runtime (Spec 7.3), layered ON TOP of the
// existing quiz-recommend pipeline.
//
// Inert unless the shop has ACTIVE answer sentences or store-wide rules:
// loadAnswerLayer returns null and the endpoint runs exactly as before.
// Display-only sentences (drafted for quizzes with their own logic) never
// reach this layer. Nothing here edits recommendation rules or guidance.
//
// Order (Spec 7.3):
//   1. pool minus global never (hard, pre-model)
//   2. for each chosen answer with mode=only, intersect the pool with its
//      resolved products; an intersection that would empty the pool is
//      skipped and logged as only_relaxed
//   3. chosen lean/only sentences go to the ranker verbatim, in question
//      order, and candidates they resolved to are tagged for it
//   4. global always products are prepended (deduped)

import { supabase, type MultiCriteria, type RecommendationFlow } from "./supabase.server";
import { normalizeGlobalRules, ruleKey } from "./answer-rules-shared";
import type { AnswerLayer, ChosenSentence, LayerRule } from "./answer-rules-layer";

export { narrowPool, sentenceTags, prependAlways, applyAlways } from "./answer-rules-layer";
export type { AnswerLayer, ChosenSentence } from "./answer-rules-layer";

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; layer: AnswerLayer | null }>();

export function invalidateAnswerLayer(shopId: string): void {
  cache.delete(shopId);
}

export async function loadAnswerLayer(shopId: string, rawGlobal: unknown): Promise<AnswerLayer | null> {
  const global = normalizeGlobalRules(rawGlobal);
  const hit = cache.get(shopId);
  let rules: Map<string, LayerRule>;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    rules = hit.layer?.rules ?? new Map();
  } else {
    rules = new Map();
    // Fail open: any read error (incl. migration 082 not run) = no layer.
    const { data, error } = await supabase
      .from("quiz_answer_rules")
      .select("axis_key, axis_value, sentence, mode, resolved")
      .eq("shop_id", shopId)
      .eq("active", true);
    if (!error) {
      for (const r of data ?? []) {
        if (!r.sentence?.trim()) continue;
        rules.set(ruleKey(r.axis_key, r.axis_value), {
          sentence: r.sentence,
          mode: r.mode,
          productIds: new Set<string>(Array.isArray(r.resolved?.product_ids) ? r.resolved.product_ids : []),
        });
      }
    } else {
      console.warn(`[answer-layer] read failed for ${shopId}: ${error.message}`);
    }
    cache.set(shopId, { at: Date.now(), layer: rules.size ? { rules, global } : null });
  }
  if (rules.size === 0 && global.always.length === 0 && global.never.length === 0) return null;
  return { rules, global };
}

/** The shopper's chosen answers that carry an active sentence, in
 * question order. Takes the flow getter the endpoint already memoizes, so
 * the flow is fetched at most once per request. */
export async function chosenSentences(
  layer: AnswerLayer,
  criteria: MultiCriteria,
  getFlow: () => Promise<RecommendationFlow>,
): Promise<ChosenSentence[]> {
  if (layer.rules.size === 0) return [];
  const flow = await getFlow();
  const out: ChosenSentence[] = [];
  flow.questions.forEach((q: any, qi: number) => {
    const raw = criteria[q.axisKey];
    if (raw == null) return;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      const rule = layer.rules.get(ruleKey(q.axisKey, v));
      if (!rule || rule.mode === "none") continue;
      const label = q.options?.find((o: any) => o.axisValue === v || o.value === v)?.label ?? v;
      out.push({ questionIndex: qi + 1, axisKey: q.axisKey, label, sentence: rule.sentence, mode: rule.mode });
    }
  });
  return out;
}

