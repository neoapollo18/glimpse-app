import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { findShopByDomain, getChatAssistantConfig, shopHasValidAccess } from "../lib/supabase.server";
import { checkRateLimits, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { CORS_HEADERS } from "../lib/storefront-api.server";
import { bundleDiscountLive, getQuizOffers } from "../lib/quiz-offers.server";

/**
 * Bundle discount code (migration 086). The widget calls this right after
 * the results bundle lands in the cart and applies the returned code to
 * the cart. The code is never in the public, cached quiz-config payload;
 * its real protection is the Shopify rule behind it (minimum item count),
 * this endpoint just keeps it off scrapers' default path.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }
  const shopDomain = typeof body?.shopDomain === "string" ? body.shopDomain.trim() : "";
  if (!shopDomain) return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });

  const rate = checkRateLimits([
    {
      key: `bundle-discount:ip:${getClientIP(request)}:minute`,
      limit: RATE_LIMITS.BUNDLE_DISCOUNT_PER_IP_MINUTE.limit,
      windowMs: RATE_LIMITS.BUNDLE_DISCOUNT_PER_IP_MINUTE.windowMs,
    },
  ]);
  if (!rate.allowed) {
    return json(
      { error: "Too many requests" },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(rate.retryAfterSeconds ?? 30) } },
    );
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
  if (!(await shopHasValidAccess(shop.shop_domain))) {
    return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
  }
  const [offers, config] = await Promise.all([getQuizOffers(shop.id), getChatAssistantConfig(shop.shop_domain)]);
  // The bundle button itself may have been switched off since this
  // shopper loaded the (60s-cached) config: no code without a bundle.
  if (!config.quiz_bundle_enabled || !bundleDiscountLive(offers) || !offers.bundleDiscountCode) {
    return json({ code: null }, { headers: CORS_HEADERS });
  }
  return json({ code: offers.bundleDiscountCode }, { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
};

export const loader = async () => new Response(null, { status: 204, headers: CORS_HEADERS });
