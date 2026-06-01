import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getRecommendationFlow,
} from "../lib/supabase.server";

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

  const verifiedShop = await findShopByDomain(shopDomain);
  if (!verifiedShop) {
    return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
  }

  const hasAccess = await shopHasValidAccess(verifiedShop.shop_domain);
  if (!hasAccess) {
    return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
  }

  const flow = await getRecommendationFlow(verifiedShop.id);

  return json(flow, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=60",
    },
  });
};
