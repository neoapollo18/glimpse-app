// LLM listwise ranking for product recommendations (migrations 050/051).
//
// Pipeline per request (filter-then-rank — the same shape Sephora's shade
// matcher and the HyST hybrid-retrieval work converge on):
//   1. Deterministic color gates: the always-on mismatch guard (drops
//      egregiously wrong colors) and the merchant-tunable color filter
//      (strictness per tuning), both CIEDE2000 against the shade swatch the
//      shopper picked. Hard constraints never reach the ranker.
//   2. One Gemini call ranks the surviving candidates against the shopper's
//      quiz answers + merchant guidance, returning structured picks with
//      short shopper-facing reasons.
//   3. Merchant priority ordering — bounded boost or pin, per tuning.
//
// The candidate list is SHUFFLED before serialization: LLM listwise rankers
// systematically under-promote items late in the input (positional bias),
// so a fixed catalog order would silently favor whatever sorts first. This
// costs us prompt-prefix cache hits on the catalog; at ~500 SKUs the
// un-cached input is a fraction of a cent per request, which is the right
// trade against a biased ranking.
//
// Failure-tolerant by design: any error returns null and callers fall back
// to the pre-existing behavior (shuffle + guard + priority).

import { geminiClient, extractGeminiText, stripJsonFences } from './gemini.server';
import type { Candidate } from './recommendation-engine.server';
import {
  ANY_VALUE,
  type MultiCriteria,
  type RecommendationFlow,
  type ChatAssistantConfig,
  type RecommendationTuning,
} from './supabase.server';
import { hexToLab, deltaE2000, type Lab } from './color-science.server';

// Text models, not the image-generation ones — same choice and reasoning as
// photo-axis-classifier: structured task on the hot path. The merchant's
// tuning picks the tier ('flash' default; 'lite' is fastest; 'pro' trades
// latency for accuracy on nuanced guidance).
const RANKER_MODELS: Record<RecommendationTuning['rankerModel'], string> = {
  lite: 'gemini-2.5-flash-lite',
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};
// 2.5 flash models spend dynamic "thinking" tokens BY DEFAULT, even on
// structured-output calls — benchmarked at ~7-11s with thinking vs
// ~1-2.5s without. Ranking a serialized catalog doesn't need reasoning
// tokens, so thinking is disabled for flash/lite. Pro cannot disable
// thinking (minimum budget 128) — that latency is what 'pro' buys.
const NO_THINKING: Record<RecommendationTuning['rankerModel'], { thinkingBudget: number } | undefined> = {
  lite: { thinkingBudget: 0 },
  flash: { thinkingBudget: 0 },
  pro: undefined,
};
// Pro cannot disable thinking, so it needs more headroom than the
// no-thinking flash tiers — a 12s cap would time out most pro calls and
// bill for results that get discarded.
const RANKER_TIMEOUT_MS: Record<RecommendationTuning['rankerModel'], number> = {
  lite: 12_000,
  flash: 12_000,
  pro: 20_000,
};
// ΔE00 gates for the merchant-tunable color pre-filter. ~10 = same color
// family; 'normal' keeps clearly-wrong colors out while tolerating
// swatch-vs-product drift; 'strict' approaches same-family-only.
const COLOR_FILTER_DELTA_E: Record<Exclude<RecommendationTuning['colorFilter'], 'off'>, number> = {
  loose: 45,
  normal: 30,
  strict: 18,
};
// The always-on egregious-mismatch gate ("picked purple, got white"). Far
// looser than any colorFilter strength on purpose — it only exists to stop
// picks that are OBVIOUSLY the wrong color, so it stays predictable even
// for shops that keep the color filter off.
const MISMATCH_GUARD_DELTA_E = 60;

type EngineTuningConfig = Pick<
  ChatAssistantConfig,
  'ai_guidance' | 'priority_product_ids' | 'recommendation_tuning'
>;

