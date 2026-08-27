// Draft preview payload builders (Phase 6).
//
// The admin Quiz Builder previews the DRAFT config by rendering the real
// storefront quiz JS (gleame-quiz.js) with injected payloads instead of the
// storefront fetches. These builders produce payloads in the exact shapes
// the widget expects:
//   - flow:   getRecommendationFlow() shape, built from draft.flow
//   - config: /api/storefront/quiz-config payload shape, built from the live
//             ChatAssistantConfig merged with draft.settings overrides.
//             (Mapping intentionally duplicated from the storefront route —
//             that route is frozen for live-merchant safety. Preview drift
//             only affects preview fidelity, never the storefront.)
//   - sampleRecommend: canned quiz-recommend response derived from the
//             draft's rule targets so the results screen has cards to show.

import {
  supabase,
  getChatAssistantConfig,
  type ChatAssistantConfig,
} from "./supabase.server";
import { isLiveProduct, isLiveVariant } from "./quiz-config-schema.server";
import type { QuizDraft } from "./quiz-draft.server";

const SWATCH_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const hexOrNull = (v: unknown): string | null =>
  typeof v === "string" && SWATCH_HEX_RE.test(v) ? v : null;

// Mirrors mapDisplayMeta on the live read path: swatches end up inside
// string-built style="" attributes in the widget, where escapeHtml alone
// doesn't stop CSS injection — only strict hex may pass, even in previews
// (the document is served from the app origin).
function sanitizeDisplayMeta(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  return {
    sublabel: typeof meta.sublabel === "string" ? meta.sublabel : undefined,
    tag: typeof meta.tag === "string" ? meta.tag : undefined,
    meterLabel: typeof meta.meterLabel === "string" ? meta.meterLabel : undefined,
    meterPct: typeof meta.meterPct === "number" ? Math.max(0, Math.min(100, meta.meterPct)) : undefined,
    swatch: hexOrNull(meta.swatch) ?? undefined,
    swatch2: hexOrNull(meta.swatch2) ?? undefined,
  };
}

