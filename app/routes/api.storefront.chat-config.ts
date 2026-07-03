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

  // One swatch fetch serves two consumers: the hero's preview tiles (capped
  // at hero_sample_count) and the chat's loading ribbon (wants the fuller
  // set), so it runs regardless of hero_enabled. Pass the resolved shop_id
  // (and recommendation scope) so the helper doesn't re-resolve the domain
  // and doesn't preview variants outside the actual recommendation pool.
  const swatchPool = await getHeroSwatches(verifiedShop.id, 8, {
    productScope: config.product_scope,
    selectedProductIds: config.selected_product_ids,
    max: 8,
  });
  const heroSwatches = config.hero_enabled
    ? swatchPool.slice(0, Math.max(2, Math.min(4, config.hero_sample_count)))
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
      // Bot message pushed right after the hero CTA opens the chat, before
      // the first recommendation question. Empty string = skipped.
      openingMessage: renderTokens(config.opening_message),
      recommendButtonText: config.recommend_button_text,
      preferenceQuestion: config.preference_question,
      preferenceOptions: config.preference_options,
      photoUploadMessage: config.photo_upload_message,
      // Framing hint shown inside the desktop camera modal.
      photoFrameHint: config.photo_frame_hint,
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
      // Shade colors for the loading-state marquee ribbon. Widget falls back
      // to a built-in palette when empty (no variant display_colors set).
      loadingSwatches: swatchPool
        .map((s) => s.color)
        .filter((c): c is string => Boolean(c)),
      // End-of-flow copy. {assistant_name} is replaced now; {count} stays
      // as a token because the widget knows the runtime count.
      recommendationsIntro: renderTokens(config.recommendations_intro),
      endSaveLabel: renderTokens(config.end_save_label),
      endRestartLabel: renderTokens(config.end_restart_label),
      endFooter: renderTokens(config.end_footer),
      // Bundle card copy. {assistant_name} resolved now; {count}/{total} stay
      // as tokens the widget fills with runtime values.
      bundle: {
        enabled: config.bundle_enabled,
        title: renderTokens(config.bundle_title),
        subtext: renderTokens(config.bundle_subtext),
        button: renderTokens(config.bundle_button),
      },
      // 'serif' | 'sans' — applied to product + bundle titles via a CSS var.
      titleFont: config.title_font,
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
        // Hero tint: explicit override, else the global accent. Resolved here
        // so the widget always gets a usable color.
        accentColor: config.hero_accent_color || config.accent_color,
        // Exact panel background + headline color. Null = widget falls back
        // to the accent-derived tint / default dark headline.
        backgroundColor: config.hero_background_color,
        textColor: config.hero_text_color,
        // Merchant-supplied sample images take precedence over the auto color
        // swatches; the widget falls back to `swatches` when this is empty.
        sampleImages: Array.isArray(config.hero_sample_images) ? config.hero_sample_images : [],
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
