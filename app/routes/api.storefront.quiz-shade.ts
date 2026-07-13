import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  getPhotoAxes,
} from "../lib/supabase.server";
import { classifyPhotoAxes } from "../lib/photo-axis-classifier.server";
import { checkRateLimit, getClientIP } from "../lib/rate-limiter.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Classify-only endpoint for the quiz's shade detection: takes a shopper
 * photo, classifies the shop's photo-sourced axes (e.g. hair shade), and
 * returns the values WITHOUT running any try-on transform. The quiz shows
 * the detected shade ("Butterscotch — detected from your photo") with a
 * manual picker as the correction path, then merges the value into criteria
 * for /api/storefront/quiz-recommend.
 *
 * The photo is processed in memory and never persisted — storefront copy
 * promises "never stored", and this endpoint is part of that promise.
 *
 * Request:  multipart { image, shopDomain }
 * Response: { values: { axis_key: axis_value }, labels: { axis_key: "Label" } }
 *           (both empty when classification fails or no photo axes exist —
 *           the client falls back to the manual picker)
 */
// CORS preflight — Remix routes OPTIONS to the LOADER, not the action.
// FormData posts don't preflight today, but any header change would.
export const loader = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;

    if (!imageFile || !shopDomain) {
      return json(
        { error: "Missing required fields: image, shopDomain" },
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

    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(`quiz-shade:ip:${clientIP}:minute`, 6, 60_000);
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

    const photoAxes = await getPhotoAxes(verifiedShop.id);
    if (photoAxes.length === 0) {
      return json({ values: {}, labels: {} }, { headers: CORS_HEADERS });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const values = await classifyPhotoAxes(base64Image, imageFile.type, photoAxes);

    // Resolve display labels so the quiz can say "Butterscotch" instead of
    // "butterscotch" without re-deriving from its own config fetch.
    const labels: Record<string, string> = {};
    for (const axis of photoAxes) {
      const v = values[axis.key];
      if (!v) continue;
      const match = axis.values.find((av) => av.value === v);
      if (match) labels[axis.key] = match.label;
    }

    return json({ values, labels }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Quiz shade error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};
