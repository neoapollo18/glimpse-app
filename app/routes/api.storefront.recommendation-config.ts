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

// shop: the verified shop_domain, for cache invalidation (never sent).
type FlowResult = { status: number; body: unknown; shop?: string };

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
  // Trimmed so the cache key is the exact string findShopByDomain resolves
  // (it ignores surrounding whitespace).
  const shopDomain = url.searchParams.get("shopDomain")?.trim();

  if (!shopDomain) {
    return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });
  }

  // Same payload for every shopper: 20 s in-process cache, see
  // storefront-cache.server.ts.
  const result = await storefrontCached(
    shopDomain,
    "recommendation-config",
    async (): Promise<FlowResult> => {
      const verifiedShop = await findShopByDomain(shopDomain);
      if (!verifiedShop) return { status: 403, body: { error: "Unknown shop" } };

      const hasAccess = await shopHasValidAccess(verifiedShop.shop_domain);
      if (!hasAccess) return { status: 403, body: { error: "Subscription inactive" } };

      return {
        status: 200,
        body: await getRecommendationFlow(verifiedShop.id),
        shop: verifiedShop.shop_domain,
      };
    },
    {
      // Only a configured flow is kept: a cached 403, or the unconfigured
      // flow a failed read returns, would blank the quiz for every shopper
      // until it expired.
      keep: (r) => r.status === 200 && (r.body as { configured?: boolean } | null)?.configured !== false,
      shopOf: (r) => r.shop,
    },
  );

  return json(result.body, {
    status: result.status,
    headers:
      result.status === 200
        ? { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" }
        : CORS_HEADERS,
  });
};
