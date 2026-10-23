// Columnar recommendation engine, server side (Glamnetic recommendation
// logic v3, v6.1 tiers). The pure pipeline (pipeline.ts) does the
// matching; this module owns the I/O around it:
//   - the pool: the shop's spec.pool.handles read from the synced products
//     table, derived once and cached per shop for a few minutes
//   - stock: sold-out sets dropped through the shared availability probe
//   - Step D: one ranker call over the Step C candidates, 4 s budget; it
//     only orders sets inside a tier, and describeSet stands in for any
//     reason that fails the copy rules
//   - a 24 h result cache keyed by shop + resultKey (the permalink)
//   - pool sync from the Shopify collection (Studio only; the storefront
//     path never calls Shopify for the pool)
//
// Only shops whose spec has enabled:true ever reach the request path.

import {
  supabase,
  getRecommendationFlow,
  getVariantsForProducts,
  type ChatAssistantConfig,
  type MultiCriteria,
  type RecommendationFlow,
} from "../supabase.server";
import {
  fetchAvailability,
  extractNumericId,
  type EngineProduct,
  type EngineVariant,
} from "../recommendation-engine.server";
import { RANKER_MODELS, NO_THINKING } from "../llm-recommender.server";
import { geminiClient, extractGeminiText, stripJsonFences } from "../gemini.server";
import { checkRateLimit, checkRateLimits, RATE_LIMITS } from "../rate-limiter.server";
import { invalidateStorefrontCache } from "../storefront-cache.server";
import { withShopSaveLock } from "../shop-save-lock.server";
import { claimableVibes, deriveProduct, splitPool, type DerivedProduct, type PoolProductInput } from "./attributes";
import {
  answersToCriteria,
  assembleColumnar,
  buildBranching,
  criteriaToAnswers,
  decodeResultKey,
  encodeResultKey,
  labelsFromFlow,
  rankerCandidates,
  runLadder,
  selectResults,
  TIER_LABELS,
  type AnswerLabels,
  type AssembledItem,
  type BranchingBlock,
  type ColumnarAnswers,
  type HeaderCopy,
  type Rung,
  type TierId,
} from "./pipeline";
import {
  DEFAULT_ANSWER_LABELS,
  HANDLE_RE,
  VIBE_IDS,
  axisForRole,
  enabledColumnarSpec,
  sanitizeColumnarSpec,
  vibeEnabled,
  type ColumnarRole,
  type ColumnarSpec,
} from "./spec";

const POOL_TTL_MS = 5 * 60_000;
const RESULT_TTL_MS = 24 * 60 * 60_000;
// A Step C fallback that stood in for the ranker (timeout or rate limit):
// short-lived, so an ad burst doesn't pin the fallback order all day.
const FALLBACK_TTL_MS = 10 * 60_000;
const MAX_RESULT_ENTRIES = 5_000;
const POOL_REFRESH_AFTER_MS = 60 * 60_000;
const IN_CHUNK = 100;

// Pure, in spec.ts, so the storefront route can ask without the engine.
export { enabledColumnarSpec };

// ---------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------

type PoolVariant = { shopifyVariantId: string; title: string | null };

export interface PoolSnapshot {
  key: string;
  at: number;
  /** Every handle found in the catalog, derived. */
  derived: DerivedProduct[];
  eligible: DerivedProduct[];
  excluded: Array<{ handle: string; title: string; reasons: string[] }>;
  /** spec.pool.handles with no products row (catalog not synced yet). */
  notInCatalog: string[];
  variants: Map<string, PoolVariant[]>;
  /** Content hash of the eligible pool: result-cache entries computed on a
   * different pool are stale. */
  hash: string;
}

const poolCache = new Map<string, { snapshot: Promise<PoolSnapshot>; at: number; key: string }>();

/** FNV-1a, hex. Fingerprints only, never security. */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const poolKey = (spec: ColumnarSpec) =>
  hashOf(JSON.stringify([spec.pool.handles, spec.holidayCollections, spec.vibeLabels ?? {}]));