export type LlmRankResult = {
  ordered: Candidate[];
  // Shopper-facing one-liner per LLM-picked candidate (object identity
  // keyed — the same Candidate references flow back to the caller).
  reasons: Map<Candidate, string>;
};

// ---------------------------------------------------------------------
// Ordering primitives (shared with the engine's shuffle fallback)
// ---------------------------------------------------------------------

/** Fisher-Yates. Used both for the fallback ordering and to randomize the
 * prompt catalog (positional-bias mitigation). */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Diversity pass: unique products first, duplicate variants after, stable
 * within both groups — so a result list doesn't stack five shades of one
 * product before showing a second product. */
export function diversify(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const first: Candidate[] = [];
  const rest: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.product.id)) rest.push(c);
    else {
      seen.add(c.product.id);
      first.push(c);
    }
  }
  return first.concat(rest);
}

/**
 * Merchant priority ordering, style per tuning:
 * - 'boost': each priority candidate's rank improves by at most
 *   priorityBoostSlots positions, stable-sorted so non-priority order is
 *   otherwise untouched. A nudge, never a takeover.
 * - 'pin': priority candidates move to the front (stable within both
 *   groups). On the LLM path this is applied to the PICKED set only, so a
 *   pin still requires the ranker to have judged the product suitable.
 */
