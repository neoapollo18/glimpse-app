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
import { getBrandProfile, servedTemplateFor } from "../lib/brand-profile.server";
import { defaultEmailPlacement, isTemplateId, resolveQuizTokens } from "../lib/quiz-templates";
import { templateRenderable, templateServedLive } from "../lib/template-live.server";
import { verifyStorePreviewToken } from "../lib/app-proxy.server";

/** Template contract the widget must declare (`&tpl=`) to receive template
 * payloads. Mirrors TEMPLATE_PROTOCOL in gleame-quiz.js. */
const WIDGET_TEMPLATE_PROTOCOL = "3";

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
  //   1. Per-shop publish stamp (migration 081, template-live.server.ts):
  //      the template serves only after the merchant published / turned on
  //      a template quiz. QUIZ_TEMPLATES_LIVE=off is the emergency kill that
  //      forces every shop back to legacy.
  //   2. Serve-time eligibility — selection-time validation goes stale as
  //      imagery changes, and writers other than the template endpoint
  //      exist. An ineligible/unknown template degrades to t5 (renders
  //      with zero imagery), never to a broken layout.
  // A signed "View on my store" preview (proxy.preview.$draftId) renders
  // the assigned template before it's published, so the merchant previews
  // what Publish will put live. The token is shop-bound (7-day, shareable
  // via the preview bar's Copy link).
  //
  // Widget handshake: template payloads go only to a widget that declares
  // it renders this template contract (`tpl`). Theme-app-block placements
  // run the extension's deployed gleame-quiz.js, which can lag the app (the
  // 09-25 build maps t1 to the retired v2 layout); an older widget keeps
  // the classic quiz instead of mis-rendering a published template. Bump
  // WIDGET_TEMPLATE_PROTOCOL together with gleame-quiz.js on contract
  // changes.
  const widgetRendersTemplates = url.searchParams.get("tpl") === WIDGET_TEMPLATE_PROTOCOL;
  const previewToken = url.searchParams.get("previewToken") ?? "";
  const previewId = url.searchParams.get("previewId") ?? "";
  const isStorePreview = verifyStorePreviewToken(previewToken, verifiedShop.shop_domain, previewId);
  const templatesLive =
    widgetRendersTemplates && (isStorePreview ? templateRenderable(config) : templateServedLive(config));
  const brandProfile =
    templatesLive && config.quiz_template
      ? await getBrandProfile(verifiedShop.shop_domain).catch(() => null)
      : null;
  // Shared with the Studio preview (servedTemplateFor) so the canvas and
  // the storefront render the same template.
  const servedTemplate = templatesLive ? servedTemplateFor(config.quiz_template, brandProfile) : null;
  // v3 (V3-CONTRACTS §6): email placement = merchant column, else the
  // template default. Absent for legacy shops. The template owns its
  // visual design (no separate Look since 2026-10-01).
  const servedEmailPlacement =
    servedTemplate && isTemplateId(servedTemplate)
      ? config.quiz_email_placement ?? defaultEmailPlacement(servedTemplate)
      : null;
  const brandTokens = resolveQuizTokens(servedTemplate, brandProfile?.tokens ?? null);

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
      // Kept null for payload parity with pre-v3 responses (v2's T3
      // immersive backdrop no longer exists; the widget ignores null).
      screenImageUrl: null,
      // v3 template payload (V3-CONTRACTS §6), present ONLY when a template
      // is assigned: email placement, Match phases, the Images-rail
      // slot map, and theme.heroImage (legacy v2 field the hero slot falls
      // back to when the slot map has no `hero`).
      ...(tplContent
        ? {
            emailPlacement: servedEmailPlacement,
            phases: config.quiz_phases ?? [],
            theme: { heroImage: tplContent.heroImage },
            imageSlots: tplContent.imageSlots ?? {},
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
        // v3 intro types (spec 5.1), template shops only. `rating` is
        // ALWAYS null until a review-app reader exists — never typed by
        // default. `founder` feeds intro type D; null falls to type E.
        ...(tplContent
          ? {
              founder: config.quiz_founder,
              rating: null,
              benefitChips: config.quiz_trust_items,
            }
          : {}),
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
        // v3 (template shops only, legacy payload stays byte-identical):
        // whether a discount is configured, so the hook_start intro can
        // promise one. The CODE itself stays unserved, see below.
        ...(tplContent ? { hasDiscount: Boolean(config.quiz_lead_discount_code) } : {}),
        // The discount code is deliberately NOT served here: this response
        // is public, CORS *, and cached — a scrapeable code would gut the
        // email-for-code trade. The quiz-lead POST returns it after a
        // stored submit instead.
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        // Preview responses differ from the public one: never share-cache.
        "Cache-Control": isStorePreview ? "no-store" : "public, max-age=60",
      },
    }
  );
};