async function loadPool(shopId: string, spec: ColumnarSpec): Promise<PoolSnapshot> {
  const handles = spec.pool.handles.filter((h) => HANDLE_RE.test(h));
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < handles.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("products")
      .select("id, shopify_id, handle, product_name, status, product_type, tags, price, image_url")
      .eq("shop_id", shopId)
      .in("handle", handles.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`columnar pool read failed: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  // A handle can have an old soft-deleted row next to the live one: keep
  // the live row.
  const byHandle = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const h = String(r.handle ?? "");
    const prev = byHandle.get(h);
    const live = (x: Record<string, unknown> | undefined) => x && (x.status == null || x.status === "active");
    if (!prev || (!live(prev) && live(r))) byHandle.set(h, r);
  }
  const inputs: PoolProductInput[] = [];
  for (const h of handles) {
    const r = byHandle.get(h);
    if (!r) continue;
    inputs.push({
      id: String(r.id),
      shopifyId: String(r.shopify_id ?? ""),
      handle: h,
      title: String(r.product_name ?? h),
      productType: typeof r.product_type === "string" ? r.product_type : null,
      status: typeof r.status === "string" ? r.status : null,
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
      price: typeof r.price === "number" ? r.price : r.price != null && Number.isFinite(Number(r.price)) ? Number(r.price) : null,
      imageUrl: typeof r.image_url === "string" ? r.image_url : null,
    });
  }
  const derived = inputs.map((p) =>
    deriveProduct(p, { holidayCollections: spec.holidayCollections, vibeLabels: spec.vibeLabels ?? {} }),
  );
  const { eligible, excluded } = splitPool(derived);

  const variants = new Map<string, PoolVariant[]>();
  const ids = eligible.map((p) => p.id);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("product_variants")
      .select("product_id, shopify_variant_id, variant_title, status")
      .in("product_id", ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`columnar variant read failed: ${error.message}`);
    for (const v of (data ?? []) as Array<Record<string, unknown>>) {
      if (v.status === "deleted" || typeof v.shopify_variant_id !== "string") continue;
      const list = variants.get(String(v.product_id)) ?? [];
      list.push({
        shopifyVariantId: v.shopify_variant_id,
        title: typeof v.variant_title === "string" ? v.variant_title : null,
      });
      variants.set(String(v.product_id), list);
    }
  }

  const notInCatalog = handles.filter((h) => !byHandle.has(h));
  if (excluded.length || notInCatalog.length) {
    // The sync-time validation log the brief asks for (Lisa's tagging list).
    console.log(
      `[columnar] pool for ${shopId}: ${eligible.length} eligible, ${excluded.length} excluded ` +
        `(${excluded.map((e) => `${e.handle}: ${e.reasons.join("/")}`).join("; ")})` +
        (notInCatalog.length ? `, ${notInCatalog.length} handles not in the catalog` : ""),
    );
  }
  return {
    key: poolKey(spec),
    at: Date.now(),
    derived,
    eligible,
    excluded,
    notInCatalog,
    variants,
    hash: hashOf(
      JSON.stringify(
        eligible.map((p) => [p.id, p.length, p.shape, p.finish, p.colors, p.drama, p.collections, p.isFrench, p.isOmbre, p.vibes, p.vibeSource]),
      ),
    ),
  };
}

/** The shop's derived pool, cached for a few minutes (and dropped on any
 * spec write). Concurrent requests share one load. */
export function getPoolSnapshot(shopId: string, spec: ColumnarSpec): Promise<PoolSnapshot> {
  const key = poolKey(spec);
  const hit = poolCache.get(shopId);
  if (hit && hit.key === key && Date.now() - hit.at < POOL_TTL_MS) return hit.snapshot;
  const snapshot = loadPool(shopId, spec);
  poolCache.set(shopId, { snapshot, at: Date.now(), key });
  // A failed load must not be served for the whole TTL.
  snapshot.catch(() => {
    if (poolCache.get(shopId)?.snapshot === snapshot) poolCache.delete(shopId);
  });
  return snapshot;
}

/**
 * The product row (and its variant row) behind a served match, for
 * quiz-tryon. The engine recommends from this pool, not the shop's
 * product_scope selection, so a card's "See on me" resolves here: a
 * product outside this shop's eligible pool doesn't resolve (null).
 */
export async function poolTryonCandidate(
  shopId: string,
  spec: ColumnarSpec,
  productId: string,
  variantId: string | null,
): Promise<{ product: EngineProduct; variant: EngineVariant | null } | null> {
  const snap = await getPoolSnapshot(shopId, spec);
  const hit = snap.eligible.find((p) => p.shopifyId === productId);
  if (!hit) return null;
  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", hit.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error || !product) return null;
  if (product.status != null && product.status !== "active") return null;
  if (!variantId) return { product: product as EngineProduct, variant: null };
  const variants = (await getVariantsForProducts([hit.id])) as Array<EngineVariant & { status?: string | null }>;
  const variant = variants.find((v) => v.status !== "deleted" && v.shopify_variant_id === variantId);
  return variant ? { product: product as EngineProduct, variant } : null;
}

export function invalidateColumnarCaches(shopId: string, opts: { keepResults?: boolean } = {}): void {
  poolCache.delete(shopId);
  if (opts.keepResults) return;
  for (const k of resultCache.keys()) if (k.startsWith(`${shopId}|`)) resultCache.delete(k);
}

// ---------------------------------------------------------------------
// Flow decoration (recommendation-config + Studio preview, contract 2)
// ---------------------------------------------------------------------

/**
 * The flow a columnar shop serves: retired vibe tiles removed from the vibe
 * question, plus the branching block (one row per eligible product, with
 * the v4 full-match block built from these questions). Shops
 * without an enabled spec get the flow back untouched. Fails open: a pool
 * read error serves the flow without branching rather than no quiz.
 */
export async function decorateFlowForColumnar<F extends { questions: Array<{ axisKey: string; options: Array<{ axisValue: string; selectAll?: boolean }> }> }>(
  shopId: string,
  flow: F,
  config: { recommendation_tuning?: unknown } | null | undefined,
): Promise<F & { branching?: BranchingBlock }> {
  const spec = enabledColumnarSpec(config);
  if (!spec) return flow;
  const vibeKey = axisForRole(spec, "vibe");
  const questions = flow.questions.map((q) => {
    if (q.axisKey !== vibeKey) return q;
    const values = spec.axes[q.axisKey].values;
    return {
      ...q,
      options: q.options.filter(
        (o) => o.selectAll || !Object.prototype.hasOwnProperty.call(values, o.axisValue) || vibeEnabled(spec, values[o.axisValue]),
      ),
    };
  });
  try {
    const pool = await getPoolSnapshot(shopId, spec);
    const branching = buildBranching(spec, pool.eligible, questions);
    // No rows would hide every length, shape and finish option (contract
    // 3): serve the questions unfiltered instead.
    if (branching.pool.rows.length === 0) return { ...flow, questions };
    return { ...flow, questions, branching };
  } catch (e) {
    console.error("[columnar] branching unavailable:", e instanceof Error ? e.message : e);
    return { ...flow, questions };
  }
}

// ---------------------------------------------------------------------
// Request path (contract 4)
// ---------------------------------------------------------------------

export type ColumnarMeta = { length: string; shape: string; finish: string };

export type ColumnarMatch = {
  productId: string;
  variantId: string | null;
  variantNumericId: string | number | null;
  productHandle: string;
  productName: string;
  variantTitle: string | null;
  title: string;
  tagline: string | null;
  whyFits: string | null;
  rank: number;
  quantity: number;
  reasons: string[];
  meta: ColumnarMeta;
  /** v6.1: what the set steps outside of ("perfect" = nothing). The widget
   * labels the card with it; widgets before v6.1 ignore it. */
  tier: TierId;
};

export interface ColumnarResponse {
  rung: Rung;
  exactCount: number;
  header: HeaderCopy;
  bestMatchBadge: boolean;
  alsoMatched: ColumnarMatch[];
  resultKey: string;
  loosen: { axisKey: string; label: string } | null;
  answers: Record<string, string[]>;
}

export interface ColumnarResult {
  matches: ColumnarMatch[];
  matrixApplied: false;
  partial: false;
  columnar: ColumnarResponse;
  error?: string;
}

const resultCache = new Map<string, { at: number; ttl: number; fingerprint: string; value: ColumnarResult }>();

function cacheGet(key: string, fingerprint: string): ColumnarResult | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl || hit.fingerprint !== fingerprint) {
    resultCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, fingerprint: string, value: ColumnarResult, ttl = RESULT_TTL_MS): void {
  resultCache.delete(key);
  resultCache.set(key, { at: Date.now(), ttl, fingerprint, value });
  // Map order is insertion order: drop the oldest past the cap.
  while (resultCache.size > MAX_RESULT_ENTRIES) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

/** Everything that changes a result: the spec (not the threshold, which
 * only drives branching), the answer labels the copy echoes, the ranker
 * settings and the merchant's "why this fits" lines. */
const resultFingerprint = (
  spec: ColumnarSpec,
  labels: AnswerLabels,
  chatConfig: Pick<ChatAssistantConfig, "recommendation_tuning" | "quiz_product_why">,
) =>
  hashOf(
    JSON.stringify([
      spec.axes,
      spec.vibes,
      spec.weights,
      spec.candidateCount,
      spec.resultCount,
      spec.alsoMatchedCount,
      spec.llm,
      labels,
      chatConfig.recommendation_tuning?.rankerModel ?? null,
      chatConfig.recommendation_tuning?.llmReasons ?? null,
      chatConfig.quiz_product_why ?? null,
    ]),
  );

/** Sold-out sets in the window the shopper can see: the Step C candidates
 * plus the Also matched backfill. Fail open on probe errors. */
async function probeUnavailable(
  shopDomain: string,
  pool: PoolSnapshot,
  window: DerivedProduct[],
  probed: Map<string, boolean>,
): Promise<{ unavailable: Set<string> } | null> {
  const gidsByProduct = new Map<string, string[]>();
  for (const p of window) {
    const vs = pool.variants.get(p.id) ?? [];
    gidsByProduct.set(p.id, vs.length ? vs.map((v) => v.shopifyVariantId) : p.shopifyId ? [p.shopifyId] : []);
  }
  const missing = [...new Set([...gidsByProduct.values()].flat())].filter((g) => !probed.has(g));
  if (missing.length) {
    const avail = await fetchAvailability(shopDomain, missing, "quiz-recommend");
    if (avail === null) return null;
    for (const g of missing) probed.set(g, avail.get(g) !== false);
  }
  const unavailable = new Set<string>();
  for (const [productId, gids] of gidsByProduct) {
    // Sold out = every variant unavailable (one product = one pick).
    if (gids.length && gids.every((g) => probed.get(g) === false)) unavailable.add(productId);
  }
  return { unavailable };
}

/** The shopper's answers in words, for the ranker prompt. Only labels
 * the merchant or the brief authored ever reach it. */
function describeAnswers(answers: ColumnarAnswers, labels: AnswerLabels): string {
  const names: Record<ColumnarRole, string> = {
    vibe: "Vibe",
    length: "Length",
    shape: "Shape",
    color: "Colors",
    finish: "Finish",
    drama: "Drama",
  };
  const lines: string[] = [];
  for (const role of Object.keys(names) as ColumnarRole[]) {
    const a = answers[role];
    if (!a) continue;
    const text =
      a === "surprise" ? "open to anything" : a.map((id) => labels[id] ?? DEFAULT_ANSWER_LABELS[id] ?? id).join(", ");
    lines.push(`${names[role]}: ${text}`);
  }
  return lines.join("\n");
}

/**
 * Step D: one structured call ranks the Step C candidates and writes a
 * reason per pick. Returns null on timeout, error, or any pick outside the
 * set / short of n: the caller then serves Step C's order (brief 10.10).
 * The candidates carry their tier; selectResults only lets the picks order
 * sets inside a tier, whatever the model returns.
 */
async function rankWithLlm(params: {
  candidates: DerivedProduct[];
  tiers: Map<string, number>;
  tierIds: Map<string, TierId>;
  n: number;
  answers: ColumnarAnswers;
  labels: AnswerLabels;
  model: keyof typeof RANKER_MODELS;
  timeoutMs: number;
  shopDomain: string;
}): Promise<{ ids: string[]; reasons: Record<string, string> } | null> {
  const { candidates, tiers, tierIds, n, answers, labels, model, timeoutMs, shopDomain } = params;
  const label = (id: string) => labels[id] ?? DEFAULT_ANSWER_LABELS[id] ?? id;
  // Dense tier numbers (1 = closest) over what the candidates span.
  const keys = [...new Set(candidates.map((p) => tiers.get(p.id) ?? 99))].sort((a, b) => a - b);
  const catalog = candidates.map((p, i) => ({
    id: i,
    tier: keys.indexOf(tiers.get(p.id) ?? 99) + 1,
    differs: tierIds.get(p.id) === "perfect" ? null : TIER_LABELS[tierIds.get(p.id) ?? "color_finish"],
    title: p.title,
    length: p.length ? label(p.length) : null,
    shape: p.shape && p.shape !== "super_short" ? label(p.shape) : null,
    finish: p.finishLabel,
    color_family: p.colors.map(label),
    design: p.design,
    drama: p.drama.map(label),
    // Only vibes a reason may name (approved labels, French tip / ombre).
    vibes: claimableVibes(p).map(label),
    is_3d: p.is3d,
    price: p.price,
  }));
  const system =
    "You rank press-on nail sets for a shopper who just finished a style quiz. " +
    "Every candidate already has the length and shape the shopper chose. " +
    "tier says how closely it fits the rest of their answers: 1 is the closest, and differs names what a candidate steps outside of (vibe, drama, color or finish). " +
    `Pick exactly ${n} candidates, best first, and give each a reason.\n` +
    "Rules:\n" +
    "- Use only ids from the candidate list, each at most once.\n" +
    "- Keep tier order: never put a candidate above one with a lower tier, and pick every lower-tier candidate before any higher-tier one.\n" +
    "- Within a tier, prefer the best variety: avoid near-identical colorways.\n" +
    "- A reason is one natural sentence of at most 14 words describing the set itself: its finish, colors and design. Never echo the shopper's answers back (no \"as you asked\", \"you picked\", \"like you wanted\").\n" +
    "- Mention only attributes listed on that candidate: a vibe only if it is in its vibes, a drama level only if it is in its drama, a color only if it is in its color_family. Never say closest, similar or almost.";
  const schema = {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: n,
        maxItems: n,
        items: {
          type: "object",
          properties: { id: { type: "integer" }, reason: { type: "string" } },
          required: ["id", "reason"],
        },
      },
    },
    required: ["picks"],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = geminiClient().models.generateContent({
      model: RANKER_MODELS[model],
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Shopper's answers:\n${describeAnswers(answers, labels)}\n\nCandidates:\n${JSON.stringify(catalog)}\n\nReturn exactly ${n} picks.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema as unknown as Record<string, unknown>,
        temperature: 0,
        abortSignal: ctrl.signal,
        ...(NO_THINKING[model] ? { thinkingConfig: NO_THINKING[model] } : {}),
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      raceTimer = setTimeout(() => reject(new Error(`columnar ranking timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const raw = extractGeminiText(await Promise.race([call, timeout]));
    const parsed = JSON.parse(stripJsonFences(raw)) as { picks?: Array<{ id?: unknown; reason?: unknown }> };
    const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
    const ids: string[] = [];
    const reasons: Record<string, string> = {};
    for (const p of picks) {
      const i = typeof p.id === "number" && Number.isInteger(p.id) ? p.id : -1;
      // Any id outside the set (or a repeat) voids the whole ranking.
      if (i < 0 || i >= candidates.length || ids.includes(candidates[i].id)) return null;
      ids.push(candidates[i].id);
      if (typeof p.reason === "string") reasons[candidates[i].id] = p.reason.trim().slice(0, 200);
    }
    if (ids.length !== n) return null;
    return { ids, reasons };
  } catch (err) {
    console.warn(`[columnar] ranking fell back for ${shopDomain}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
    clearTimeout(raceTimer);
  }
}

const LOOSEN_LABELS: Record<"finish" | "shape" | "color", string> = {
  finish: "Try any finish",
  shape: "Try any shape",
  color: "Try any color",
};

function toMatch(
  item: AssembledItem,
  index: number,
  pool: PoolSnapshot,
  whyFits: Record<string, string>,
): ColumnarMatch {
  const p = item.product;
  const variants = pool.variants.get(p.id) ?? [];
  // One product = one pick. Single-variant sets carry their variant so Add
  // to bag works; a sized set opens the product instead.
  const variant = variants.length === 1 ? variants[0] : null;
  const variantTitle = variant?.title && !/^default title$/i.test(variant.title) ? variant.title : null;
  return {
    productId: p.shopifyId,
    variantId: variant?.shopifyVariantId ?? null,
    variantNumericId: extractNumericId(variant?.shopifyVariantId),
    productHandle: p.handle,
    productName: p.title,
    variantTitle,
    title: variantTitle ? `${p.title} · ${variantTitle}` : p.title,
    tagline: null,
    whyFits: whyFits[p.id] ?? null,
    rank: index + 1,
    quantity: 1,
    reasons: [item.reason],
    meta: item.meta,
    tier: item.tier,
  };
}

/**
 * The columnar answer to a quiz-recommend request (contract 4). criteria
 * wins when present; a resultKey-only request re-serves the cached result
 * for that key, or recomputes it from the answers the key encodes.
 */
export async function computeColumnarRecommendations(params: {
  verifiedShop: { id: string };
  verifiedDomain: string;
  chatConfig: Pick<ChatAssistantConfig, "recommendation_tuning" | "quiz_product_why">;
  spec: ColumnarSpec;
  criteria: MultiCriteria;
  resultKey?: string | null;
  clientIP: string;
  /** A signed merchant store preview (verified by the route, which also
   * charged its own preview cap): the shopper LLM limiters don't apply. */
  storePreview?: boolean;
}): Promise<ColumnarResult> {
  const { verifiedShop, verifiedDomain, chatConfig, criteria, clientIP } = params;
  // The "Also matched" row is retired (2026-10-21): the field stays in the
  // response, always empty, so every widget version renders nothing, and
  // sets nobody sees are no longer probed for stock.
  const spec: ColumnarSpec = { ...params.spec, alsoMatchedCount: 0 };
  const keyOnly = Object.keys(criteria).length === 0 && Boolean(params.resultKey);
  const decoded = keyOnly ? decodeResultKey(params.resultKey) : null;
  if (keyOnly && !decoded) {
    // A mangled or foreign permalink: an error (not an answer-less result
    // over the whole pool) so the widget restarts the quiz.
    return emptyResult(spec, {}, "", "Unknown results link");
  }
  const answers = decoded ?? criteriaToAnswers(criteria, spec);
  const resultKey = encodeResultKey(answers);

  let pool: PoolSnapshot;
  let labels: AnswerLabels = {};
  try {
    const [p, flow] = await Promise.all([
      getPoolSnapshot(verifiedShop.id, spec),
      // Brief labels are the fallback copy when the flow can't be read.
      getRecommendationFlow(verifiedShop.id).catch((): RecommendationFlow | null => null),
    ]);
    pool = p;
    if (flow) labels = labelsFromFlow(spec, flow.questions);
  } catch (e) {
    console.error("[columnar] pool load failed:", e instanceof Error ? e.message : e);
    return emptyResult(spec, answers, resultKey, "No products available for recommendations");
  }

  const cacheKey = `${verifiedShop.id}|${resultKey}`;
  const fingerprint = `${resultFingerprint(spec, labels, chatConfig)}|${pool.hash}`;
  const cached = cacheGet(cacheKey, fingerprint);
  if (cached) {
    // A set that sold out since must not ride the cache for a day: re-probe
    // what this result shows (the probe has its own short cache) and
    // recompute if any of it is gone. A failed probe serves the cache.
    const byHandle = new Map(pool.eligible.map((p) => [p.handle, p]));
    const shown = [...cached.matches, ...cached.columnar.alsoMatched]
      .map((m) => byHandle.get(m.productHandle))
      .filter((p): p is DerivedProduct => Boolean(p));
    const probe = await probeUnavailable(verifiedDomain, pool, shown, new Map());
    if (!probe || probe.unavailable.size === 0) return cached;
  }

  // Steps A-C, then drop sold-out sets from what the shopper would see and
  // re-run (the ladder must count only purchasable sets). Later rounds
  // probe the sets that slide into the window after a removal.
  const probed = new Map<string, boolean>();
  let eligible = pool.eligible;
  let ladder = runLadder(eligible, answers, spec);
  for (let round = 0; round < 3; round++) {
    // The ranker's candidates plus the Step C six (a Super Short pick can
    // come from past the candidates).
    const window = [
      ...new Set([...rankerCandidates(ladder, spec, answers), ...selectResults(ladder, spec, null, answers).results]),
    ];
    const probe = await probeUnavailable(verifiedDomain, pool, window, probed);
    if (!probe || probe.unavailable.size === 0) break;
    eligible = eligible.filter((p) => !probe.unavailable.has(p.id));
    ladder = runLadder(eligible, answers, spec);
  }

  // Step D under the same limiter as the classic ranker: over it, the
  // shopper still gets Step C's order with templated reasons. A verified
  // store preview skips it (the route charged the preview cap), so a QA
  // run tests the ranker, not the fallback.
  const candidates = rankerCandidates(ladder, spec, answers);
  const n = Math.min(spec.resultCount, candidates.length);
  const tuning = chatConfig.recommendation_tuning;
  let ranked: { ids: string[]; reasons: Record<string, string> } | null = null;
  const wantsRanker = spec.llm.enabled && n >= 2 && Boolean(process.env.GEMINI_API_KEY);
  if (wantsRanker) {
    // The shop windows are only charged when the IP window allows it.
    const allowed =
      params.storePreview === true ||
      (checkRateLimit(`quiz-recommend:llm:${clientIP}:minute`, 6, 60_000).allowed &&
        checkRateLimits([
          {
            key: `quiz-recommend:llm-shop:${verifiedShop.id}:minute`,
            limit: RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_MINUTE.limit,
            windowMs: RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_MINUTE.windowMs,
          },
          {
            key: `quiz-recommend:llm-shop:${verifiedShop.id}:day`,
            limit: RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_DAY.limit,
            windowMs: RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_DAY.windowMs,
          },
        ]).allowed);
    if (allowed) {
      ranked = await rankWithLlm({
        candidates,
        tiers: ladder.tiers,
        tierIds: ladder.tierIds,
        n,
        answers,
        labels,
        model: tuning?.rankerModel ?? "flash",
        timeoutMs: spec.llm.timeoutMs,
        shopDomain: verifiedDomain,
      });
      // "Show why we picked this" off: keep the ranking, template the copy.
      if (ranked && tuning?.llmReasons === false) ranked = { ids: ranked.ids, reasons: {} };
    }
  }

  const out = assembleColumnar(ladder, answers, spec, labels, ranked);
  const whyFits = chatConfig.quiz_product_why ?? {};
  const loosenAxis = out.loosen ? axisForRole(spec, out.loosen) : null;
  const result: ColumnarResult = {
    matches: out.results.map((item, i) => toMatch(item, i, pool, whyFits)),
    matrixApplied: false,
    partial: false,
    columnar: {
      rung: out.rung,
      exactCount: out.exactCount,
      header: out.header,
      bestMatchBadge: out.bestMatchBadge,
      alsoMatched: out.alsoMatched.map((item, i) => toMatch(item, i, pool, whyFits)),
      resultKey,
      loosen: out.loosen && loosenAxis ? { axisKey: loosenAxis, label: LOOSEN_LABELS[out.loosen] } : null,
      answers: answersToCriteria(answers, spec),
    },
  };
  console.log(
    `[columnar] ${verifiedDomain} ${resultKey}: rung ${out.rung}, exact ${out.exactCount}, shown ${result.matches.length} (${out.results.map((i) => i.tier).join(",")}), ${out.ranked ? "ranked" : "step C order"}`,
  );
  cacheSet(cacheKey, fingerprint, result, wantsRanker && !ranked ? FALLBACK_TTL_MS : RESULT_TTL_MS);
  return result;
}

function emptyResult(spec: ColumnarSpec, answers: ColumnarAnswers, resultKey: string, error: string): ColumnarResult {
  return {
    matches: [],
    matrixApplied: false,
    partial: false,
    error,
    columnar: {
      rung: 5,
      exactCount: 0,
      header: { kind: "none", text: null },
      bestMatchBadge: false,
      alsoMatched: [],
      resultKey,
      loosen: null,
      answers: answersToCriteria(answers, spec),
    },
  };
}

// ---------------------------------------------------------------------
// Spec writes (merge only) and pool sync
// ---------------------------------------------------------------------

/**
 * Read-modify-write of recommendation_tuning.columnar: every other tuning
 * key (and anything this build doesn't know) is carried over verbatim from
 * the stored row. Callers hold the shop save lock. Throws when the shop has
 * no spec yet: the Studio card only edits an existing one.
 */
export async function updateColumnarSpec(
  shopId: string,
  shopDomain: string,
  mutate: (spec: ColumnarSpec) => ColumnarSpec | Promise<ColumnarSpec>,
  opts: { keepResults?: boolean } = {},
): Promise<ColumnarSpec> {
  const { data, error } = await supabase
    .from("chat_assistant_config")
    .select("recommendation_tuning")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read matching settings: ${error.message}`);
  const raw = (data?.recommendation_tuning ?? {}) as Record<string, unknown>;
  const current = sanitizeColumnarSpec(raw.columnar);
  if (!current) throw new Error("Columnar matching isn't set up for this store.");
  const next = sanitizeColumnarSpec(await mutate(current))!;
  const tuning = { ...(typeof raw === "object" && !Array.isArray(raw) ? raw : {}), columnar: next };
  const { data: written, error: writeError } = await supabase
    .from("chat_assistant_config")
    .update({ recommendation_tuning: tuning, updated_at: new Date().toISOString() })
    .eq("shop_domain", shopDomain)
    .select("shop_domain");
  if (writeError) throw new Error(`Saving failed: ${writeError.message}`);
  // An UPDATE matching no row "succeeds": treat it as the failure it is.
  if (!written || written.length === 0) throw new Error("Saving failed: settings row not found");
  invalidateColumnarCaches(shopId, opts);
  invalidateStorefrontCache(shopDomain);
  return next;
}

export type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

const COLLECTION_HANDLES_QUERY = `#graphql
  query ColumnarPool($handle: String!, $after: String) {
    collectionByHandle(handle: $handle) {
      id
      products(first: 250, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          handle
        }
      }
    }
  }
`;

/** Every product handle in a collection (Admin GraphQL, paginated). */
export async function fetchCollectionHandles(
  graphql: AdminGraphql,
  collectionHandle: string,
): Promise<{ ok: true; handles: string[] } | { ok: false; error: string }> {
  const handles: string[] = [];
  let after: string | null = null;
  // 40 pages x 250 = 10,000 products: far past any quiz pool.
  for (let page = 0; page < 40; page++) {
    const data = (await graphql(COLLECTION_HANDLES_QUERY, { handle: collectionHandle, after })) as {
      collectionByHandle?: {
        products?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<{ handle?: string }> };
      } | null;
    };
    const collection = data?.collectionByHandle;
    if (!collection) return { ok: false, error: `No collection with the handle "${collectionHandle}".` };
    for (const n of collection.products?.nodes ?? []) {
      if (typeof n?.handle === "string" && HANDLE_RE.test(n.handle) && !handles.includes(n.handle)) handles.push(n.handle);
    }
    if (!collection.products?.pageInfo?.hasNextPage) return { ok: true, handles };
    after = collection.products.pageInfo.endCursor ?? null;
    if (!after) break;
  }
  return { ok: true, handles };
}

