import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
} from "../lib/supabase.server";
import { buildCandidatePool } from "../lib/recommendation-engine.server";
import { transformCandidateImage } from "../lib/tryon-transform.server";
import { checkRateLimit, getClientIP } from "../lib/rate-limiter.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Per-card try-on generation for the quiz results page. The quiz renders
 * result cards instantly from quiz-recommend (no transforms), then calls
 * this endpoint per card — hero first, secondary cards on demand ("See it
 * on you") — and blur-up reveals the returned image.
 *
 * The photo is processed in memory and never persisted.
 *
 * Request:  multipart { image, shopDomain, productId (Shopify GID),
 *                       variantId? (Shopify variant GID) }
 * Response: { tryOnPreview: base64 | null, error: string | null }
 */
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
    const productId = formData.get("productId") as string;
    const variantId = (formData.get("variantId") as string) || null;

    if (!imageFile || !shopDomain || !productId) {
      return json(
        { error: "Missing required fields: image, shopDomain, productId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return json({ error: "Image too large" }, { status: 413, headers: CORS_HEADERS });
    }

    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
    }
    const verifiedDomain = verifiedShop.shop_domain;

    const hasAccess = await shopHasValidAccess(verifiedDomain);
    if (!hasAccess) {
      return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
    }

    // Tighter than chat-recommend's 10/min: each call is one transform, and
    // the client queues hero-first with a per-session cap, so 6/min only
    // bites on abuse.
    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(`quiz-tryon:ip:${clientIP}:minute`, 6, 60_000);
    if (!ipLimit.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": ipLimit.retryAfterSeconds.toString() } }
      );
    }

    const chatConfig = await getChatAssistantConfig(verifiedDomain);
    if (!chatConfig.enabled) {
      return json({ error: "Assistant not enabled" }, { status: 403, headers: CORS_HEADERS });
    }

    // Resolve the requested product/variant through the same scoped pool the
    // recommendation endpoints use — a GID outside the shop's configured
    // scope (or another shop's catalog) simply doesn't resolve.
    const { pool } = await buildCandidatePool(verifiedDomain, chatConfig);
    if (!pool) {
      return json({ error: "Product not available" }, { status: 404, headers: CORS_HEADERS });
    }
    let candidate = variantId
      ? pool.candidates.find((c) =>
          c.product.shopify_id === productId &&
          c.variant?.shopify_variant_id === variantId
        ) ?? null
      : null;
    if (!candidate && !variantId) {
      // No variant requested (product-level matrix rule). Synthesize a
      // product-level candidate so the transform uses the PRODUCT prompt and
      // reference images — mirroring how the chat path renders variant:null
      // rule targets. Grabbing the first variant candidate here would try
      // the shopper on an arbitrary shade.
      const inScope = pool.candidates.find((c) => c.product.shopify_id === productId);
      if (inScope) candidate = { product: inScope.product, variant: null };
    }
    if (!candidate) {
      return json({ error: "Product not available" }, { status: 404, headers: CORS_HEADERS });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const outcome = await transformCandidateImage({
      product: candidate.product,
      variant: candidate.variant,
      base64Image,
      mimeType: imageFile.type,
      shopDomain: verifiedDomain,
      widgetType: "quiz",
      logTag: "quiz-tryon",
    });

    return json(outcome, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Quiz tryon error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};
