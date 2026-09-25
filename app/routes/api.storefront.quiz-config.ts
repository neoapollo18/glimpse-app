import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
} from "../lib/supabase.server";
import {
  readTemplateContentFields,
  type TemplateContentFields,
} from "../lib/quiz-preview.server";
import { getBrandProfile } from "../lib/brand-profile.server";
import { resolveQuizTokens } from "../lib/quiz-templates";

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

  // Overhaul template system (migration 072): quiz_template NULL = legacy
  // rendering, brandTokens absent, nothing changes.
  //
  // Post-incident hardening (2026-09-25). quiz_template doubled as both
  // "merchant chose a template" and "v2 is live", so stale column values
  // flipped real storefronts to structural templates at deploy time. Two
  // gates now sit between the column and a shopper:
  //   1. QUIZ_TEMPLATES_LIVE env kill switch — until it's "true", every
  //      shop serves legacy regardless of the column.
  //   2. Serve-time eligibility — selection-time validation goes stale as
  //      imagery changes, and writers other than the template endpoint
  //      exist. An ineligible/unknown template degrades to t5 (renders
  //      with zero imagery), never to a broken layout.
  const templatesLive = process.env.QUIZ_TEMPLATES_LIVE === "true";
  let servedTemplate = templatesLive ? config.quiz_template : null;
  const brandProfile = servedTemplate
    ? await getBrandProfile(verifiedShop.shop_domain).catch(() => null)
    : null;
  if (servedTemplate && servedTemplate !== "t5") {
    const eligible = brandProfile?.templateAssignment?.eligible;
    if (!Array.isArray(eligible) || !eligible.includes(servedTemplate as never)) {
      servedTemplate = "t5";
    }
  }
  const brandTokens = resolveQuizTokens(
    servedTemplate,
    config.quiz_preset,
    brandProfile?.tokens ?? null
  );

  // v2 template content (spec Parts 3 / 5.6): trust lines, results prose,
  // archetype copy, hero image, image slots. These live in the same
  // chat_assistant_config row as every other quiz_ key but are not yet in
  // the typed mapper, so template shops take one defensive raw read;
  // absent columns simply resolve to null. Legacy shops (template null)
  // never pay the read and never see the fields.
  // The mapper has carried these fields since the same commit that added
  // them; the row from getChatAssistantConfig is already complete, so no
  // second read. (readTemplateContentFields accepts the mapped row: the
  // field names are identical.)
  const tplContent: TemplateContentFields | null = servedTemplate
    ? readTemplateContentFields(config as unknown as Record<string, unknown>)
    : null;

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
      // Template shops skip the global-accent fallback: accent_color has a
      // house default that would stomp the extracted brand accent.
      accentColor: config.quiz_accent_color || (servedTemplate ? null : config.accent_color),
      buttonRadius: config.quiz_button_radius,
      headingFontOverride: config.quiz_heading_font_override,
      bodyFontOverride: config.quiz_body_font_override,
      headingWeightOverride: config.quiz_heading_weight_override,
      // Design tokens (migration 049). Null = the widget stylesheet's
      // defaults — the shipped design, unchanged.
      inkColor: config.quiz_ink_color,
      cardBgColor: config.quiz_card_bg_color,
      lineColor: config.quiz_line_color,
      ctaColor: config.quiz_cta_color,
      cardRadius: config.quiz_card_radius,
      progressStyle: config.quiz_progress_style,
      introLayout: config.quiz_intro_layout,
      animationStyle: config.quiz_animation_style,
      // Overhaul templates (Contract 2/3): template id sets the widget's
      // root layout class; brandTokens map onto the --gq-* vars before the
      // merchant overrides above. Both absent for legacy shops.
      template: servedTemplate,
      brandTokens,
      // T3's immersive backdrop: the Brand API cover image in v1
      // (per-question imagery lands with the generation pipeline).
      screenImageUrl:
        servedTemplate === "t3" ? brandProfile?.brand?.coverImageUrl ?? null : null,
      // v2 template content, present ONLY when a template is assigned.
      // theme.heroImage feeds T1's sticky hero (Part 4 source priority
      // lands upstream; merchants can override via quiz_hero_image);
      // imageSlots is the Images-rail slot map (Part 4.4), passed through.
      ...(tplContent
        ? {
            theme: { heroImage: tplContent.heroImage },
            imageSlots: tplContent.imageSlots,
          }
        : {}),
      numRecommendations: config.num_recommendations,
      // Migration 069: false = never generate try-on images (hero
      // transform, "See on me", post-results upsell); the photo step and
      // shade detection are unaffected. Older cached configs omit it —
      // widget treats absent as enabled.
      tryonEnabled: config.quiz_tryon_enabled,
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
        // Migration 068: false skips the photo step entirely (questions
        // route straight to results). Older cached configs omit it —
        // widget treats absent as enabled.
        enabled: config.quiz_gate_enabled,
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
        // Restart link under the results. Reuses the chat's end-of-flow
        // restart copy — same meaning, one field for merchants to edit.
        restartLabel: renderTokens(config.end_restart_label),
        // Redesign copy (migration 046). Headlines/subtext may carry
        // {first_name}/{count} — resolved client-side.
        subtext: renderTokens(config.quiz_results_subtext),
        showMatchesLabel: config.quiz_show_matches_label,
        // "Add all" bundle button (migration 070). Older cached configs
        // omit it — widget treats absent as disabled.
        bundleEnabled: config.quiz_bundle_enabled,
        bundleLabel: config.quiz_bundle_label,
        // 0 = all matches; N>0 = shopper picks N (migration 071).
        bundleSize: config.quiz_bundle_size,
        // Per-card merchant note (migration 074). Null = hidden; the
        // widget linkifies email addresses into mailto links.
        matchFootnote: config.quiz_match_footnote
          ? renderTokens(config.quiz_match_footnote)
          : null,
        // v2 template results content (spec 5.6 / Part 3), only when a
        // template is assigned: T2's computation-screen trust lines,
        // T1's consultation prose template, T4's archetype reveal copy.
        ...(tplContent
          ? {
              trustLines: tplContent.trustLines,
              proseTemplate: tplContent.proseTemplate,
              archetypeTitle: tplContent.archetypeTitle,
              archetypeLine: tplContent.archetypeLine,
            }
          : {}),
      },
      upsell: {
        title: renderTokens(config.quiz_upsell_title),
        body: renderTokens(config.quiz_upsell_body),
        cta: config.quiz_upsell_cta,
      },
      shadeGate: {
        headline: renderTokens(config.quiz_shade_headline),
        body: renderTokens(config.quiz_shade_body),
        ctaPhoto: config.quiz_shade_cta_photo,
        ctaManual: config.quiz_shade_cta_manual,
        // Migration 054: false hides the photo step's manual shade rail.
        // The results shade gate ignores this (it's the no-photo recovery
        // path). Older cached configs omit it — widget treats absent as true.
        manualEnabled: config.quiz_manual_shade_enabled,
      },
      // Lead capture step (migration 067). enabled=false (the default)
      // means the widget never renders the step.
      lead: {
        enabled: config.quiz_lead_enabled,
        collectPhone: config.quiz_lead_collect_phone,
        headline: renderTokens(config.quiz_lead_headline),
        body: renderTokens(config.quiz_lead_body),
        buttonLabel: config.quiz_lead_button_label,
        skipLabel: config.quiz_lead_skip_label,
        consentText: renderTokens(config.quiz_lead_consent_text),
        // The discount code is deliberately NOT served here: this response
        // is public, CORS *, and cached — a scrapeable code would gut the
        // email-for-code trade. The quiz-lead POST returns it after a
        // stored submit instead.
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
