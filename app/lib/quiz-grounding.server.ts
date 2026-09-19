/**
 * Grounding validator (Overhaul Part 3 / C2 — "the model proposes, the
 * validator disposes").
 *
 * Hard rule, enforced in code, never in the prompt: every generated
 * answer must map to ≥ 3 in-scope products (≥ 2 when the scope has < 15
 * products), and ≥ 80% of in-scope products must be reachable through at
 * least one answer path. Answers that fail are DROPPED before a merchant
 * ever sees them; a question left with < 2 valid answers is dropped
 * whole. No plausible-sounding options that recommend nothing.
 *
 * Mapping semantics per mode:
 *  - matrix/hybrid: an answer maps to the DISTINCT in-scope products
 *    targeted by rules whose criteria include that answer's axis value.
 *  - ai (no rules): deterministic token match — the answer's value/label
 *    tokens against product name + type + tags. Coarse by design; the
 *    LLM ranker does the real work at serve time, this only guarantees
 *    the answer isn't pointing at nothing.
 */

import type { CatalogProduct, GeneratedQuizConfig } from "./quiz-config-schema.server";
import { isLiveProduct } from "./quiz-config-schema.server";

export interface GroundingReport {
  ok: boolean;
  floor: number;
  reachability: number; // 0-1 share of in-scope products reachable
  answerCounts: Record<string, number>; // "axisKey:value" -> product count
  droppedAnswers: Array<{ axisKey: string; value: string; count: number }>;
  droppedQuestions: string[]; // axis keys
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "your", "our", "all", "any", "not",
  "something", "else", "other", "more", "less", "very",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function productHaystack(p: CatalogProduct): string {
  return [p.name, p.productType ?? "", ...(p.tags ?? [])].join(" ").toLowerCase();
}

export function gradeGrounding(
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
  scopeProductIds: Set<string> | null
): GroundingReport {
  const inScope = catalog.filter(
    (p) => isLiveProduct(p) && (!scopeProductIds || scopeProductIds.has(p.id))
  );
  const floor = inScope.length < 15 ? 2 : 3;
  const haystacks = inScope.map((p) => ({ id: p.id, hay: productHaystack(p) }));

  // Rule-backed coverage: axisKey:value -> set of product ids.
  const ruleCoverage = new Map<string, Set<string>>();
  const scopeIds = new Set(inScope.map((p) => p.id));
  // Variant targets ground to their parent product.
  const variantToProduct = new Map<string, string>();
  for (const p of inScope) for (const v of p.variants) variantToProduct.set(v.id, p.id);
  for (const rule of config.rules ?? []) {
    const productId =
      (rule as any).productId ??
      ((rule as any).variantId ? variantToProduct.get((rule as any).variantId) : null);
    if (!productId || !scopeIds.has(productId)) continue;
    // Criteria is a pair array (structured-output constraint).
    for (const pair of (rule as any).criteria ?? []) {
      if (typeof pair?.axisKey !== "string" || typeof pair?.axisValue !== "string") continue;
      const key = `${pair.axisKey}:${pair.axisValue}`;
      if (!ruleCoverage.has(key)) ruleCoverage.set(key, new Set());
      ruleCoverage.get(key)!.add(productId);
    }
  }

  const answerCounts: Record<string, number> = {};
  const reachable = new Set<string>();
  const hasRules = (config.rules ?? []).length > 0;

  const axisByKey = new Map(config.axes.map((a: any) => [a.key, a]));
  for (const q of config.questions as any[]) {
    const axis = axisByKey.get(q.axisKey);
    if (!axis) continue;
    for (const opt of q.options ?? []) {
      const value = opt.axisValueValue;
      if (!value || opt.selectAll) continue;
      const key = `${q.axisKey}:${value}`;
      let ids: Set<string>;
      if (hasRules && ruleCoverage.has(key)) {
        ids = ruleCoverage.get(key)!;
      } else if (hasRules && config.recommendationMode === "matrix") {
        ids = new Set(); // matrix mode with no rule for this answer = nothing
      } else {
        // ai/hybrid heuristic: token match against the in-scope catalog.
        const terms = [...tokens(String(value).replace(/_/g, " ")), ...tokens(String(opt.label ?? ""))];
        ids = new Set(
          haystacks
            .filter(({ hay }) => terms.some((t) => hay.includes(t)))
            .map(({ id }) => id)
        );
        // A vibe answer ("main character era") legally matches nothing by
        // token — in ai mode, treat non-filtering vibe axes as universal:
        // the ranker interprets them. Only flag when the answer LOOKS like
        // a concrete filter (color/type words present) yet matches nothing.
        if (ids.size === 0 && terms.length > 0 && !looksConcrete(terms)) {
          ids = new Set(scopeIds);
        }
      }
      answerCounts[key] = ids.size;
      for (const id of ids) reachable.add(id);
    }
  }

  const droppedAnswers: GroundingReport["droppedAnswers"] = [];
  for (const [key, count] of Object.entries(answerCounts)) {
    if (count < floor) {
      const [axisKey, ...rest] = key.split(":");
      droppedAnswers.push({ axisKey, value: rest.join(":"), count });
    }
  }

  const reachability = inScope.length ? reachable.size / inScope.length : 1;
  return {
    ok: droppedAnswers.length === 0 && reachability >= 0.8,
    floor,
    reachability,
    answerCounts,
    droppedAnswers,
    droppedQuestions: [],
  };
}

const CONCRETE_HINTS =
  /(red|pink|blue|green|black|white|nude|gold|silver|purple|orange|yellow|brown|matte|gloss|shimmer|cream|liquid|powder|stick|pencil|spf|oil|gel|serum|short|long|medium|square|round|almond|coffin|oval)/;

function looksConcrete(terms: string[]): boolean {
  return terms.some((t) => CONCRETE_HINTS.test(t));
}

/**
 * Enforce the grounding rule by mutation: drop failing answers; drop
 * questions left with < 2 answers (and their axis values / dependent
 * rules stay — the flow validator prunes those downstream). Returns the
 * cleaned config plus what was cut, for telemetry and the repair prompt.
 */
export function enforceGrounding(
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
  scopeProductIds: Set<string> | null
): { config: GeneratedQuizConfig; report: GroundingReport } {
  const report = gradeGrounding(config, catalog, scopeProductIds);
  if (report.droppedAnswers.length === 0) return { config, report };

  const failing = new Set(report.droppedAnswers.map((d) => `${d.axisKey}:${d.value}`));
  const droppedQuestions: string[] = [];
  const questions = (config.questions as any[])
    .map((q) => ({
      ...q,
      options: (q.options ?? []).filter(
        (o: any) => o.selectAll || !failing.has(`${q.axisKey}:${o.axisValueValue}`)
      ),
    }))
    .filter((q) => {
      const real = q.options.filter((o: any) => !o.selectAll).length;
      if (real >= 2) return true;
      droppedQuestions.push(q.axisKey);
      return false;
    });

  const keptAxes = new Set(questions.map((q: any) => q.axisKey));
  const cleaned: GeneratedQuizConfig = {
    ...config,
    questions,
    // Rules referencing a dropped answer/question would strand at serve
    // time — cut criteria entries for dropped values, drop rules that
    // lose all criteria.
    rules: (config.rules ?? [])
      .map((r: any) => ({
        ...r,
        criteria: (r.criteria ?? []).filter(
          (pair: any) =>
            keptAxes.has(pair?.axisKey) && !failing.has(`${pair?.axisKey}:${pair?.axisValue}`)
        ),
      }))
      .filter((r: any) => r.criteria.length > 0),
  };
  const finalReport = gradeGrounding(cleaned, catalog, scopeProductIds);
  finalReport.droppedAnswers = report.droppedAnswers;
  finalReport.droppedQuestions = droppedQuestions;
  return { config: cleaned, report: finalReport };
}