export function applyPriorityOrdering(
  ordered: Candidate[],
  priorityProductIds: string[] | undefined,
  tuning: Pick<RecommendationTuning, 'priorityStyle' | 'priorityBoostSlots'>,
): Candidate[] {
  if (!priorityProductIds || priorityProductIds.length === 0) return ordered;
  const priority = new Set(priorityProductIds);
  const slots = tuning.priorityStyle === 'pin' ? ordered.length : tuning.priorityBoostSlots;
  return ordered
    .map((c, i) => ({ c, i, score: i - (priority.has(c.product.id) ? slots : 0) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------
// Color gates
// ---------------------------------------------------------------------

/**
 * Swatch colors for the shade values the shopper actually picked, PHOTO
 * AXES ONLY. Question-option display_meta swatches are deliberately
 * excluded: those are card-styling decoration (a brand-pink chip on a
 * "Volume" goal button), and treating them as shade targets would let the
 * mismatch guard drop every product that doesn't match the UI theme.
 */
function targetShadeLabs(criteria: MultiCriteria, flow: RecommendationFlow): Lab[] {
  const labs: Lab[] = [];
  for (const axis of flow.photoAxisDetails) {
    const raw = criteria[axis.key];
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === ANY_VALUE) continue;
      const swatch = axis.values.find((v) => v.value === value)?.swatch;
      const lab = swatch ? hexToLab(swatch) : null;
      if (lab) labs.push(lab);
    }
  }
  return labs;
}

/**
 * One pass of color math for the whole pool: each candidate's best ΔE00
 * against the picked shade swatches. Candidates without parseable color
 * data are absent from the map (they always pass every gate — fail open).
 */
function computeColorDistances(candidates: Candidate[], targets: Lab[]): Map<Candidate, number> {
  const distances = new Map<Candidate, number>();
  if (targets.length === 0) return distances;
  for (const c of candidates) {
    const lab = hexToLab(c.variant?.display_color);
    if (!lab) continue;
    let best = Infinity;
    for (const t of targets) {
      const d = deltaE2000(lab, t);
      if (d < best) best = d;
    }
    distances.set(c, Math.round(best));
  }
  return distances;
}

/** Split a pool on a ΔE00 threshold using precomputed distances. Never
 * returns an empty pool: if the gate would drop everything, it fails open. */
function gateByDistance(
  candidates: Candidate[],
  distances: Map<Candidate, number>,
  threshold: number,
  label: string,
  logTag: string,
): { kept: Candidate[]; dropped: Candidate[] } {
  if (distances.size === 0) return { kept: candidates, dropped: [] };
  const kept: Candidate[] = [];
  const dropped: Candidate[] = [];
  for (const c of candidates) {
    const d = distances.get(c);
    if (d !== undefined && d > threshold) dropped.push(c);
    else kept.push(c);
  }
  if (kept.length === 0) {
    console.warn(`[${logTag}] ${label} would drop ALL ${candidates.length} candidates — failing open`);
    return { kept: candidates, dropped: [] };
  }
  if (dropped.length > 0) {
    console.log(`[${logTag}] ${label} dropped ${dropped.length}/${candidates.length} candidates (ΔE00 > ${threshold})`);
  }
  return { kept, dropped };
}

/**
 * Fallback-path composition for when the LLM call fails or is skipped:
 * apply the mismatch guard to the shuffled ordering (guarded candidates
 * first, egregious mismatches demoted to the very end so backfill still
 * sees the full pool), then the merchant's priority ordering.
 */
export function guardAndPrioritize(
  ordered: Candidate[],
  criteria: MultiCriteria,
  flow: RecommendationFlow,
  config: EngineTuningConfig,
  logTag: string,
): Candidate[] {
  const tuning = config.recommendation_tuning;
  let pool = ordered;
  let demoted: Candidate[] = [];
  if (tuning.mismatchGuard) {
    const distances = computeColorDistances(ordered, targetShadeLabs(criteria, flow));
    const { kept, dropped } = gateByDistance(ordered, distances, MISMATCH_GUARD_DELTA_E, 'mismatch guard', logTag);
    pool = kept;
    demoted = dropped;
  }
  return applyPriorityOrdering(pool, config.priority_product_ids, tuning).concat(demoted);
}

// ---------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------

/**
 * Human-readable quiz transcript for the prompt. Question axes render as
 * "prompt → chosen option labels"; photo axes as detected traits. Axes the
 * flow doesn't know about (stale criteria keys) are skipped.
 */
function describeAnswers(criteria: MultiCriteria, flow: RecommendationFlow): string {
  const lines: string[] = [];
  const answered = (key: string) => {
    const v = criteria[key];
    if (v === undefined) return null;
    return Array.isArray(v) ? v : [v];
  };

  // Only DB-authored option/value LABELS ever reach the prompt. Criteria
  // values that match no configured option are DROPPED, not echoed — the
  // criteria field is shopper-controlled on a public endpoint, and echoing
  // unmatched values verbatim would hand anyone a prompt-injection slot
  // (a snake_case identifier is still an instruction after tokenization).
  for (const q of flow.questions) {
    const rawValues = answered(q.axisKey);
    if (!rawValues) continue;
    // Multi-select can pair ANY_VALUE with concrete picks ("surprise me" +
    // "red"). The concrete picks are real signal — only read the answer as
    // "open to anything" when ANY_VALUE was the ONLY selection.
    const values = rawValues.filter((v) => v !== ANY_VALUE);
    if (values.length === 0 && rawValues.includes(ANY_VALUE)) {
      lines.push(`${q.prompt} → open to anything`);
      continue;
    }
    const labels = values
      .map((v) => q.options.find((o) => o.axisValue === v)?.label)
      .filter((l): l is string => Boolean(l))
      .join(', ');
    if (labels) lines.push(`${q.prompt} → ${labels}`);
  }
  for (const axis of flow.photoAxisDetails) {
    const rawValues = answered(axis.key);
    if (!rawValues) continue;
    // Same ANY_VALUE-alongside-concrete rule as questions: drop the
    // wildcard, keep the concrete shades; skip only if nothing remains.
    const values = rawValues.filter((v) => v !== ANY_VALUE);
    if (values.length === 0) continue;
    const labels = values
      .map((v) => axis.values.find((av) => av.value === v)?.label)
      .filter((l): l is string => Boolean(l))
      .join(', ');
    if (labels) lines.push(`${axis.label} (detected/chosen): ${labels}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// The ranker
// ---------------------------------------------------------------------

/**
 * Rank the candidate pool with one Gemini structured-output call.
 *
 * Returns the FULL pool reordered (LLM picks first, diversified shuffle as
 * the tail so downstream backfill keeps working, gate-dropped candidates
 * dead last), plus per-pick reasons. Returns null on any failure — callers
 * keep their existing ordering.
 */
export async function llmOrderCandidates(params: {
  candidates: Candidate[];
  criteria: MultiCriteria;
  flow: RecommendationFlow;
  config: EngineTuningConfig;
  desiredCount: number;
  shopDomain: string;
  logTag: string;
}): Promise<LlmRankResult | null> {
  const { criteria, flow, config, desiredCount, shopDomain, logTag } = params;
  const tuning = config.recommendation_tuning;
  try {
    const answers = describeAnswers(criteria, flow);
    if (!answers) return null; // nothing to rank against — shuffle is honest

    // Deterministic gates before the ranker (filter-then-rank): one color
    // computation, two thresholds. The loose always-on mismatch guard
    // first, then the merchant's opt-in color filter at their chosen
    // strictness. Both fail open.
    const allDistances = computeColorDistances(params.candidates, targetShadeLabs(criteria, flow));
    let pool = params.candidates;
    if (tuning.mismatchGuard) {
      pool = gateByDistance(pool, allDistances, MISMATCH_GUARD_DELTA_E, 'mismatch guard', logTag).kept;
    }
    if (tuning.colorFilter !== 'off') {
      pool = gateByDistance(
        pool, allDistances, COLOR_FILTER_DELTA_E[tuning.colorFilter],
        `color filter (${tuning.colorFilter})`, logTag,
      ).kept;
    }

    const prioritySet = new Set(config.priority_product_ids);

    // Shuffle BEFORE serialization (positional-bias mitigation), then cap
    // the prompt size keeping priority candidates unconditionally.
    let shuffled = shuffle(pool);
    if (shuffled.length > tuning.maxLlmCandidates) {
      const priority = shuffled.filter((c) => prioritySet.has(c.product.id));
      const others = shuffled.filter((c) => !prioritySet.has(c.product.id));
      const kept = priority.slice(0, tuning.maxLlmCandidates);
      shuffled = kept.concat(others.slice(0, tuning.maxLlmCandidates - kept.length));
      console.warn(
        `[${logTag}] candidate pool ${pool.length} exceeds prompt cap — ranking ${shuffled.length}, rest backfills unranked`,
      );
    }

    const catalog = shuffled.map((c, i) => {
      const entry: Record<string, unknown> = { id: i, product: c.product.product_name };
      if (c.variant?.variant_title) entry.shade = c.variant.variant_title;
      if (c.variant?.tagline) entry.notes = c.variant.tagline;
      if (c.variant?.display_color) entry.color = c.variant.display_color;
      const d = allDistances.get(c);
      if (d !== undefined) entry.colorDistanceFromPick = d;
      if (prioritySet.has(c.product.id)) entry.merchantPriority = true;
      return entry;
    });

    const topK = Math.min(shuffled.length, Math.max(desiredCount * 3, 10));

    const guidance = (config.ai_guidance || '').trim();
    const systemPrompt =
      'You rank product recommendations for a beauty/cosmetics store quiz. ' +
      'You get the shopper\'s quiz answers and a JSON array of candidate products. ' +
      `Choose and rank the ${topK} best candidates for this shopper, best first.\n` +
      'Rules:\n' +
      '- Judge ONLY from the candidate data given; never invent product facts.\n' +
      '- When colorDistanceFromPick is present, lower means perceptually closer to the shade the shopper picked — strongly prefer closer.\n' +
      '- merchantPriority items are ones the store wants surfaced: prefer them over EQUALLY suitable alternatives, but never rank a poorly-matching priority item above a clearly better match.\n' +
      '- Avoid recommending multiple near-identical variants of the same product in the top picks unless the shopper\'s answers call for it.\n' +
      '- Each pick needs a short reason (max 140 characters) written TO the shopper, grounded in their answers. Warm and specific, no hype, no invented claims.\n' +
      (guidance ? `Store guidance from the merchant (follow unless it conflicts with the rules above):\n${guidance}\n` : '');

    const responseSchema = {
      type: 'object',
      properties: {
        picks: {
          type: 'array',
          // Officially supported array bound — keeps the decode short and
          // stops runaway outputs that would eat the timeout.
          minItems: 1,
          maxItems: topK,
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: 'Candidate id from the catalog' },
              reason: { type: 'string', description: 'Shopper-facing reason, max 140 chars' },
            },
            required: ['id', 'reason'],
          },
        },
      },
      required: ['picks'],
    };

    // Abort the underlying HTTP request when the timeout fires — a bare
    // Promise.race would keep the Gemini call running (and billing) to
    // completion after its result was already discarded.
    const timeoutMs = RANKER_TIMEOUT_MS[tuning.rankerModel];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const responsePromise = geminiClient().models.generateContent({
      model: RANKER_MODELS[tuning.rankerModel],
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Shopper's answers:\n${answers}\n\n` +
                `Candidates:\n${JSON.stringify(catalog)}\n\n` +
                `Return the top ${topK} ranked best-first.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: responseSchema as unknown as Record<string, unknown>,
        temperature: 0,
        abortSignal: ctrl.signal,
        ...(NO_THINKING[tuning.rankerModel]
          ? { thinkingConfig: NO_THINKING[tuning.rankerModel] }
          : {}),
      },
    });
    // Capture the race timer's handle so it can be cleared on the success
    // path too — otherwise every request leaks a pending 12-20s timer.
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      raceTimer = setTimeout(() => reject(new Error(`LLM ranking timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    let raw: string;
    try {
      raw = extractGeminiText(await Promise.race([responsePromise, timeoutPromise]));
    } finally {
      clearTimeout(timer);
      clearTimeout(raceTimer);
    }
    const parsed = JSON.parse(stripJsonFences(raw)) as { picks?: Array<{ id?: unknown; reason?: unknown }> };
    if (!Array.isArray(parsed.picks)) return null;

    // Schema enforcement is best-effort — re-validate ids against the pool
    // so a hallucinated id can't crash or smuggle in an out-of-scope pick.
    const reasons = new Map<Candidate, string>();
    const picked: Candidate[] = [];
    const seenIds = new Set<number>();
    for (const p of parsed.picks) {
      const id = typeof p.id === 'number' && Number.isInteger(p.id) ? p.id : -1;
      if (id < 0 || id >= shuffled.length || seenIds.has(id)) continue;
      seenIds.add(id);
      const candidate = shuffled[id];
      picked.push(candidate);
      if (tuning.llmReasons && typeof p.reason === 'string' && p.reason.trim()) {
        reasons.set(candidate, p.reason.trim().slice(0, 200));
      }
    }
    if (picked.length === 0) {
      console.warn(`[${logTag}] LLM ranking returned no valid picks for ${shopDomain} — falling back`);
      return null;
    }

    const pickedSet = new Set(picked);
    const unpicked = shuffled.filter((c) => !pickedSet.has(c));
    const tail = tuning.productDiversity ? diversify(unpicked) : unpicked;
    // Candidates dropped by the gates or the prompt cap are appended dead
    // last: downstream code expects the FULL pool (backfill, dedupe by
    // target). picked ∪ tail = shuffled, so "sent to the LLM" is the set to
    // subtract from.
    const sent = new Set(shuffled);
    const excluded = params.candidates.filter((c) => !sent.has(c));

    const ordered = applyPriorityOrdering(picked, config.priority_product_ids, tuning).concat(tail, excluded);
    console.log(
      `[${logTag}] LLM ranked ${picked.length}/${shuffled.length} candidates for ${shopDomain}`,
    );
    return { ordered, reasons };
  } catch (err) {
    console.error(`[${logTag}] LLM ranking failed for ${shopDomain}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
