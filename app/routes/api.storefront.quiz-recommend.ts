import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  getRecommendationFlow,
  matchRecommendationRules,
  ANY_VALUE,
  type MultiCriteria,
} from "../lib/supabase.server";
import {
  buildCandidatePool,
  aiOrderCandidates,
  orderByMatrix,
  fetchProductHandles,
  fetchAvailability,
  slugifyHandle,
  extractNumericId,
  type Candidate,
} from "../lib/recommendation-engine.server";
import { llmOrderCandidates, guardAndPrioritize } from "../lib/llm-recommender.server";
import { checkRateLimit, getClientIP } from "../lib/rate-limiter.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/**
 * Fast, criteria-only recommendations for the quiz page. No image, no
 * transforms — the quiz renders result cards immediately from product
 * imagery (fetched client-side via /products/{handle}.js) and streams
 * try-on previews in separately via /api/storefront/quiz-tryon.
 *
 * Request:  JSON { shopDomain, criteria: { axis_key: axis_value | [axis_value, ...] } }
 *           (arrays come from multi-select questions)
 * Response: {
 *   matches: [{ productId, variantId, variantNumericId, productHandle,
 *               productName, variantTitle, title, tagline, rank,
 *               quantity, reasons: string[] }],
 *   matrixApplied: boolean,
 *   partial: boolean   // true when matched via containment (e.g. shade
 *                      // still unanswered) — the quiz shows the shade gate
 * }
 */
