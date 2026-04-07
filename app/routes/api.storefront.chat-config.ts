import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { findShopByDomain, shopHasValidAccess, getChatAssistantConfig } from "../lib/supabase.server";

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

  if (!shopDomain) {
    return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });
  }

  // Verify shop exists
  const verifiedShop = await findShopByDomain(shopDomain);
  if (!verifiedShop) {
    return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
  }

  // Verify shop has valid access
  const hasAccess = await shopHasValidAccess(verifiedShop.shop_domain);
  if (!hasAccess) {
    return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
  }

  const config = await getChatAssistantConfig(verifiedShop.shop_domain);

  return json(
    {
      enabled: config.enabled,
      assistantName: config.assistant_name,
      avatarUrl: config.avatar_url,
      bubbleColor: config.bubble_color,
      accentColor: config.accent_color,
      greetingMessage: config.greeting_message,
      greetingDelaySeconds: config.greeting_delay_seconds,
      recommendButtonText: config.recommend_button_text,
      preferenceQuestion: config.preference_question,
      preferenceOptions: config.preference_options,
      numRecommendations: config.num_recommendations,
    },
    { headers: CORS_HEADERS }
  );
};
