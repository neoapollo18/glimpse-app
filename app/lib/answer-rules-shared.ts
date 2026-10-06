// Recommendation Logic Spec v2: per-answer rule sentences. Pure helpers
// shared by the Studio (client), the drafter/resolver and the storefront
// runtime. No server imports.

export type RuleMode = "lean" | "only" | "none";
export type RuleStatus = "resolved" | "unresolved" | "empty";
export type RuleSource = "generated" | "edited" | "chat";

export interface ResolvedSet {
  product_ids: string[];
  labels: string[];
  count: number;
}

export interface AnswerRule {
  axisKey: string;
  axisValue: string;
  sentence: string;
  mode: RuleMode;
  resolved: ResolvedSet | null;
  status: RuleStatus;
  source: RuleSource;
  /** false = display-only (describes a quiz with its own pre-existing
   * logic); true = steers the storefront runtime. */
  active: boolean;
  updatedAt: string | null;
}

export interface GlobalRuleItem {
  id: string;
  label: string;
  /** never-items may target a product or a whole facet. */
  kind?: "product" | "type" | "tag" | "vendor";
}

export interface GlobalRules {
  always: GlobalRuleItem[];
  never: GlobalRuleItem[];
}

export const EMPTY_GLOBAL_RULES: GlobalRules = { always: [], never: [] };
export const MAX_ALWAYS = 3;
export const MAX_SENTENCE_CHARS = 160;
export const NO_PREFERENCE_SENTENCE = "No preference — let the other answers decide.";

export const ruleKey = (axisKey: string, axisValue: string) => `${axisKey}:${axisValue}`;

/**
 * Mode is derived from the sentence (Spec 6: never edited directly).
 * Empty or "no preference" = none; an explicit "only" = hard narrowing;
 * everything else weights ("lean toward", "prefer", ...).
 */
export function deriveMode(sentence: string): RuleMode {
  const s = sentence.trim().toLowerCase();
  if (!s) return "none";
  if (/^(no preference|no constraint|anything|any of them|doesn'?t matter)\b/.test(s)) return "none";
  if (/\bonly\b/.test(s)) return "only";
  return "lean";
}

export function normalizeGlobalRules(raw: unknown): GlobalRules {
  if (!raw || typeof raw !== "object") return { always: [], never: [] };
  const r = raw as Record<string, unknown>;
  const items = (v: unknown, kinds: boolean): GlobalRuleItem[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .filter((x) => typeof x.id === "string" && x.id !== "")
          .map((x) => ({
            id: String(x.id),
            label: typeof x.label === "string" && x.label ? x.label : String(x.id),
            ...(kinds && ["product", "type", "tag", "vendor"].includes(String(x.kind))
              ? { kind: x.kind as GlobalRuleItem["kind"] }
              : kinds
                ? { kind: "product" as const }
                : {}),
          }))
      : [];
  return { always: items(r.always, false).slice(0, MAX_ALWAYS), never: items(r.never, true) };
}

export const hasGlobalRules = (g: GlobalRules) => g.always.length > 0 || g.never.length > 0;

/** The grey line under a sentence (Spec 2, applies-to states). */
export function appliesToLine(rule: Pick<AnswerRule, "sentence" | "mode" | "resolved" | "status">): {
  text: string;
  amber: boolean;
} {
  if (!rule.sentence.trim()) return { text: "Applies to all products · add a sentence or leave it", amber: true };
  if (rule.mode === "none") return { text: "Applies to all products", amber: false };
  if (rule.status === "unresolved" || !rule.resolved || rule.resolved.count === 0) {
    return { text: "Couldn't match this to any product — try naming a product type or shade", amber: true };
  }
  const labels = rule.resolved.labels.slice(0, 3).join(", ");
  const n = rule.resolved.count;
  if (rule.mode === "only") {
    return { text: `Only ${n === 1 ? "this 1 product" : `these ${n} products`}${labels ? ` · ${labels}` : ""}`, amber: false };
  }
  return { text: `Applies to ${n} of your products${labels ? ` · ${labels}` : ""}`, amber: false };
}

/** Compact right-aligned count on Overview lines. */
export function overviewCount(rule: Pick<AnswerRule, "sentence" | "mode" | "resolved" | "status">): {
  text: string;
  amber: boolean;
} {
  if (!rule.sentence.trim()) return { text: "Needs a sentence", amber: true };
  if (rule.mode === "none") return { text: "All products", amber: false };
  if (rule.status === "unresolved" || !rule.resolved || rule.resolved.count === 0) return { text: "No match", amber: true };
  const n = rule.resolved.count;
  return rule.mode === "only"
    ? { text: `Only ${n} product${n === 1 ? "" : "s"}`, amber: false }
    : { text: `${n} product${n === 1 ? "" : "s"}`, amber: false };
}

/** Rail dot: amber when any answer is empty or unresolvable. */
export function ruleNeedsLook(rule: Pick<AnswerRule, "sentence" | "mode" | "resolved" | "status">): boolean {
  return overviewCount(rule).amber;
}

// ---------------------------------------------------------------------
// Silent combination check (Spec 5)
// ---------------------------------------------------------------------

export interface CheckQuestion {
  axisKey: string;
  prompt: string;
  options: Array<{ axisValue: string; label: string; selectAll?: boolean }>;
}

export interface EmptyCombination {
  /** Answer labels along the path, in question order. */
  labels: string[];
  /** Question (1-based) whose "only" sentence emptied the pool. */
  culpritIndex: number;
  culpritAxisKey: string;
}

/**
 * Runs the three example paths (first answers, last answers, alternating)
 * through the same pool narrowing the runtime applies BEFORE its relaxation
 * fallback: catalog minus never, intersected with every chosen answer's
 * "only" set. Returns the first path that empties, naming the "only"
 * sentence that emptied it. (The live runtime relaxes such a constraint
 * instead of returning nothing; this check tells the merchant it happens.)
 */
export function findEmptyCombination(args: {
  questions: CheckQuestion[];
  rules: Map<string, Pick<AnswerRule, "mode" | "resolved" | "active" | "sentence">>;
  allProductIds: string[];
  neverProductIds: Set<string>;
}): EmptyCombination | null {
  const { questions, rules, allProductIds, neverProductIds } = args;
  const answerable = questions.filter((q) => q.options.length > 0);
  if (answerable.length === 0) return null;
  const paths: number[][] = [
    answerable.map(() => 0),
    answerable.map((q) => q.options.length - 1),
    answerable.map((q, i) => (i % 2 === 0 ? 0 : q.options.length - 1)),
  ];
  for (const path of paths) {
    let pool = new Set(allProductIds.filter((id) => !neverProductIds.has(id)));
    for (let qi = 0; qi < answerable.length; qi++) {
      const q = answerable[qi];
      const opt = q.options[path[qi]];
      const rule = rules.get(ruleKey(q.axisKey, opt.axisValue));
      if (!rule || rule.mode !== "only" || !rule.resolved) continue;
      const allowed = new Set(rule.resolved.product_ids);
      const next = new Set([...pool].filter((id) => allowed.has(id)));
      if (next.size === 0) {
        return {
          labels: answerable.map((qq, i) => qq.options[path[i]].label),
          culpritIndex: questions.indexOf(q) + 1,
          culpritAxisKey: q.axisKey,
        };
      }
      pool = next;
    }
  }
  return null;
}
