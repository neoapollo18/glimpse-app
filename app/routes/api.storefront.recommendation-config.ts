import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getRecommendationFlow,
} from "../lib/supabase.server";
import { storefrontCached } from "../lib/storefront-cache.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/**
 * Returns the user-facing portion of the recommendation flow for a shop:
 * questions to ask, their options, and which axes come from the photo.
 * The widget uses this to drive the multi-step chat.
 *
 * The photo axes are listed by key only — the widget doesn't need to know
 * how the analyzer produces them; it just sends the photo and the server
 * fills in those axis values during /chat-recommend.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shopDomain");

  if (!shopDomain) {
    return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });
  }

  // Same payload for every shopper: 20 s in-process cache, see
  // storefront-cache.server.ts.
  const result = await storefrontCached(shopDomain, "recommendation-config", async () => {
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) return { status: 403, body: { error: "Unknown shop" } as unknown };

    const hasAccess = await shopHasValidAccess(verifiedShop.shop_domain);
    if (!hasAccess) return { status: 403, body: { error: "Subscription inactive" } as unknown };

    return { status: 200, body: (await getRecommendationFlow(verifiedShop.id)) as unknown };
  });

  return json(result.body, {
    status: result.status,
    headers:
      result.status === 200
        ? { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" }
        : CORS_HEADERS,
  });
};
