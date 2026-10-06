// Pure parts of the Spec v2 answer layer (answer-rules-runtime.server.ts):
// pool narrowing, ranker tags, "always" ordering. No I/O, unit-tested.

import type { Candidate } from "./recommendation-engine.server";
import type { MultiCriteria } from "./supabase.server";
import { ruleKey, type GlobalRules, type RuleMode } from "./answer-rules-shared";

export interface LayerRule {
  sentence: string;
  mode: RuleMode;
  productIds: Set<string>;
}

export interface AnswerLayer {
  rules: Map<string, LayerRule>;
  global: GlobalRules;
}

export interface ChosenSentence {
  questionIndex: number;
  axisKey: string;
  label: string;
  sentence: string;
  mode: RuleMode;
}


export function neverMatches(c: Candidate, never: GlobalRules["never"]): boolean {
  const p = c.product as any;
  for (const n of never) {
    const kind = n.kind ?? "product";
    if (kind === "product" && p.id === n.id) return true;
    if (kind === "type" && typeof p.product_type === "string" && p.product_type.toLowerCase() === n.id.toLowerCase()) return true;
    if (kind === "vendor" && typeof p.vendor === "string" && p.vendor.toLowerCase() === n.id.toLowerCase()) return true;
    if (kind === "tag" && Array.isArray(p.tags) && p.tags.some((t: unknown) => String(t).toLowerCase() === n.id.toLowerCase())) return true;
  }
  return false;
}

/** Steps 1 + 2. Returns the narrowed candidates (never empty unless the
 * input was) and which "only" constraints were relaxed. */
export function narrowPool(
  candidates: Candidate[],
  layer: AnswerLayer,
  criteria: MultiCriteria,
  logTag: string,
): { candidates: Candidate[]; relaxed: string[] } {
  let pool = layer.global.never.length ? candidates.filter((c) => !neverMatches(c, layer.global.never)) : candidates;
  if (pool.length === 0) {
    console.warn(`[${logTag}] global never removed every candidate — ignoring it for this request`);
    pool = candidates;
  }
  const relaxed: string[] = [];
  for (const [axisKey, raw] of Object.entries(criteria)) {
    const values = Array.isArray(raw) ? raw : [raw];
    // Multi-select "only" answers union their sets (any of the picks).
    const allowed = new Set<string>();
    let constrained = false;
    for (const v of values) {
      const rule = layer.rules.get(ruleKey(axisKey, v));
      if (rule?.mode === "only" && rule.productIds.size > 0) {
        constrained = true;
        for (const id of rule.productIds) allowed.add(id);
      }
    }
    if (!constrained) continue;
    const next = pool.filter((c) => allowed.has(c.product.id));
    if (next.length === 0) {
      relaxed.push(axisKey);
      console.warn(`[${logTag}] only_relaxed ${axisKey}: constraint would empty the pool`);
      continue;
    }
    pool = next;
  }
  return { candidates: pool, relaxed };
}

/** Step 3 input for the ranker: product id -> question numbers whose
 * chosen sentence resolved to it. */
export function sentenceTags(layer: AnswerLayer, chosen: ChosenSentence[], criteria: MultiCriteria): Map<string, number[]> {
  const tags = new Map<string, number[]>();
  for (const c of chosen) {
    const raw = criteria[c.axisKey];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      const rule = layer.rules.get(ruleKey(c.axisKey, String(v)));
      if (!rule) continue;
      for (const id of rule.productIds) {
        const arr = tags.get(id) ?? [];
        if (!arr.includes(c.questionIndex)) arr.push(c.questionIndex);
        tags.set(id, arr);
      }
    }
  }
  return tags;
}

function splitAlways<T extends { product: { id: string } }>(ordered: T[], always: GlobalRules["always"]): { front: T[]; used: Set<T> } {
  const front: T[] = [];
  const used = new Set<T>();
  for (const a of always) {
    const c = ordered.find((x) => x.product.id === a.id && !used.has(x));
    if (c) {
      front.push(c);
      used.add(c);
    }
  }
  return { front, used };
}

/** Step 4: always products first (product-level: the first candidate of
 * each always product that is still in the ordering). */
export function prependAlways<T extends { product: { id: string } }>(ordered: T[], always: GlobalRules["always"]): T[] {
  if (always.length === 0) return ordered;
  const { front, used } = splitAlways(ordered, always);
  return front.length ? [...front, ...ordered.filter((x) => !used.has(x))] : ordered;
}

/** Step 4 on a matrix outcome: `ordered.slice(0, matrixCount)` is the
 * served segment downstream (stock filter, pick list), so an always
 * product pulled in from outside it must widen the segment instead of
 * pushing the last matrix pick out of it. */
export function applyAlways<T extends { product: { id: string } }, O extends { ordered: T[]; matrixApplied: boolean; matrixCount: number }>(
  outcome: O,
  always: GlobalRules["always"],
): O {
  if (always.length === 0) return outcome;
  const { front, used } = splitAlways(outcome.ordered, always);
  if (front.length === 0) return outcome;
  const ordered = [...front, ...outcome.ordered.filter((x) => !used.has(x))];
  if (!outcome.matrixApplied) return { ...outcome, ordered };
  const segment = new Set(outcome.ordered.slice(0, outcome.matrixCount));
  const added = front.filter((c) => !segment.has(c)).length;
  return { ...outcome, ordered, matrixCount: outcome.matrixCount + added };
}
