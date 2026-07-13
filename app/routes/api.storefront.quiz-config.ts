import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
} from "../lib/supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/**
 * Public config for the quiz page section block (gleame-quiz.js). Mirrors
 * chat-config's pattern: shop verification, {assistant_name} token
 * replacement server-side, 60s public cache. Question content comes from
 * /api/storefront/recommendation-config — this endpoint is copy + style
 * + the mode switch only.
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

  const config = await getChatAssistantConfig(verifiedShop.shop_domain);

  const renderTokens = (s: string) =>
    s.replace(/\{assistant_name\}/g, config.assistant_name);

  const quizActive = config.enabled &&
    (config.assistant_mode === "quiz" || config.assistant_mode === "both");

  return json(
    {
      // The section renders nothing when the quiz surface isn't active —
      // the block shows a setup hint in the theme editor instead.
      enabled: quizActive,
      assistantMode: config.assistant_mode,
      assistantName: config.assistant_name,
      avatarUrl: config.avatar_url,
      // Style: explicit quiz accent, else the assistant's global accent.
      // Null radius/fonts = widget defaults / runtime theme inheritance.
      accentColor: config.quiz_accent_color || config.accent_color,
      buttonRadius: config.quiz_button_radius,
      headingFontOverride: config.quiz_heading_font_override,
      bodyFontOverride: config.quiz_body_font_override,
      numRecommendations: config.num_recommendations,
      // Framing hint reused by the camera modal on the try-on gate.
      photoFrameHint: config.photo_frame_hint,
      landing: {
        eyebrow: renderTokens(config.quiz_eyebrow),
        headline: renderTokens(config.quiz_headline),
        subtext: renderTokens(config.quiz_subtext),
        trustItems: config.quiz_trust_items,
        beforeImageUrl: config.quiz_before_image_url,
        afterImageUrl: config.quiz_after_image_url,
        visualCaption: renderTokens(config.quiz_visual_caption),
        altAudienceLabel: config.quiz_alt_audience_label,
        altAudienceUrl: config.quiz_alt_audience_url,
      },
      gate: {
        headline: renderTokens(config.quiz_gate_headline),
        helper: renderTokens(config.quiz_gate_helper),
        photoLabel: renderTokens(config.quiz_gate_photo_label),
        skipLabel: renderTokens(config.quiz_gate_skip_label),
        privacyNote: renderTokens(config.quiz_privacy_note),
      },
      results: {
        headlinePhoto: renderTokens(config.quiz_results_headline_photo),
        headlineNoPhoto: renderTokens(config.quiz_results_headline_nophoto),
        bestMatchPill: config.quiz_best_match_pill,
        alsoMatchedLabel: config.quiz_also_matched_label,
        // {count}, {set_word}, {total} replaced client-side at render time.
        addButtonTemplate: config.quiz_add_button_template,
        viewProductLabel: config.quiz_view_product_label,
        retakeLabel: config.quiz_retake_label,
      },
      shadeGate: {
        headline: renderTokens(config.quiz_shade_headline),
        body: renderTokens(config.quiz_shade_body),
        ctaPhoto: config.quiz_shade_cta_photo,
        ctaManual: config.quiz_shade_cta_manual,
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
