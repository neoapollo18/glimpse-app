import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  getRecommendationFlow,
  pickVariantsByCriteria,
  pickVariantsByPartialCriteria,
} from "../lib/supabase.server";
import {
  buildCandidatePool,
  aiOrderCandidates,
  orderByMatrix,
  fetchProductHandles,
  slugifyHandle,
  extractNumericId,
  type Candidate,
} from "../lib/recommendation-engine.server";
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
 * Request:  JSON { shopDomain, criteria: { axis_key: axis_value, ... } }
 * Response: {
 *   matches: [{ productId, variantId, variantNumericId, productHandle,
 *               productName, variantTitle, title, tagline, rank,
 *               quantity, reasons: string[] }],
 *   matrixApplied: boolean,
 *   partial: boolean   // true when matched via containment (e.g. shade
 *                      // still unanswered) — the quiz shows the shade gate
 * }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
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

    // Same defensive criteria validation as chat-recommend: keys and values
    // must be lower snake_case identifiers; anything else is dropped.
    const criteria: Record<string, string> = {};
    if (rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)) {
      const ID_RE = /^[a-z_][a-z0-9_]*$/;
      for (const [k, v] of Object.entries(rawCriteria as Record<string, unknown>)) {
        if (typeof v === "string" && ID_RE.test(k) && ID_RE.test(v)) {
          criteria[k] = v;
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

    // Rate limit — cheap endpoint (no AI calls), so a looser cap than
    // chat-recommend. The shade merge-and-rerun flow legitimately calls
    // this twice per session.
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

    // Exact rule first; containment (partial) when the shopper hasn't
    // answered every axis yet (e.g. shade pending) — the quiz shows a
    // provisional best match plus the shade gate in that state.
    const aiOrdered = aiOrderCandidates(pool.candidates);
    let hits = Object.keys(criteria).length > 0
      ? await pickVariantsByCriteria(verifiedShop.id, criteria)
      : null;
    let partial = false;
    if ((!hits || hits.length === 0) && Object.keys(criteria).length > 0) {
      hits = await pickVariantsByPartialCriteria(verifiedShop.id, criteria);
      partial = Boolean(hits && hits.length > 0);
    }

    const { ordered, matrixApplied, matrixCount } = orderByMatrix(hits, pool, aiOrdered, {
      logTag: "quiz-recommend",
      shopDomain: verifiedDomain,
      criteria,
    });
    if (!matrixApplied) partial = false;

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
      const flow = await getRecommendationFlow(verifiedShop.id);
      for (const q of flow.questions) {
        const answered = criteria[q.axisKey];
        if (!answered) continue;
        const opt = q.options.find((o) => o.axisValue === answered);
        if (!opt) continue;
        reasons.push(opt.reasonText || `${q.axisLabel}: ${opt.label}`);
        if (reasons.length >= 3) break;
      }
    }

    const picks = ordered.slice(0, targetCount);
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
        reasons,
      };
    });

    // Collapsing partial picks to product level can make two ranks that
    // targeted sibling variants identical — keep the first (best rank).
    const uniqueMatches = partial
      ? matches.filter((m, i) => matches.findIndex((o) => o.productId === m.productId) === i)
      : matches;

    return json({ matches: uniqueMatches, matrixApplied, partial }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Quiz recommend error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};