/**
 * Pull the collection's handles into spec.pool (merged; nothing else in
 * the spec or tuning changes). An empty or missing collection never
 * overwrites a pool, and a background refresh also refuses to shrink the
 * pool by more than half (a mis-set automated collection would otherwise
 * empty the quiz); the Studio button can still apply it.
 */
export async function syncColumnarPool(
  shopId: string,
  shopDomain: string,
  graphql: AdminGraphql,
  opts: { collectionHandle?: string | null; background?: boolean; beforeWrite?: () => Promise<void> } = {},
): Promise<{ ok: true; count: number; collectionHandle: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("chat_assistant_config")
    .select("recommendation_tuning")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) return { ok: false, error: `Couldn't read matching settings: ${error.message}` };
  const current = sanitizeColumnarSpec((data?.recommendation_tuning as Record<string, unknown> | null)?.columnar);
  if (!current) return { ok: false, error: "Columnar matching isn't set up for this store." };
  const handle = (opts.collectionHandle ?? current.pool.collectionHandle ?? "").trim();
  if (!handle || !HANDLE_RE.test(handle)) return { ok: false, error: "Enter the collection's handle first." };

  let fetched: Awaited<ReturnType<typeof fetchCollectionHandles>>;
  try {
    fetched = await fetchCollectionHandles(graphql, handle);
  } catch (e) {
    return { ok: false, error: `Shopify didn't return the collection: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!fetched.ok) return fetched;
  if (fetched.handles.length === 0) {
    return { ok: false, error: `The collection "${handle}" has no products, so the pool was left as it was.` };
  }
  if (opts.background && current.pool.handles.length > 0 && fetched.handles.length < current.pool.handles.length / 2) {
    console.warn(
      `[columnar] background sync for ${shopDomain} skipped: ${handle} has ${fetched.handles.length} products, pool has ${current.pool.handles.length}`,
    );
    return { ok: false, error: "Collection shrank by more than half; sync it from Studio to apply." };
  }
  await withShopSaveLock(shopId, async () => {
    await opts.beforeWrite?.();
    // Same products from the same collection: only the stamp moves, so the
    // shoppers' cached results stay valid.
    const unchanged =
      current.pool.source === "collection" &&
      current.pool.collectionHandle === handle &&
      current.pool.handles.length === fetched.handles.length &&
      current.pool.handles.every((h, i) => h === fetched.handles[i]);
    await updateColumnarSpec(
      shopId,
      shopDomain,
      (spec) => ({
        ...spec,
        pool: { collectionHandle: handle, handles: fetched.handles, syncedAt: new Date().toISOString(), source: "collection" },
      }),
      { keepResults: unchanged },
    );
  });
  return { ok: true, count: fetched.handles.length, collectionHandle: handle };
}

const refreshing = new Set<string>();
// Last attempt per shop, success or not: a refresh that keeps failing (or
// is refused) must not hit the Admin API on every Studio revalidation.
const lastRefreshAttempt = new Map<string, number>();

/**
 * Lazy hourly refresh, called from the Studio loader (the one place with an
 * admin client). Background, deduped per shop, and only for a pool that
 * already follows a collection: a CSV-pinned pool stays pinned until the
 * merchant syncs it.
 */
export function maybeRefreshColumnarPool(
  shopId: string,
  shopDomain: string,
  spec: ColumnarSpec | undefined,
  graphql: AdminGraphql,
): void {
  if (!spec || spec.pool.source !== "collection" || !spec.pool.collectionHandle) return;
  const age = spec.pool.syncedAt ? Date.now() - Date.parse(spec.pool.syncedAt) : Infinity;
  if (age < POOL_REFRESH_AFTER_MS || refreshing.has(shopId)) return;
  if (Date.now() - (lastRefreshAttempt.get(shopId) ?? 0) < POOL_REFRESH_AFTER_MS) return;
  refreshing.add(shopId);
  lastRefreshAttempt.set(shopId, Date.now());
  syncColumnarPool(shopId, shopDomain, graphql, { background: true })
    .then((r) => {
      if (r.ok) console.log(`[columnar] refreshed pool for ${shopDomain}: ${r.count} products from ${r.collectionHandle}`);
      else console.warn(`[columnar] background pool refresh skipped for ${shopDomain}: ${r.error}`);
    })
    .catch((e) => console.error("[columnar] background pool refresh failed:", e instanceof Error ? e.message : e))
    .finally(() => refreshing.delete(shopId));
}

// ---------------------------------------------------------------------
// Studio view
// ---------------------------------------------------------------------

export interface ColumnarStudioView {
  enabled: boolean;
  threshold: number;
  /** Full matches every shown option must keep (fix spec v4). */
  fullMatchMin: number;
  configured: boolean;
  vibes: Array<{ id: string; label: string; enabled: boolean }>;
  /** Answer labels for the hidden-options log, keyed by answer ID. */
  labels: Record<string, string>;
  /** Only the axes the hidden-options log reads (length/shape/finish). */
  axes: ColumnarSpec["axes"];
  rows: Array<[string, string, string]>;
  pool: {
    source: "collection" | "csv";
    collectionHandle: string | null;
    syncedAt: string | null;
    handleCount: number;
    eligibleCount: number;
    excluded: Array<{ handle: string; title: string; reasons: string[] }>;
  };
  error: string | null;
}

export async function loadColumnarStudioView(shopId: string, spec: ColumnarSpec): Promise<ColumnarStudioView> {
  const [poolResult, flow] = await Promise.all([
    getPoolSnapshot(shopId, spec).then(
      (p) => ({ ok: true as const, p }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
    ),
    getRecommendationFlow(shopId).catch(() => null),
  ]);
  const labels = { ...DEFAULT_ANSWER_LABELS, ...(flow ? labelsFromFlow(spec, flow.questions) : {}) };
  const pool = poolResult.ok ? poolResult.p : null;
  const branchAxes: ColumnarSpec["axes"] = {};
  for (const [k, a] of Object.entries(spec.axes)) {
    if (a.role === "length" || a.role === "shape" || a.role === "finish") branchAxes[k] = a;
  }
  return {
    enabled: spec.enabled,
    threshold: spec.threshold,
    fullMatchMin: spec.fullMatchMin,
    configured: Object.keys(spec.axes).length > 0,
    vibes: VIBE_IDS.filter((id) => {
      const key = axisForRole(spec, "vibe");
      return key ? Object.values(spec.axes[key].values).includes(id) : true;
    }).map((id) => ({ id, label: labels[id] ?? id, enabled: vibeEnabled(spec, id) })),
    labels,
    axes: branchAxes,
    rows: pool ? buildBranching(spec, pool.eligible).pool.rows : [],
    pool: {
      source: spec.pool.source,
      collectionHandle: spec.pool.collectionHandle,
      syncedAt: spec.pool.syncedAt,
      handleCount: spec.pool.handles.length,
      eligibleCount: pool?.eligible.length ?? 0,
      excluded: pool
        ? [
            ...pool.notInCatalog.map((handle) => ({ handle, title: handle, reasons: ["Not in the synced catalog"] })),
            ...pool.excluded,
          ]
        : [],
    },
    error: poolResult.ok ? null : poolResult.error,
  };
}