// CORS preflight — Remix routes OPTIONS to the LOADER, not the action (same
// pattern as track-event). The quiz widget posts JSON, so unlike the chat's
// FormData posts, every browser call here is preceded by a preflight.
export const loader = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
    }
    const { shopDomain, criteria: rawCriteria } = (body ?? {}) as {
      shopDomain?: string;
      criteria?: unknown;
    };

    if (!shopDomain || typeof shopDomain !== "string") {
      return json({ error: "Missing required field: shopDomain" }, { status: 400, headers: CORS_HEADERS });
    }

    // Defensive criteria validation, extended for multi-select: keys must be
    // lower snake_case identifiers; values a matching string OR an array of
    // them (deduped, capped). Anything else is dropped. Null prototype +
    // explicit blocklist: "__proto__"/"constructor"/"prototype" pass the
    // identifier regex, and on a plain object `criteria["__proto__"] = [...]`
    // is a setter call, not a key write — this is a public endpoint.
    const criteria: MultiCriteria = Object.create(null);
    if (rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)) {
      // Length-capped: identifiers here can reach an LLM prompt (as lookup
      // keys only, but a megabyte "identifier" would still be a paid-token
      // amplifier) and unbounded keys would bloat the rules matcher.
      const ID_RE = /^[a-z_][a-z0-9_]{0,63}$/;
      const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
      const MAX_VALUES_PER_AXIS = 16;
      const MAX_AXES = 32;
      for (const [k, v] of Object.entries(rawCriteria as Record<string, unknown>)) {
        if (Object.keys(criteria).length >= MAX_AXES) break;
        if (!ID_RE.test(k) || PROTO_KEYS.has(k)) continue;
        if (typeof v === "string" && ID_RE.test(v)) {
          criteria[k] = v;
        } else if (Array.isArray(v)) {
          const values = [...new Set(v.filter(
            (s): s is string => typeof s === "string" && ID_RE.test(s)
          ))].slice(0, MAX_VALUES_PER_AXIS);
          if (values.length > 0) criteria[k] = values;
        }
      }
    }

    // Verify shop
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
    }
    const verifiedDomain = verifiedShop.shop_domain;

    // Billing check
    const hasAccess = await shopHasValidAccess(verifiedDomain);
    if (!hasAccess) {
      return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
    }

    // Rate limit. The shade merge-and-rerun flow legitimately calls this
    // twice per session. Note: in ai/hybrid modes this endpoint can make a
    // Gemini call — that path has its own tighter limiter below which
    // degrades to the shuffle fallback instead of erroring.
    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(`quiz-recommend:ip:${clientIP}:minute`, 20, 60_000);
    if (!ipLimit.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": ipLimit.retryAfterSeconds.toString() } }
      );
    }

    // Assistant kill switch is shared with chat.
    const chatConfig = await getChatAssistantConfig(verifiedDomain);
    if (!chatConfig.enabled) {
      return json({ error: "Assistant not enabled" }, { status: 403, headers: CORS_HEADERS });
    }

    const { pool } = await buildCandidatePool(verifiedDomain, chatConfig);
    if (!pool) {
      return json(
        { matches: [], matrixApplied: false, partial: false, error: "No products available for recommendations" },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const desiredCount = Math.max(1, Math.min(5, Number(chatConfig.num_recommendations) || 3));

    // The flow is needed by both the LLM ranker (answer labels, swatch
    // colors) and the matrix reason bullets — fetch at most once.
    let flowCache: Awaited<ReturnType<typeof getRecommendationFlow>> | null = null;
    const getFlow = async () => (flowCache ??= await getRecommendationFlow(verifiedShop.id));

    const mode = chatConfig.recommendation_mode;
    let aiOrdered = aiOrderCandidates(pool.candidates);
    let llmReasons: Map<Candidate, string> | null = null;

    // Rule matching (multi-select aware). Exact coverage first; partial when
    // the shopper hasn't answered every rule axis yet (e.g. shade pending) —
    // the quiz shows a provisional best match plus the shade gate then.
    // Mode 'ai' skips the matrix entirely: the merchant chose the LLM as
    // the single source of ranking.
    const attemptMatch = async (attemptCriteria: MultiCriteria) => {
      const match = mode !== "ai" && Object.keys(attemptCriteria).length > 0
        ? await matchRecommendationRules(verifiedShop.id, attemptCriteria)
        : null;
      // orderByMatrix logs criteria on misses; flatten arrays for readability.
      const logCriteria: Record<string, string> = {};
      for (const [k, v] of Object.entries(attemptCriteria)) {
        logCriteria[k] = Array.isArray(v) ? v.join("|") : v;
      }
      const orderedResult = orderByMatrix(match?.hits ?? null, pool, aiOrdered, {
        logTag: "quiz-recommend",
        shopDomain: verifiedDomain,
        criteria: logCriteria,
      });
      return { ...orderedResult, partial: orderedResult.matrixApplied && Boolean(match?.partial) };
    };

    let outcome = await attemptMatch(criteria);

    // LLM ranking (migrations 050/051) only where it can actually surface:
    // ai/hybrid mode, no matrix hit, and answers to rank against. Running
    // AFTER the matrix keeps matrix-covered requests as fast as before and
    // keeps the admin promise that hybrid uses AI only where no rule
    // matches. Degrades to shuffle + mismatch guard + priority on any
    // failure (including its own rate limiter), so results never blank.
    if (mode !== "matrix" && !outcome.matrixApplied && Object.keys(criteria).length > 0) {
      // Tighter caps than the endpoint limiter: this path spends Gemini
      // tokens on an unauthenticated route. Per-IP for ordinary abuse, and
      // per-SHOP as the backstop an X-Forwarded-For rotation can't evade.
      // Beyond either we degrade, not 429 — a shopper still gets
      // guarded-shuffle results.
      const llmLimit = checkRateLimit(`quiz-recommend:llm:${clientIP}:minute`, 6, 60_000);
      const shopLlmLimit = checkRateLimit(`quiz-recommend:llm-shop:${verifiedShop.id}:minute`, 60, 60_000);
      const flow = await getFlow();
      const ranked = llmLimit.allowed && shopLlmLimit.allowed
        ? await llmOrderCandidates({
            candidates: pool.candidates,
            criteria,
            flow,
            config: chatConfig,
            desiredCount,
            shopDomain: verifiedDomain,
            logTag: "quiz-recommend",
          })
        : null;
      if (ranked) {
        aiOrdered = ranked.ordered;
        llmReasons = ranked.reasons;
      } else {
        aiOrdered = guardAndPrioritize(aiOrdered, criteria, flow, chatConfig, "quiz-recommend");
      }
      outcome = { ...outcome, ordered: aiOrdered };

      // Shade gate for the non-matrix path: the matrix's partial mechanism
      // can't fire when no rule matched (or mode is 'ai'), but a
      // shade-driven shop still must not serve definitive variant picks
      // before the shade is known. Mirror the matrix semantics: an
      // unanswered shade axis -> partial, which makes the widget show
      // product-level cards and the shade gate, then re-run with the shade
      // answered. ONLY the first photo axis counts: the widget's shade
      // gate resolves exactly photoAxisDetails[0], so gating on later axes
      // would loop the gate forever with no way to clear it.
      const gateAxis = flow.photoAxisDetails[0];
      if (gateAxis && !(gateAxis.key in criteria)) {
        outcome = { ...outcome, partial: true };
      }
    }

    // Stock-aware filtering (migration 047, opt-in per shop): drop matrix
    // targets that aren't purchasable right now. When that empties a shade's
    // matches, walk the merchant's nearest-shade adjacency list and re-match.
    // Every failure path keeps the UNFILTERED outcome — an availability
    // hiccup or a fully out-of-stock family must never blank the results.
    if (chatConfig.quiz_availability_filter && outcome.matrixApplied) {
      const filterByStock = async (o: typeof outcome) => {
        const segment = o.ordered.slice(0, o.matrixCount);
        const gids = segment.map((c) => c.variant?.shopify_variant_id || c.product.shopify_id);
        const avail = await fetchAvailability(verifiedDomain, gids, "quiz-recommend");
        if (avail === null) return null; // probe failed → fail open
        const inStock = segment.filter(
          (c) => avail.get(c.variant?.shopify_variant_id || c.product.shopify_id) !== false
        );
        if (inStock.length < segment.length) {
          console.log(
            `[quiz-recommend] availability filter dropped ${segment.length - inStock.length}/${segment.length} matrix picks for ${verifiedDomain}`
          );
        }
        return { ...o, ordered: inStock.concat(o.ordered.slice(o.matrixCount)), matrixCount: inStock.length };
      };

      const filtered = await filterByStock(outcome);
      if (filtered && filtered.matrixCount > 0) {
        outcome = filtered;
      } else if (filtered) {
        // Everything for this shade is out of stock — try adjacent shades.
        const fallbacks = chatConfig.quiz_shade_fallbacks ?? {};
        const MAX_FALLBACK_ATTEMPTS = 4;
        let recovered = false;
        for (const [axisKey, byValue] of Object.entries(fallbacks)) {
          const current = criteria[axisKey];
          if (typeof current !== "string" || current === ANY_VALUE) continue;
          for (const adjacent of (byValue[current] ?? []).slice(0, MAX_FALLBACK_ATTEMPTS)) {
            const substituted: MultiCriteria = { ...criteria, [axisKey]: adjacent };
            const attempt = await attemptMatch(substituted);
            if (!attempt.matrixApplied) continue;
            const attemptFiltered = await filterByStock(attempt);
            if (attemptFiltered && attemptFiltered.matrixCount > 0) {
              console.log(
                `[quiz-recommend] shade fallback ${axisKey}: ${current} → ${adjacent} for ${verifiedDomain}`
              );
              outcome = attemptFiltered;
              recovered = true;
              break;
            }
          }
          break; // one fallback axis per shop; nested loops don't compose
        }
        if (!recovered) {
          console.warn(
            `[quiz-recommend] availability filter left 0 picks and no fallback recovered for ${verifiedDomain} — serving unfiltered matrix picks`
          );
        }
      }
    } else if (
      chatConfig.quiz_availability_filter &&
      !outcome.matrixApplied &&
      mode !== "matrix" &&
      // Partial results collapse to product level with the variant
      // explicitly arbitrary — probing that arbitrary variant's stock
      // would drop purchasable products over a shade nobody picked yet.
      // The definitive re-run after the shade gate gets the filter.
      !outcome.partial
    ) {
      // LLM-ranked (non-matrix) results get the same stock hygiene: drop
      // unavailable picks from the top window, backfill from the ranked
      // tail. Fail open on probe errors, and never filter down to zero.
      // 4x the desired count (one batched Admin call either way) so the
      // served picks come from probed candidates even when most of the
      // window is out of stock — backfilling from an unprobed tail would
      // quietly defeat the filter.
      const window = Math.min(outcome.ordered.length, desiredCount * 4);
      const segment = outcome.ordered.slice(0, window);
      const gids = segment.map((c) => c.variant?.shopify_variant_id || c.product.shopify_id);
      const avail = await fetchAvailability(verifiedDomain, gids, "quiz-recommend");
      if (avail !== null) {
        const inStock = segment.filter(
          (c) => avail.get(c.variant?.shopify_variant_id || c.product.shopify_id) !== false
        );
        if (inStock.length > 0 && inStock.length < segment.length) {
          console.log(
            `[quiz-recommend] availability filter dropped ${segment.length - inStock.length}/${segment.length} LLM picks for ${verifiedDomain}`
          );
          outcome = { ...outcome, ordered: inStock.concat(outcome.ordered.slice(window)) };
        }
      }
    }

    const { ordered, matrixApplied, matrixCount } = outcome;
    const partial = outcome.partial;

    const targetCount = matrixApplied ? Math.min(desiredCount, matrixCount) : desiredCount;

    // Reason bullets: join the shopper's answers to the merchant-authored
    // reason_text per option, in question order. Fallback is
    // "{axis label}: {option label}" so cards never render empty bullets
    // for answered questions.
    //
    // ONLY for matrix-matched picks. reason_text is merchant copy written
    // for the curated target ("blends perfectly with thick hair") — stamping
    // it on AI-shuffle fallback picks would put authoritative claims on
    // products the matrix never matched.
    const reasons: string[] = [];
    if (matrixApplied) {
      const flow = await getFlow();
      for (const q of flow.questions) {
        const answered = criteria[q.axisKey];
        if (!answered) continue;
        const selected = new Set(Array.isArray(answered) ? answered : [answered]);
        // "Open to anything" answers arrive as the ANY_VALUE marker — use
        // the select-all option's OWN copy, never a specific option's
        // authored claim the shopper didn't actually pick.
        const selectedOpts = selected.has(ANY_VALUE)
          ? q.options.filter((o) => o.selectAll)
          : q.options.filter((o) => selected.has(o.axisValue));
        if (selectedOpts.length === 0) continue;
        // First selected option with authored reason copy wins; otherwise a
        // readable fallback listing what they picked.
        const withReason = selectedOpts.find((o) => o.reasonText);
        reasons.push(
          withReason?.reasonText ||
          `${q.axisLabel}: ${selectedOpts.map((o) => o.label).join(", ")}`
        );
        if (reasons.length >= 3) break;
      }
    }

    // Build the pick list with product-level dedupe BEFORE slicing, so the
    // response isn't short-changed:
    // - partial: matches collapse to product level on the wire, so sibling
    //   variants of one product must count as ONE pick (dedupe after the
    //   slice used to eat card slots).
    // - exact: a merchant can author both a variant rule and a whole-product
    //   rule for the same product in one cell — keep the variant-level pick
    //   and drop the product-level duplicate.
    const matrixSegment = matrixApplied ? ordered.slice(0, matrixCount) : ordered;
    const picks: Candidate[] = [];
    const seenProducts = new Set<string>();
    if (partial && matrixApplied) {
      // Partial cards collapse to product level, but one rank slot can span
      // MULTIPLE products since shade routing (variantFallbackProducts):
      // shades the 12" doesn't stock compile to 16" variants, so a cell's
      // rank-1 rules target two lengths pre-shade. Showing both reads as
      // "you need both". Keep ONE product per rank slot — the one backing
      // the most rules in the slot (= the most likely outcome once the
      // shade resolves), name-ascending on ties for determinism.
      const byRank = new Map<number, Candidate[]>();
      for (const c of matrixSegment) {
        const rank = typeof c.matrixRank === "number" && c.matrixRank > 0 ? c.matrixRank : 0;
        const group = byRank.get(rank);
        if (group) group.push(c);
        else byRank.set(rank, [c]);
      }
      for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
        if (picks.length >= targetCount) break;
        const group = byRank.get(rank)!;
        const ruleCount = new Map<string, number>();
        for (const c of group) {
          ruleCount.set(c.product.id, (ruleCount.get(c.product.id) ?? 0) + 1);
        }
        const winner = group
          .filter((c) => !seenProducts.has(c.product.id))
          .sort(
            (a, b) =>
              ruleCount.get(b.product.id)! - ruleCount.get(a.product.id)! ||
              a.product.product_name.localeCompare(b.product.product_name)
          )[0];
        if (!winner) continue;
        seenProducts.add(winner.product.id);
        picks.push(winner);
      }
    } else {
      const productsWithVariantPick = new Set(
        matrixSegment.filter((c) => c.variant).map((c) => c.product.id)
      );
      for (const c of matrixSegment) {
        if (picks.length >= targetCount) break;
        if (partial) {
          if (seenProducts.has(c.product.id)) continue;
          seenProducts.add(c.product.id);
        } else if (!c.variant && productsWithVariantPick.has(c.product.id)) {
          continue; // product-level duplicate of a variant-level pick
        }
        picks.push(c);
      }
    }

    const realHandles = await fetchProductHandles(
      verifiedDomain,
      picks.map((c) => c.product.shopify_id).filter(Boolean),
      "quiz-recommend",
    );

    const matches = picks.map((candidate: Candidate, idx: number) => {
      const { product } = candidate;
      // Partial match = the rule group was chosen with an axis (typically
      // shade) still unresolved, so the specific variant inside the group is
      // arbitrary. Present the PRODUCT, not a variant the shopper never
      // picked — the widget withholds variant-specific UI (shade line,
      // add-to-bag) until the shade gate resolves and this re-runs exact.
      const variant = partial ? null : candidate.variant;
      const productName = product.product_name;
      const variantTitle = variant?.variant_title || null;
      const llmReason = llmReasons?.get(candidate);
      const effectiveRank = (typeof candidate.matrixRank === "number" && candidate.matrixRank > 0)
        ? candidate.matrixRank
        : idx + 1;
      return {
        productId: product.shopify_id,
        variantId: variant?.shopify_variant_id ?? null,
        variantNumericId: extractNumericId(variant?.shopify_variant_id),
        productHandle: realHandles.get(product.shopify_id) || slugifyHandle(productName),
        productName,
        variantTitle,
        title: variantTitle ? `${productName} — ${variantTitle}` : productName,
        tagline: variant?.tagline ?? null,
        rank: effectiveRank,
        quantity: Math.max(1, candidate.quantity ?? 1),
        // Matrix picks keep the merchant-authored answer reasons; LLM picks
        // get the ranker's per-candidate reason. Same wire shape either way.
        reasons: matrixApplied ? reasons : llmReason ? [llmReason] : [],
      };
    });

    return json({ matches, matrixApplied, partial }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Quiz recommend error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};
