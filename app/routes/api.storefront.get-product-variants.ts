import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getConfiguredVariantsForStorefront } from "../lib/supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shopDomain");
  const productId = url.searchParams.get("productId");

  if (!shopDomain || !productId) {
    return json(
      { error: "shopDomain and productId are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const variants = await getConfiguredVariantsForStorefront(shopDomain, productId);
    return json({ variants }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("Error in get-product-variants:", error);
    return json({ variants: [] }, { headers: CORS_HEADERS });
  }
};
