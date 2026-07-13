import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  getPhotoAxes,
} from "../lib/supabase.server";
import {
  buildCandidatePool,
  orderCandidates,
  fetchProductHandles,
  slugifyHandle,
  extractNumericId,
  type Candidate,
} from "../lib/recommendation-engine.server";
import { transformCandidateImage } from "../lib/tryon-transform.server";
import { classifyPhotoAxes } from "../lib/photo-axis-classifier.server";
import { checkRateLimit, getClientIP } from "../lib/rate-limiter.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;
    // preference is accepted as a form field for future category-based filtering;
    // currently not used to avoid rejecting requests when the field is empty.

    // criteria is a JSON object of axis_key → axis_value, e.g.
    // {"undertone":"warm"} or {"undertone":"warm","depth":"fair"}. The
    // widget sends this for shops with a recommendation matrix configured.
    // We parse defensively — malformed criteria just falls through to the
    // legacy AI-pick path instead of erroring the whole request.
    let criteria: Record<string, string> = {};
    try {
      const raw = formData.get("criteria");
      if (typeof raw === "string" && raw.length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Both keys and values must match the same identifier shape used
          // in the schema's CHECK constraints (lower snake_case). Anything
          // else is dropped — a malformed payload becomes empty criteria,
          // which silently falls through to the legacy AI-pick path.
          const ID_RE = /^[a-z_][a-z0-9_]*$/;
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && ID_RE.test(k) && ID_RE.test(v)) {
              criteria[k] = v;
            }
          }
        }
      }
    } catch {
      // Malformed criteria — ignore, fall through to AI fallback.
    }

    if (!imageFile || !shopDomain) {
      return json(
        { error: "Missing required fields: image, shopDomain" },
        { status: 400, headers: CORS_HEADERS }
      );
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

    // Rate limit
    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(
      `chat-recommend:ip:${clientIP}:minute`,
      10, // 10 recommendations per minute per IP
      60_000
    );
    if (!ipLimit.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": ipLimit.retryAfterSeconds.toString() } }
      );
    }

    // Get chat config
    const chatConfig = await getChatAssistantConfig(verifiedDomain);
    if (!chatConfig.enabled) {
      return json({ error: "Chat assistant not enabled" }, { status: 403, headers: CORS_HEADERS });
    }

    // Eligible products → flat candidate pool (one entry per variant, plus
    // one per variant-less product).
    const { pool, emptyReason } = await buildCandidatePool(verifiedDomain, chatConfig);
    if (!pool) {
      return json(
        {
          recommendations: [],
          error: emptyReason === "no_selected"
            ? "No products selected for recommendations"
            : "No products available for recommendations",
        },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Clamp desired count to a safe range (matches admin UI slider 1..5)
    const desiredCount = Math.max(
      1,
      Math.min(5, Number(chatConfig.num_recommendations) || 3)
    );

    // Convert image to base64 once — used by the photo-axis classifier
    // below and by every transform.
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    // -----------------------------------------------------------------
    // Photo-sourced axes: matrix rules store criteria across ALL axes,
    // but the widget only collects user-question answers. Classify any
    // photo axes (e.g. skintone) from the selfie and merge them in —
    // without this the strict-equality rule lookup can never match for
    // shops that have a photo axis.
    // -----------------------------------------------------------------
    const photoAxes = await getPhotoAxes(verifiedShop.id);
    const missingPhotoAxes = photoAxes.filter((a) => !(a.key in criteria));
    if (missingPhotoAxes.length > 0) {
      const photoCriteria = await classifyPhotoAxes(
        base64Image,
        imageFile.type,
        missingPhotoAxes,
      );
      Object.assign(criteria, photoCriteria);
      const stillMissing = missingPhotoAxes.filter((a) => !(a.key in criteria));
      if (stillMissing.length > 0) {
        console.warn(
          `[chat-recommend] photo axes unclassified for ${verifiedDomain}: ` +
            `${stillMissing.map((a) => a.key).join(", ")} — matrix lookup will miss`
        );
      }
    }

    // Matrix path when a rule matches the criteria (curated picks first in
    // rank order, AI-ordered candidates appended as backfill); AI ordering
    // (shuffle + diversity pass) otherwise.
    const { ordered, matrixApplied, matrixCount } = await orderCandidates(
      verifiedShop.id,
      criteria,
      pool,
      { logTag: "chat-recommend", shopDomain: verifiedDomain },
    );

    const transformCandidate = async (candidate: Candidate) => {
      const { product, variant } = candidate;
      const productName = product.product_name;
      const variantTitle = variant?.variant_title || null;
      const displayTitle = variantTitle
        ? `${productName} — ${variantTitle}`
        : productName;
      const outcome = await transformCandidateImage({
        product,
        variant,
        base64Image,
        mimeType: imageFile.type,
        shopDomain: verifiedDomain,
        widgetType: "chat",
        logTag: "chat-recommend",
      });
      return {
        productId: product.shopify_id,
        variantId: variant?.shopify_variant_id ?? null,
        productHandle: slugifyHandle(productName),
        variantNumericId: extractNumericId(variant?.shopify_variant_id),
        title: displayTitle,
        productName,
        variantTitle,
        tagline: variant?.tagline ?? null,
        tryOnPreview: outcome.tryOnPreview,
        error: outcome.error,
        matrixRank: candidate.matrixRank,
        // Per-rule quantity (migration 043). Additive field: older widget
        // builds ignore it; current gleame-chat.js uses it for cart adds so
        // a "2 sets" rule carts the same on chat and quiz.
        quantity: Math.max(1, candidate.quantity ?? 1),
      };
    };

    // When the matrix applied, the merchant curated exactly matrixCount
    // picks for this combination — don't pad past that with AI picks. The
    // AI candidates appended to `ordered` serve only as backfill when a
    // curated pick fails to transform.
    const targetCount = matrixApplied
      ? Math.min(desiredCount, matrixCount)
      : desiredCount;

    // First pass: transform the top N candidates in parallel
    const firstBatch = ordered.slice(0, targetCount);
    const firstResults = await Promise.all(firstBatch.map(transformCandidate));
    let successful = firstResults.filter((r) => r.tryOnPreview !== null);

    // Backfill: if any failed and we still have candidates in the pool, try more
    if (successful.length < targetCount && ordered.length > targetCount) {
      const needed = targetCount - successful.length;
      const backfillPool = ordered.slice(
        targetCount,
        targetCount + Math.min(needed * 2, ordered.length - targetCount)
      );
      const backfillResults = await Promise.all(backfillPool.map(transformCandidate));
      successful = successful.concat(
        backfillResults.filter((r) => r.tryOnPreview !== null)
      );
    }

    const finalSuccessful = successful.slice(0, targetCount);

    // Replace slugified placeholder handles with the real Shopify handles
    // so the "Shop This" link in gleame-chat.js resolves to /products/{real}.
    // Single batched call; any GID not in the map keeps its slugified
    // fallback so behavior never regresses below pre-fix.
    const realHandles = await fetchProductHandles(
      verifiedDomain,
      finalSuccessful.map((r) => r.productId).filter((id): id is string => Boolean(id)),
      "chat-recommend",
    );
    // Annotate each recommendation with rank for the widget's "Top Match"
    // badge. For matrix-applied responses we preserve the merchant's
    // authored rank (so the badge follows their curated intent, not the
    // response array index). For AI-pick responses, rank is just the
    // position in the response. matrixApplied tells the widget which
    // semantics are in play.
    const recommendations = finalSuccessful.map((r, idx) => {
      const effectiveRank = (typeof r.matrixRank === "number" && r.matrixRank > 0)
        ? r.matrixRank
        : idx + 1;
      // Strip matrixRank from the wire — widget only needs `rank`.
      const { matrixRank: _matrixRank, ...rest } = r;
      const withRank = { ...rest, rank: effectiveRank };
      const real = r.productId ? realHandles.get(r.productId) : undefined;
      return real ? { ...withRank, productHandle: real } : withRank;
    });

    return json({ recommendations, matrixApplied }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Chat recommend error:", err);
    return json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
