import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { trackTransformationEvent, trackAssistantEvent, findShopByDomain } from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

// Simple event tracking endpoint for widget views and add-to-cart events
export const action = async ({ request }: ActionFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  // Rate limiting - lighter limits since this is just analytics
  const clientIP = getClientIP(request);
  const ipLimit = checkRateLimit(
    `track:ip:${clientIP}:minute`,
    RATE_LIMITS.TRACK_PER_IP_MINUTE.limit,
    RATE_LIMITS.TRACK_PER_IP_MINUTE.windowMs
  );
  
  if (!ipLimit.allowed) {
    // Silently accept but don't process - don't expose rate limit to potential attackers
    return json({ success: true }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await request.json();
    const { shopDomain, productId, eventType, widgetType, cartToken, deviceType } = body;

    // Product-level events (tied to a specific product page widget) vs.
    // assistant-level funnel events (shop-wide, no product). The chat assistant
    // fires the latter, so those don't require a productId.
    const allowedProductEvents = ['widget_view', 'add_to_cart', 'transformation'];
    const allowedAssistantEvents = [
      'chat_open',
      'chat_recommend_start',
      'chat_photo_upload',
      'chat_recommendation_shown',
      'chat_view_product',
      'chat_add_product_to_bag',
      'chat_add_bundle_to_bag',
      'hero_view',
      'hero_dismiss',
      'hero_cta_click',
      // Quiz page funnel (gleame-quiz.js). Ordered roughly by flow position:
      // view → start → per-question → gate → photo/skip → shade → results →
      // try-on → product/cart actions.
      'quiz_view',
      'quiz_start',
      'quiz_question_answered',
      'quiz_gate_view',
      'quiz_photo_upload',
      'quiz_photo_skip',
      'quiz_shade_detected',
      'quiz_shade_detect_failed',
      'quiz_shade_manual',
      'quiz_results_shown',
      'quiz_tryon_shown',
      'quiz_tryon_secondary',
      'quiz_view_product',
      'quiz_add_to_cart',
      // Results "add all" bundle button (migration 070).
      'quiz_add_bundle_to_bag',
      'quiz_retake_photo',
      'quiz_restart',
      // Lead capture step (migration 067): step seen → submitted / skipped.
      'quiz_lead_view',
      'quiz_lead_submitted',
      'quiz_lead_skipped',
    ];
    const isAssistantEvent = allowedAssistantEvents.includes(eventType);

    if (!shopDomain || !eventType) {
      return json({ error: "Missing required fields" }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Product events still require a productId; assistant events don't.
    if (!isAssistantEvent && !productId) {
      return json({ error: "Missing required fields" }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    if (!allowedProductEvents.includes(eventType) && !isAssistantEvent) {
      return json({ error: "Invalid event type" }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Anti-pollution: when the browser sends an Origin, the event is
    // attributed to the shop that OWNS that origin (exact shop_domain or
    // alternate_domains) when we can resolve it. Only a resolved origin
    // belonging to a DIFFERENT shop than the body claims (real spoofing)
    // is dropped; an UNKNOWN origin host is the normal case for a
    // custom-domain storefront never added to alternate_domains, so fall
    // back to verifying the body-claimed shop exists rather than silently
    // discarding the whole funnel. No Origin header (legacy clients, some
    // beacons) keeps the body claim as before.
    let effectiveShopDomain = String(shopDomain);
    const origin = request.headers.get("Origin") ?? request.headers.get("Referer");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch {
        originHost = null;
      }
      if (originHost && originHost !== effectiveShopDomain.toLowerCase()) {
        const originShop = await findShopByDomain(originHost);
        if (originShop) {
          if (originShop.shop_domain !== effectiveShopDomain) {
            // Origin owned by a different shop — spoofed claim.
            // Same opaque response as rate limiting: accept, don't process.
            return json({ success: true }, {
              headers: { "Access-Control-Allow-Origin": "*" }
            });
          }
          effectiveShopDomain = originShop.shop_domain;
        } else {
          // Unknown origin (custom domain not in alternate_domains):
          // verify the claimed shop exists before attributing to it.
          const claimedShop = await findShopByDomain(effectiveShopDomain.toLowerCase());
          if (!claimedShop) {
            return json({ success: true }, {
              headers: { "Access-Control-Allow-Origin": "*" }
            });
          }
          effectiveShopDomain = claimedShop.shop_domain;
        }
      }
    }

    // Validate and sanitize cart token (Shopify tokens are alphanumeric, typically 32 chars)
    let sanitizedCartToken: string | undefined = undefined;
    if (cartToken && typeof cartToken === 'string') {
      const trimmed = cartToken.trim();
      // Only accept alphanumeric tokens up to 64 chars (Shopify tokens are ~32)
      if (/^[a-zA-Z0-9-_]+$/.test(trimmed) && trimmed.length <= 64) {
        sanitizedCartToken = trimmed;
      }
    }

    // Only accept the two device classes the widget emits; anything else is
    // stored as null (counts toward totals, not the mobile/desktop split).
    const sanitizedDeviceType: 'mobile' | 'desktop' | undefined =
      deviceType === 'mobile' || deviceType === 'desktop' ? deviceType : undefined;

    // Track the event with cart token for conversion attribution (fire and forget for speed)
    if (isAssistantEvent) {
      trackAssistantEvent(
        effectiveShopDomain,
        eventType,
        widgetType || 'chat',
        sanitizedCartToken,
        sanitizedDeviceType
      ).catch(err => {
        console.error('Failed to track assistant event:', err);
      });
    } else {
      trackTransformationEvent(
        effectiveShopDomain,
        productId,
        eventType,
        widgetType || 'unknown',
        sanitizedCartToken
      ).catch(err => {
        console.error('Failed to track event:', err);
      });
    }

    return json({ success: true }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  } catch (error) {
    console.error('Track event error:', error);
    return json({ error: "Internal error" }, { 
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

// Handle OPTIONS for CORS - Remix needs this as a loader for preflight
export const loader = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    },
  });
};
