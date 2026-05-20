import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  isSkinAnalysisEnabledByShopId,
  getSkinAnalysisConfigByShopId,
  projectSkin,
  DEFAULT_PROJECTION_WITHOUT_TREATMENT_PROMPT,
  DEFAULT_PROJECTION_WITH_TREATMENT_PROMPT,
} from "../lib/skin-analysis.server";
import { findShopByDomain, shopHasValidAccess } from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { CORS_HEADERS, isValidImageFile } from "../lib/storefront-api.server";

/**
 * Storefront API: POST a selfie + shopDomain, get back two AI-generated
 * projection images of the customer's face 5 years from now (without /
 * with a daily skincare + SPF routine).
 *
 * Mirrors api.storefront.analyze-skin.ts:
 *   - Same auth chain: shop verify → subscription → feature flag → rate limit.
 *   - 404 for unknown-shop AND for disabled-feature (indistinguishable to
 *     a probe so attackers can't enumerate which shops have it enabled).
 *   - Image generation + model choice + compress-once optimization live
 *     in projectSkin() so this route stays a thin gate.
 *
 * Rate-limit budget is split from analyze-skin: a customer who hits the
 * analyze ceiling can still get projections, and vice versa. The widget
 * fires both in parallel so the effective per-click cap is min(both).
 *
 * Cost note: each call is 2× Gemini image generations. Rate limits are
 * tighter than analyze-skin (see RATE_LIMITS.PROJECT_SKIN_*).
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    // STEP 1: Parse + validate fields
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;

    if (!imageFile || !shopDomain) {
      return json(
        { error: "Missing required fields: image and shopDomain" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // STEP 2: Verify shop
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      console.log(`[project-skin] unknown shop domain: ${shopDomain}`);
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }
    const verifiedShopDomain = verifiedShop.shop_domain;
    const verifiedShopId = verifiedShop.id;

    // STEP 3+4+7: Gate + config fetch in parallel — all three are independent
    // queries against the same shop_id and can fan out. Total wall time drops
    // from 3 sequential Supabase RTTs to 1. The cost of speculatively
    // fetching config when access is denied is one wasted SELECT.
    const [hasAccess, isEnabled, config] = await Promise.all([
      shopHasValidAccess(verifiedShopDomain),
      isSkinAnalysisEnabledByShopId(verifiedShopId),
      getSkinAnalysisConfigByShopId(verifiedShopId),
    ]);

    if (!hasAccess) {
      return json(
        { error: "This store's subscription is inactive. Please contact the store administrator." },
        { status: 403, headers: CORS_HEADERS }
      );
    }
    // Same 404 as unknown-shop above so an attacker can't enumerate which
    // shops have the feature on/off by status code.
    if (!isEnabled) {
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // STEP 5: Rate limiting
    const clientIP = getClientIP(request);

    const ipMinute = checkRateLimit(
      `project-skin:ip:${clientIP}:minute`,
      RATE_LIMITS.PROJECT_SKIN_PER_IP_MINUTE.limit,
      RATE_LIMITS.PROJECT_SKIN_PER_IP_MINUTE.windowMs
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
      `project-skin:ip:${clientIP}:hour`,
      RATE_LIMITS.PROJECT_SKIN_PER_IP_HOUR.limit,
      RATE_LIMITS.PROJECT_SKIN_PER_IP_HOUR.windowMs
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
      `project-skin:shop:${verifiedShopDomain}:hour`,
      RATE_LIMITS.PROJECT_SKIN_PER_SHOP_HOUR.limit,
      RATE_LIMITS.PROJECT_SKIN_PER_SHOP_HOUR.windowMs
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

    // STEP 6: Validate image
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

    // STEP 8: Run both projections via the library helper. projectSkin
    // compresses the selfie once and feeds the same buffer to two parallel
    // Gemini calls — saving an extra HEIC convert + Sharp resize.
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const result = await projectSkin({
      inputImage: base64Image,
      mimeType: imageFile.type,
      withoutTreatmentPrompt:
        config.projection_without_treatment_prompt?.trim() || DEFAULT_PROJECTION_WITHOUT_TREATMENT_PROMPT,
      withTreatmentPrompt:
        config.projection_with_treatment_prompt?.trim() || DEFAULT_PROJECTION_WITH_TREATMENT_PROMPT,
    });

    if (!result.withoutTreatment && !result.withTreatment) {
      // Both generations failed. Widget treats non-200 as soft failure and
      // shows the error fallback in each slot.
      return json(
        { success: false, error: "Projection generation failed." },
        { status: 502, headers: CORS_HEADERS }
      );
    }

    console.log(
      `[project-skin] ${verifiedShopDomain} ok in ${result.latencyMs}ms ` +
        `(without=${!!result.withoutTreatment}, with=${!!result.withTreatment})`
    );

    return json(
      {
        success: true,
        withoutTreatment: result.withoutTreatment,
        withTreatment: result.withTreatment,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    // Never echo error.message — could leak stack-trace fragments.
    console.error("[project-skin] unexpected error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};

export const loader = async () => {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
};
