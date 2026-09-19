/**
 * Archetypes + stock question banks (Overhaul Part 3 / C2, P2).
 *
 * An archetype is a human-written question-structure pattern per catalog
 * vertical. Merchants never see the word: it powers generation (the LLM
 * gets the pattern as guidance) and the no-LLM fallback (a stock bank
 * instantiated against catalog facets so an LLM hard-failure still lands
 * on a Reveal, flagged fallback_generation).
 *
 * Q1 is a vibe/identity question wherever the archetype allows —
 * vibe-as-identity outperforms occasion-as-catalog-filter.
 */

import type { CatalogProduct, GeneratedQuizConfig } from "./quiz-config-schema.server";
import { isLiveProduct } from "./quiz-config-schema.server";

export type ArchetypeId =
  | "shade_vibe_finder"
  | "routine_builder"
  | "fit_style_finder"
  | "room_style_finder"
  | "use_case_finder"
  | "gift_finder";

export function archetypeForCategory(category: string | null): ArchetypeId {
  const c = (category ?? "").toLowerCase();
  if (/color|nail|cosmetic|makeup|hair.?color/.test(c)) return "shade_vibe_finder";
  if (/skin|haircare|wellness|routine/.test(c)) return "routine_builder";
  if (/apparel|jewel|accessor|fit|style/.test(c)) return "fit_style_finder";
  if (/furnit|decor|home|room/.test(c)) return "room_style_finder";
  if (/gift|mixed/.test(c)) return "gift_finder";
  return "use_case_finder";
}

/** Q1 vibe banks per archetype — values are deliberately non-concrete so
 * the ai-mode ranker interprets them (grounding treats them as universal). */
const VIBE_BANKS: Record<ArchetypeId, { prompt: string; options: Array<[string, string]> }> = {
  shade_vibe_finder: {
    prompt: "What's the vibe you're going for?",
    options: [
      ["clean_classic", "Clean & classic"],
      ["soft_romantic", "Soft & romantic"],
      ["bold_statement", "Bold statement"],
      ["trend_forward", "Trend-forward"],
      ["moody_edgy", "Moody & edgy"],
    ],
  },
  routine_builder: {
    prompt: "What's your main goal right now?",
    options: [
      ["glow_up", "Get my glow back"],
      ["calm_repair", "Calm & repair"],
      ["keep_simple", "Keep it simple"],
      ["level_up", "Level up my routine"],
    ],
  },
  fit_style_finder: {
    prompt: "Which style feels most like you?",
    options: [
      ["timeless", "Timeless"],
      ["minimal", "Minimal"],
      ["statement", "Statement-making"],
      ["playful", "Playful"],
    ],
  },
  room_style_finder: {
    prompt: "What feeling should the space have?",
    options: [
      ["calm_airy", "Calm & airy"],
      ["warm_cozy", "Warm & cozy"],
      ["bold_modern", "Bold & modern"],
      ["classic", "Classic"],
    ],
  },
  use_case_finder: {
    prompt: "What matters most to you?",
    options: [
      ["everyday", "Everyday reliability"],
      ["performance", "Top performance"],
      ["gifting", "A great gift"],
      ["treat", "Treating myself"],
    ],
  },
  gift_finder: {
    prompt: "Who are you shopping for?",
    options: [
      ["for_them", "A gift for someone"],
      ["for_me", "A treat for me"],
      ["for_us", "Something we'll share"],
    ],
  },
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "option";

/**
 * Stock config instantiated from catalog facets — zero LLM calls, valid
 * against the generated-config schema, grounded by construction (facet
 * options come from real product groups of ≥ floor size).
 */
export function stockConfigFromCatalog(
  archetype: ArchetypeId,
  catalog: CatalogProduct[],
  scopeProductIds: Set<string> | null
): GeneratedQuizConfig {
  const inScope = catalog.filter(
    (p) => isLiveProduct(p) && (!scopeProductIds || scopeProductIds.has(p.id))
  );
  const floor = inScope.length < 15 ? 2 : 3;

  // Facet 1: product types with enough members.
  const typeCounts = new Map<string, number>();
  for (const p of inScope) {
    const t = (p.productType ?? "").trim();
    if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const typeOptions = [...typeCounts.entries()]
    .filter(([, n]) => n >= floor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t);

  // Facet 2: price bands (only when prices spread meaningfully).
  const prices = inScope.map((p) => p.price ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const priceBands: Array<[string, string]> = [];
  if (prices.length >= floor * 2) {
    const mid = prices[Math.floor(prices.length / 2)];
    if (prices[prices.length - 1] > prices[0] * 1.6) {
      priceBands.push(
        ["value", `Under $${Math.ceil(mid)}`],
        ["premium", `$${Math.ceil(mid)} and up`]
      );
    }
  }

  const vibe = VIBE_BANKS[archetype];
  const axes: any[] = [];
  const questions: any[] = [];

  axes.push({
    key: "vibe",
    label: "Vibe",
    source: "user_question",
    values: vibe.options.map(([value, label]) => ({ value, label })),
  });
  questions.push({
    axisKey: "vibe",
    prompt: vibe.prompt,
    helperText: null,
    multiSelect: false,
    options: vibe.options.map(([value, label]) => ({ label, axisValueValue: value })),
  });

  if (typeOptions.length >= 2) {
    axes.push({
      key: "product_kind",
      label: "Looking for",
      source: "user_question",
      values: typeOptions.map((t) => ({ value: slug(t), label: t })),
    });
    questions.push({
      axisKey: "product_kind",
      prompt: "What are you shopping for today?",
      helperText: null,
      multiSelect: true,
      maxSelections: 3,
      options: typeOptions.map((t) => ({ label: t, axisValueValue: slug(t) })),
    });
  }

  if (priceBands.length === 2) {
    axes.push({
      key: "budget",
      label: "Budget",
      source: "user_question",
      values: priceBands.map(([value, label]) => ({ value, label })),
    });
    questions.push({
      axisKey: "budget",
      prompt: "Where should we keep the price?",
      helperText: "We'll prioritize, not exclude.",
      multiSelect: false,
      options: priceBands.map(([value, label]) => ({ label, axisValueValue: value })),
    });
  }

  const facts = [
    `Catalog: ${inScope.length} products in scope.`,
    typeOptions.length ? `Product kinds: ${typeOptions.join(", ")}.` : "",
    "Vibe answers are identity signals — interpret them against product names, tags and imagery; never hard-filter on them.",
    "product_kind answers prioritize matching product types. budget answers prioritize, never exclude.",
    "Always return the requested number of picks; prefer diverse products over near-duplicates.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    axes,
    questions,
    rules: [],
    recommendationMode: "ai",
    aiGuidance: facts,
    copy: {
      quiz_headline: "Your perfect match, in 60 seconds",
      quiz_subtext: "Answer a few quick questions and we'll match you to exactly what suits you.",
    },
    designTokens: null,
  } as unknown as GeneratedQuizConfig;
}
