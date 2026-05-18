import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  analyzeSkin,
  pickRecommendations,
  isSkinAnalysisEnabledByShopId,
  getSkinAnalysisConfigByShopId,
  fetchProductCards,
  type ScoreKey,
} from "../lib/skin-analysis.server";
import { findShopByDomain, shopHasValidAccess, saveSkinAnalysisPhoto } from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

/**
 * Storefront API: POST a selfie + shopDomain, get back skin scores and product
 * recommendations. Modeled on api.storefront.transform-image.ts (auth, rate
 * limit, CORS) but:
 *   - The input selfie IS persisted to the private skin-analysis-photos
 *     bucket (best-effort, see migration 028). The analysis result itself
 *     is still not stored — no analytics tie-in for this feature.
 *   - No analytics_events writes (skin analysis is intentionally outside
 *     the existing attribution pipeline).
 *   - Gated behind shops.is_skin_analysis_enabled — returns 404 if off.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

function isValidImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const heicMimeTypes = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];
  if (heicMimeTypes.includes(file.type.toLowerCase())) return true;
  if (!file.type || file.type === "" || file.type === "application/octet-stream") {
    const ext = file.name?.toLowerCase().split(".").pop();
    const validExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif"];
    return validExtensions.includes(ext || "");
  }
  return false;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    // ============================================
    // STEP 1: Parse + validate fields
    // ============================================
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;

    if (!imageFile || !shopDomain) {
      return json(
        { error: "Missing required fields: image and shopDomain" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ============================================
    // STEP 2: Verify shop (security)
    // Must run before rate limit so attackers can't poison limits with
    // fake domains. Returns 404 (not 403) on unknown shop AND on disabled
    // feature, so an attacker can't enumerate which shops have the
    // feature on/off by status code.
    // ============================================
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      console.log(`[analyze-skin] unknown shop domain: ${shopDomain}`);
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }
    const verifiedShopDomain = verifiedShop.shop_domain;
    const verifiedShopId = verifiedShop.id;

    // ============================================
    // STEP 3: Subscription gate
    // ============================================
    const hasAccess = await shopHasValidAccess(verifiedShopDomain);
    if (!hasAccess) {
      return json(
        { error: "This store's subscription is inactive. Please contact the store administrator." },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // ============================================
    // STEP 4: Feature flag gate
    // Default OFF for every shop — only flipped manually from /admin. Same
    // 404 response as unknown-shop above so the two cases are
    // indistinguishable to a probe.
    // ============================================
    const isEnabled = await isSkinAnalysisEnabledByShopId(verifiedShopId);
    if (!isEnabled) {
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // ============================================
    // STEP 5: Rate limiting (per-IP + per-shop)
    // ============================================
    const clientIP = getClientIP(request);

    const ipMinute = checkRateLimit(
      `analyze-skin:ip:${clientIP}:minute`,
      RATE_LIMITS.ANALYZE_SKIN_PER_IP_MINUTE.limit,
      RATE_LIMITS.ANALYZE_SKIN_PER_IP_MINUTE.windowMs
    );
    if (!ipMinute.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment and try again." },
        {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": ipMinute.retryAfterSeconds.toString() },
        }
      );
    }

    const ipHour = checkRateLimit(
      `analyze-skin:ip:${clientIP}:hour`,
      RATE_LIMITS.ANALYZE_SKIN_PER_IP_HOUR.limit,
      RATE_LIMITS.ANALYZE_SKIN_PER_IP_HOUR.windowMs
    );
    if (!ipHour.allowed) {
      return json(
        { error: "Hourly limit reached. Please try again later." },
        {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": ipHour.retryAfterSeconds.toString() },
        }
      );
    }

    const shopHour = checkRateLimit(
      `analyze-skin:shop:${verifiedShopDomain}:hour`,
      RATE_LIMITS.ANALYZE_SKIN_PER_SHOP_HOUR.limit,
      RATE_LIMITS.ANALYZE_SKIN_PER_SHOP_HOUR.windowMs
    );
    if (!shopHour.allowed) {
      return json(
        { error: "This store has reached its hourly limit. Please try again later." },
        {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": shopHour.retryAfterSeconds.toString() },
        }
      );
    }

    // ============================================
    // STEP 6: Validate the image
    // ============================================
    if (!isValidImageFile(imageFile)) {
      return json(
        { error: "Please upload an image file (JPG, PNG, HEIC)." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const maxSize = 5 * 1024 * 1024;
    if (imageFile.size > maxSize) {
      return json(
        { error: "File too large. Please upload an image smaller than 5MB." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ============================================
    // STEP 7: Read merchant config + run analysis
    // ============================================
    const config = await getSkinAnalysisConfigByShopId(verifiedShopId);

    const arrayBuffer = await imageFile.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);
    const base64Image = inputBuffer.toString("base64");

    // Persist the uploaded selfie to Supabase Storage (private bucket).
    // Best-effort and runs in parallel with the analysis — a storage
    // failure must never break the customer-facing result.
    const savePhoto = saveSkinAnalysisPhoto(
      verifiedShopId,
      verifiedShopDomain,
      inputBuffer,
      imageFile.name || "selfie.jpg",
      imageFile.type || "application/octet-stream"
    ).catch((err) => {
      console.error("[analyze-skin] failed to save photo:", err);
      return null;
    });

    const analysis = await analyzeSkin({
      inputImage: base64Image,
      mimeType: imageFile.type,
      systemPromptOverride: config.system_prompt,
      emphasisConcerns: config.emphasis_concerns as ScoreKey[],
    });

    const savedPhotoPath = await savePhoto;
    if (savedPhotoPath) {
      console.log(`[analyze-skin] ${verifiedShopDomain} photo saved: ${savedPhotoPath}`);
    }

    if (!analysis.success || !analysis.result) {
      return json(
        { error: analysis.error ?? "Skin analysis failed." },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const result = analysis.result;

    // Model refused (not a face / multiple faces / etc.) — return a clean
    // 200 with the rejection reason. The widget renders a friendly retry.
    if (result.rejected) {
      return json(
        {
          success: true,
          rejected: true,
          reason: result.reason,
          processedInputImage: analysis.processedInputImage ?? null,
        },
        { headers: CORS_HEADERS }
      );
    }

    // ============================================
    // STEP 8: Pick recommendations from merchant's concern→product map
    // ============================================
    const recommendations = result.scores
      ? pickRecommendations(result.scores, config.concern_product_map)
      : [];

    // Hydrate recommendations with product display data (title, image, URL).
    // Failures here degrade gracefully — recs render with concern + GID only.
    const cards = await fetchProductCards(
      verifiedShopDomain,
      recommendations.map((r) => r.productId),
    );
    const recommendationsHydrated = recommendations.map((r) => {
      const card = cards.get(r.productId);
      return {
        concern: r.concern,
        productId: r.productId,
        title: card?.title ?? null,
        imageUrl: card?.imageUrl ?? null,
        url: card?.url ?? null,
      };
    });

    console.log(
      `[analyze-skin] ${verifiedShopDomain} ok in ${analysis.latencyMs}ms, ${recommendations.length} recs`
    );

    return json(
      {
        success: true,
        rejected: false,
        skin_type: result.skin_type,
        scores: result.scores,
        notes: result.notes,
        recommendations: recommendationsHydrated,
        processedInputImage: analysis.processedInputImage ?? null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    // Never echo error.message to the client — could leak stack-trace
    // fragments. Log server-side, return generic.
    console.error("[analyze-skin] unexpected error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};

export const loader = async () => {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
};
