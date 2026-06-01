import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  getHeroSwatches,
} from "../lib/supabase.server";

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

  // Only fetch swatches if the hero is actually going to render — saves a
  // round-trip per page load for the (currently) majority of shops with
  // hero_enabled=false. Pass the resolved shop_id (and recommendation scope)
  // so the swatch helper doesn't re-resolve the domain and doesn't preview
  // variants that wouldn't appear in the actual recommendation pool.
  const heroSwatches = config.hero_enabled
    ? await getHeroSwatches(verifiedShop.id, config.hero_sample_count, {
        productScope: config.product_scope,
        selectedProductIds: config.selected_product_ids,
      })
    : [];

  // Token-replace {assistant_name} in user-editable hero copy so the widget
  // gets a render-ready string and doesn't have to know about the token.
  const renderTokens = (s: string) =>
    s.replace(/\{assistant_name\}/g, config.assistant_name);

  return json(
    {
      enabled: config.enabled,
      assistantName: config.assistant_name,
      avatarUrl: config.avatar_url,
      bubbleColor: config.bubble_color,
      bubbleText: config.bubble_text,
      accentColor: config.accent_color,
      greetingMessage: config.greeting_message,
      greetingDelaySeconds: config.greeting_delay_seconds,
      recommendButtonText: config.recommend_button_text,
      preferenceQuestion: config.preference_question,
      preferenceOptions: config.preference_options,
      photoUploadMessage: config.photo_upload_message,
      numRecommendations: config.num_recommendations,
      // Header subtitle copy. {count} in done-status is replaced client-side
      // when the recommendation count is known.
      headerIdleStatus: renderTokens(config.header_idle_status),
      headerWorkingStatus: renderTokens(config.header_working_status),
      headerDoneStatus: renderTokens(config.header_done_status),
      // Loading hero copy.
      loadingCaption: renderTokens(config.loading_caption),
      loadingSteps: Array.isArray(config.loading_steps)
        ? config.loading_steps.map((s) => renderTokens(s))
        : [],
      // End-of-flow copy. {assistant_name} is replaced now; {count} stays
      // as a token because the widget knows the runtime count.
      recommendationsIntro: renderTokens(config.recommendations_intro),
      endSaveLabel: renderTokens(config.end_save_label),
      endRestartLabel: renderTokens(config.end_restart_label),
      endFooter: renderTokens(config.end_footer),
      hero: {
        enabled: config.hero_enabled,
        eyebrow: renderTokens(config.hero_eyebrow),
        headline: renderTokens(config.hero_headline),
        body: renderTokens(config.hero_body),
        ctaLabel: renderTokens(config.hero_cta_label),
        footer: renderTokens(config.hero_footer),
        sampleLabel: renderTokens(config.hero_sample_label),
        trustItems: config.hero_trust_items,
        showDelaySeconds: config.hero_show_delay_seconds,
        swatches: heroSwatches,
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=60",
      },
    }
  );
};