export function buildPreviewFlow(draft: QuizDraft) {
  const flow = draft.flow;
  const axisByKey = new Map(flow.axes.map((a) => [a.key, a]));

  const questions = flow.questions
    .map((q) => {
      const axis = axisByKey.get(q.axisKey);
      if (!axis || axis.source !== "user_question") return null;
      const options = q.options
        .filter((opt) => axis.values.some((v) => v.value === opt.axisValueValue))
        .map((opt) => ({
          label: opt.label,
          axisValue: opt.axisValueValue,
          botResponse: opt.botResponse ?? null,
          reasonText: opt.reasonText ?? null,
          imageUrl: opt.imageUrl ?? null,
          showIf: opt.showIf ? { axisKey: opt.showIf.axis_key, axisValue: opt.showIf.axis_value } : null,
          selectAll: opt.selectAll ?? false,
          displayMeta: sanitizeDisplayMeta(opt.displayMeta),
        }));
      if (options.length === 0) return null;
      return {
        axisKey: q.axisKey,
        axisLabel: axis.label,
        prompt: q.prompt,
        helperText: q.helperText ?? null,
        multiSelect: q.multiSelect ?? false,
        maxSelections: q.maxSelections && q.maxSelections > 0 ? q.maxSelections : null,
        screenGroup: q.screenGroup ?? null,
        showIf: q.showIf ? { axisKey: q.showIf.axis_key, axisValue: q.showIf.axis_value } : null,
        optionStyle: q.optionStyle ?? null,
        options,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);

  const photoAxisSource = flow.axes.filter((a) => a.source === "photo");
  return {
    questions,
    photoAxes: photoAxisSource.map((a) => a.key),
    photoAxisDetails: photoAxisSource.map((a) => ({
      key: a.key,
      label: a.label,
      values: a.values.map((v) => ({
        value: v.value,
        label: v.label,
        swatch: hexOrNull(v.swatchColor),
      })),
    })),
    configured: flow.axes.length > 0 && (questions.length > 0 || photoAxisSource.length > 0),
  };
}

/**
 * Live chat config merged with the draft's settings overrides, mapped into
 * the quiz-config payload shape. enabled is FORCED true — previews always
 * render even when the live surface is off.
 */
export async function buildPreviewQuizConfig(shopDomain: string, draft: QuizDraft) {
  const live = await getChatAssistantConfig(shopDomain);
  const config = { ...live, ...(draft.settings as Partial<ChatAssistantConfig>) } as ChatAssistantConfig;
  const renderTokens = (s: string) => (s ?? "").replace(/\{assistant_name\}/g, config.assistant_name);

  return {
    enabled: true,
    assistantMode: config.assistant_mode,
    assistantName: config.assistant_name,
    avatarUrl: config.avatar_url,
    accentColor: config.quiz_accent_color || config.accent_color,
    buttonRadius: config.quiz_button_radius,
    headingFontOverride: config.quiz_heading_font_override,
    bodyFontOverride: config.quiz_body_font_override,
    inkColor: config.quiz_ink_color,
    cardBgColor: config.quiz_card_bg_color,
    lineColor: config.quiz_line_color,
    ctaColor: config.quiz_cta_color,
    cardRadius: config.quiz_card_radius,
    progressStyle: config.quiz_progress_style,
    introLayout: config.quiz_intro_layout,
    animationStyle: config.quiz_animation_style,
    numRecommendations: config.num_recommendations,
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
      addButtonTemplate: config.quiz_add_button_template,
      viewProductLabel: config.quiz_view_product_label,
      retakeLabel: config.quiz_retake_label,
      restartLabel: renderTokens(config.end_restart_label),
      subtext: renderTokens(config.quiz_results_subtext),
      showMatchesLabel: config.quiz_show_matches_label,
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
      manualEnabled: config.quiz_manual_shade_enabled,
    },
  };
}

/**
 * Canned results for the preview's results screen: the draft's top-ranked
 * rule targets (or the shop's first products when there are no rules, e.g.
 * ai mode), resolved to names via the synced catalog.
 */
export async function buildPreviewSampleRecommend(shopId: string, draft: QuizDraft, count = 6) {
  const targets: Array<{ productId: string | null; variantId: string | null; quantity: number; rank: number }> = [];
  const seen = new Set<string>();
  for (const rule of [...draft.flow.rules].sort((a, b) => a.rank - b.rank)) {
    const key = `${rule.productId ?? ""}|${rule.variantId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      productId: rule.productId ?? null,
      variantId: rule.variantId ?? null,
      quantity: rule.quantity ?? 1,
      rank: rule.rank,
    });
    if (targets.length >= count) break;
  }

  const variantIds = targets.map((t) => t.variantId).filter((v): v is string => Boolean(v));
  const variantRowsRaw = variantIds.length
    ? (await supabase.from("product_variants").select("*").in("id", variantIds)).data ?? []
    : [];
  const variantRows = variantRowsRaw.filter((v: any) => isLiveVariant(v));
  const variantById = new Map(variantRows.map((v: any) => [v.id as string, v]));

  const productIds = new Set<string>(targets.map((t) => t.productId).filter((p): p is string => Boolean(p)));
  for (const v of variantRows) productIds.add((v as any).product_id as string);

  let productRows: any[] = [];
  if (productIds.size > 0) {
    productRows = ((await supabase.from("products").select("*").in("id", [...productIds])).data ?? []).filter(
      (p: any) => isLiveProduct(p),
    );
  }
  if (targets.length === 0) {
    // No rules (ai/hybrid draft): sample the first LIVE products so the
    // results screen demonstrates the layout with items the published quiz
    // could actually recommend.
    productRows = (((await supabase.from("products").select("*").eq("shop_id", shopId).order("id").limit(count * 3)).data ?? [])
      .filter((p: any) => isLiveProduct(p)))
      .slice(0, count);
    for (const p of productRows) {
      targets.push({ productId: p.id, variantId: null, quantity: 1, rank: targets.length + 1 });
    }
  }
  const productById = new Map(productRows.map((p: any) => [p.id as string, p]));

  // Synced catalog prices are dollars; the widget's formatMoney takes cents.
  const cents = (price: unknown): number | null =>
    typeof price === "number" && Number.isFinite(price) ? Math.round(price * 100) : null;

  const matches = targets
    .map((t, idx) => {
      const variant = t.variantId ? variantById.get(t.variantId) : null;
      const product = productById.get(t.productId ?? (variant as any)?.product_id ?? "");
      if (!product) return null;
      return {
        productId: product.id,
        variantId: t.variantId,
        variantNumericId: null,
        productHandle: (product as any).handle ?? "",
        productName: (product as any).product_name ?? "",
        variantTitle: (variant as any)?.variant_title ?? null,
        title: (product as any).product_name ?? "",
        tagline: null,
        rank: idx + 1,
        quantity: t.quantity,
        reasons: [],
      };
    })
    .filter(Boolean);

  // Minimal /products/<handle>.js lookalikes so preview result cards render
  // images and prices instead of blanks (the widget's fetchProductJson is
  // stubbed to read this map in preview mode).
  const productJson: Record<string, unknown> = {};
  for (const p of productRows) {
    const handle = (p as any).handle;
    if (!handle) continue;
    const image = (p as any).image_url ?? null;
    productJson[handle] = {
      handle,
      featured_image: image,
      images: image ? [image] : [],
      price: cents((p as any).price),
      variants: [
        {
          id: 0,
          price: cents((p as any).price),
          featured_image: null,
        },
      ],
    };
  }

  return { matches, matrixApplied: draft.flow.rules.length > 0, partial: false, productJson };
}
