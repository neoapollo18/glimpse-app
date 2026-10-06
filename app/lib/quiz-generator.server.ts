// AI quiz generation (Phase 5): brand brief + synced catalog -> quiz.
//
// Save = live: generation writes the LIVE config (only for shops with no
// real quiz content yet; the guard below refuses to stomp an existing one).
// It never enables the storefront surface — the Live step toggle does.
// On validation failure there is exactly one repair round-trip (validator
// errors are sent back to the model) before giving up with a friendly error.
//
// Prompt-cache structure (shared byte-identical with the copilot so both
// surfaces hit the same cache entry):
//   system[0] role + generation rules            (stable)
//   system[1] quiz schema documentation          (stable)
//   system[2] serialized catalog + cache_control (stable per catalog sync)
//   ...everything volatile (brief, conversation) comes after the breakpoint.

import type Anthropic from "@anthropic-ai/sdk";
import {
  claudeClient,
  callClaudeWithRetry,
  logClaudeUsage,
  GenerationDeadlineError,
  CLAUDE_MODEL_MAIN,
  type ClaudeUsage,
} from "./claude.server";
import type { FillerCandidate } from "./quiz-archetypes.server";
import {
  GeneratedQuizConfigSchema,
  validateGeneratedConfig,
  serializeCatalog,
  computeAnswerProductMap,
  catalogImageForProducts,
  isLiveProduct,
  isLiveVariant,
  MIN_QUESTIONS_FLOOR,
  type AnswerFacetImage,
  type CatalogProduct,
  type GeneratedQuizConfig,
} from "./quiz-config-schema.server";
import { TEMPLATES, TEMPLATE_IDS, isTemplateEligible, isTemplateId, type TemplateId } from "./quiz-templates";
import type { GroundingReport } from "./quiz-grounding.server";
import type { BrandProfile } from "./brand-profile.server";
import { captureLiveConfig, saveLiveQuizConfig, type QuizDraft } from "./quiz-draft.server";
import { withShopSaveLock } from "./shop-save-lock.server";
import { supabase, getVariantsForProducts, saveChatAssistantConfig } from "./supabase.server";
import {
  buildGenerationReport,
  countImageSlots,
  extractedColorsFromProfile,
  headingFontFromProfile,
  resolvePhases,
  stepDetail,
  type GenerationReport,
  type GenerationStep,
  type GenerationStepKey,
  type QuizPhase,
} from "./generation-report.server";

export interface BrandBrief {
  /** MACHINE-DERIVED only (spec v2 Part 0.1 failure 4): the Brand Profile's
   * extracted category/tone. No free-text "about your store" surface feeds
   * generation; the only merchant free text allowed anywhere is the scope
   * product filter, which is scope, not brief. */
  category: string; // Brand Profile category, e.g. "color-cosmetics"
  brandVoice: string; // Brand Profile tone mapped to a voice phrase
  quizLength: "short" | "standard";
  modePreference: "matrix" | "ai" | "hybrid" | "auto";
  priorityProductIds?: string[];
  /** Overhaul Part 3: the product subset the quiz recommends from.
   * productIds null/absent = whole catalog. label is merchant-facing
   * ("Lip products"). */
  scope?: { kind: "all" | "collection" | "type" | "tag" | "freetext"; label: string; productIds: string[] | null };
}

// ---------------------------------------------------------------------
// Catalog loading (synced tables; '*' selects so it works pre/post 057)
// ---------------------------------------------------------------------

// Short-lived catalog cache: the copilot re-reads the catalog on EVERY chat
// message, but the catalog changes on the sync cadence, not the chat cadence.
const catalogCache = new Map<string, { at: number; catalog: CatalogProduct[] }>();
const CATALOG_CACHE_TTL_MS = 60_000;

export async function loadCatalogForShop(shopId: string): Promise<CatalogProduct[]> {
  const cached = catalogCache.get(shopId);
  if (cached && Date.now() - cached.at < CATALOG_CACHE_TTL_MS) return cached.catalog;

  const PAGE = 1000;
  const products: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`catalog load failed: ${error.message}`);
    products.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // getVariantsForProducts chunks the .in() list AND pages past PostgREST's
  // silent 1000-row cap — a hand-rolled fetch here silently lost variants on
  // shade-heavy catalogs.
  const variants = await getVariantsForProducts(products.map((p) => p.id));
  const variantsByProduct = new Map<string, any[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  const catalog = products.map((p) => ({
    id: p.id,
    name: p.product_name ?? "",
    productType: p.product_type ?? null,
    vendor: p.vendor ?? null,
    tags: Array.isArray(p.tags) ? p.tags : null,
    price: p.price ?? null,
    status: p.status ?? null,
    imageUrl: p.image_url ?? null,
    variants: (variantsByProduct.get(p.id) ?? []).map((v) => ({
      id: v.id,
      title: v.variant_title ?? "",
      displayColor: v.display_color ?? null,
      price: v.price ?? null,
      status: v.status ?? null,
      imageUrl: v.image_url ?? null,
    })),
  }));
  catalogCache.set(shopId, { at: Date.now(), catalog });
  return catalog;
}

export function invalidateCatalogCache(shopId: string): void {
  catalogCache.delete(shopId);
}

// ---------------------------------------------------------------------
// System blocks (STABLE — shared with the copilot; keep byte-identical)
// ---------------------------------------------------------------------

const ROLE_BLOCK = `You are Gleame's quiz designer. You build product-recommendation quizzes ("Find My Fit") for Shopify beauty and wellness stores. Shoppers answer a few questions and get matched to products from the merchant's catalog.

HARD RULES:
- Generate at least 4 and at most 8 questions; each question has 2-8 options. The 4-question minimum holds for ANY catalog size, even tiny stores. (Existing hand-built quizzes may exceed the maximum; never generate beyond it yourself.)
- Axis keys and values are lower snake_case identifiers. One question per axis. Axes with source "photo" are classified from a selfie, never asked.
- showIf conditions may only reference axes asked EARLIER in the flow.
- Rules and criteria may only reference products, variants, axes, and values that exist. Product ids look like "p:<uuid>" and variant ids like "v:<uuid>" in the catalog listing; strip the "p:"/"v:" prefix when writing productId/variantId fields.
- Write all shopper-facing copy in the merchant's brand voice. Keep prompts short and warm; option labels 1-4 words where possible.
- optionStyle guidance: "chips" for short labels, "boxed" for options with sublabels, "vibe" for moody/aesthetic choices, "visual" only when images exist (you cannot add images), "list" for plain lists.
- recommendationMode: "matrix" when the catalog is small and answers map cleanly to specific products; "ai" for large/varied catalogs where an LLM ranker picks; "hybrid" when a few certain mappings exist plus a long tail. For "ai"/"hybrid", write aiGuidance: a merchandising brief for the ranker with LAYER RULES (numbered, imperative, e.g. result shape, exclusions, hard constraints from shopper picks, diversity/assembly guidance) followed by any PRODUCT FACTS worth teaching it. For "matrix", write rules covering every reachable answer combination that matters, ranked by priority (lower rank = higher priority).
- Never invent products, variants, images, or fields not in the schema.`;

const SCHEMA_DOC_BLOCK = `QUIZ CONFIG FIELD GUIDE:
- axes: the dimensions of the quiz. key/label/source + values (value/label/optional swatchColor hex for color dots).
- questions: one per user_question axis, in flow order. prompt (the question), helperText (small sub-line), multiSelect + maxSelections (let shoppers pick several), screenGroup (consecutive questions sharing a group render on one screen), showIf ({axis_key, axis_value} render condition), optionStyle, options.
- options: label (button text), axisValueValue (which axis value it records), reasonText (shows on result cards as "why this matched"), selectAll (an "open to anything" option), displayMeta {sublabel, tag, meterLabel, meterPct 0-100, swatch, swatch2}.
- rules: matrix mappings. criteria = array of {axisKey, axisValue} pairs (ALL must match); exactly one of productId/variantId; rank (author priority, lower wins); quantity (how many units this recommendation means, e.g. 2 sets).
- recommendationMode + aiGuidance: see rules above.
- copy: storefront copy fields (quiz_eyebrow, quiz_headline, quiz_subtext, quiz_trust_items[], quiz_gate_headline, quiz_gate_helper, quiz_results_headline_photo, quiz_results_headline_nophoto, quiz_results_subtext, quiz_best_match_pill, quiz_also_matched_label, quiz_retake_label).
- designTokens: quiz_accent_color/quiz_ink_color/quiz_card_bg_color/quiz_line_color/quiz_cta_color (hex), quiz_button_radius/quiz_card_radius (px numbers), quiz_progress_style (pips|bar|counter|none), quiz_intro_layout (split|centered), quiz_animation_style (full|minimal|off).

OUTPUT FORMAT: when asked for a full quiz config, respond with ONLY the JSON object: no markdown fences, no commentary before or after. Omit fields you don't use (or set them to null).`;

/**
 * Build the shared system blocks. cache_control sits on the LAST block so
 * role+schema+catalog cache as one prefix (~5-min TTL, refreshed by use).
 */
export function buildSystemBlocks(catalogText: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: ROLE_BLOCK },
    { type: "text", text: SCHEMA_DOC_BLOCK },
    { type: "text", text: catalogText, cache_control: { type: "ephemeral" } },
  ];
}

function briefToPrompt(brief: BrandBrief, questionRange: [number, number], template: TemplateId | null): string {
  const [qMin, qMax] = questionRange;
  return [
    `Design a complete quiz for this store.`,
    `Category (detected from the store): ${brief.category}`,
    `Brand voice: ${brief.brandVoice}`,
    `THE CATALOG IS GROUND TRUTH: build the quiz around what the catalog actually sells (the quiz can only recommend real products). If the catalog's products clearly do not match the detected category, still follow the catalog - and add a warning that tells the merchant plainly, e.g. "We detected nail polish, but your synced catalog is mostly hair extensions, so the quiz was built for what's actually in your catalog."`,
    `MERCHANDISING REQUESTS (bundles, upsells, discounts) map onto what the quiz can actually do — never invent config fields for them: "bundle/mix-and-match N products" → recommend N complementary products together (numRecommendations if available, plus aiGuidance ASSEMBLY rules like "fill the last slot with a product that complements the top pick"); "upsell accessories" → an aiGuidance assembly rule reserving a slot for an accessory/add-on product from the catalog, with reasonText framing it as the perfect add-on; rule quantity covers multi-unit recommendations of one product. The quiz CANNOT create discounts or change prices — if the merchant asks for a discount, honor the bundling intent and add a warning that discounts must be set up in Shopify (e.g. an automatic discount for buying 3+), which pairs perfectly with the quiz recommending 3 products.`,
    `Quiz length: ${brief.quizLength === "short" ? `${qMin} questions` : `${qMin}-${qMax} questions`} (hard minimum ${MIN_QUESTIONS_FLOOR}, even for tiny catalogs).`,
    `INTRO SCREEN: the quiz always opens with its own intro screen - provide copy.quiz_headline (a headline in the store's voice) AND copy.quiz_subtext (one support line). Both required; the intro is never stacked with question 1.`,
    `EVERY ANSWER MUST BE GROUNDED: each option maps to a real catalog facet (product type, shade family, tag, price band...). Generic vibe answers with nothing behind them are rejected by validation.`,
    `Recommendation mode preference: ${brief.modePreference === "auto" ? "you decide based on the catalog" : brief.modePreference}`,
    brief.priorityProductIds?.length
      ? `Priority products (feature these prominently): ${brief.priorityProductIds.map((id) => `p:${id}`).join(", ")}`
      : "",
    // v3 Match (spec 3 / T1): questions run in 2-3 named phases. Asked in
    // the volatile brief, never in the cached system blocks.
    template === "t1"
      ? `PHASES: this quiz runs in phases. Add a top-level "phases" array of 2-3 objects {label, axisKeys}: label is 1-3 words in the brand voice (e.g. "About you", "Your shade", "Preferences"); axisKeys lists the question axis keys in that phase, in flow order. Every question belongs to exactly one phase and phases follow the question order.`
      : "",
    `Return the full quiz config.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------
// v2 machine-derived inputs + deterministic post-pass helpers (spec Part 5)
// ---------------------------------------------------------------------

/** Brand Profile tone → voice phrase. The brief's voice is machine-derived
 * by construction; there is no free-text voice field anywhere. */
const TONE_VOICE: Record<string, string> = {
  playful: "playful and bold",
  refined: "polished and editorial",
  neutral: "warm and confident",
};

async function loadBrandProfileSafe(shopDomain: string): Promise<BrandProfile | null> {
  try {
    const mod = await import("./brand-profile.server");
    return await mod.getBrandProfile(shopDomain);
  } catch (e) {
    console.warn(`[quiz-generate] brand profile unavailable for ${shopDomain}: ${(e as Error).message}`);
    return null;
  }
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

type GeneratedAxis = GeneratedQuizConfig["axes"][number];
type GeneratedQuestion = GeneratedQuizConfig["questions"][number];

/** Extra fill candidate beyond the archetype bank: a brand-preference
 * question from the vendor facet (only when >= 2 vendors have >= 2
 * products). Vendor answers are non-concrete, so grounding treats them as
 * ranker-interpreted (universal) - always grounded. */
function vendorQuestionCandidate(
  catalog: CatalogProduct[],
): { axis: GeneratedAxis; question: GeneratedQuestion } | null {
  const counts = new Map<string, number>();
  for (const p of catalog.filter(isLiveProduct)) {
    const v = (p.vendor ?? "").trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const vendors = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([v]) => v);
  if (vendors.length < 2) return null;
  const seen = new Set<string>();
  const values: Array<{ value: string; label: string }> = [];
  for (const v of vendors) {
    const value = slugify(v) || "brand";
    if (seen.has(value)) continue;
    seen.add(value);
    values.push({ value, label: v });
  }
  if (values.length < 2) return null;
  return {
    axis: { key: "brand_pref", label: "Brand", source: "user_question", values },
    question: {
      axisKey: "brand_pref",
      prompt: "Any brands you gravitate toward?",
      helperText: "We'll prioritize, not exclude.",
      multiSelect: true,
      maxSelections: 3,
      options: values.map((v) => ({ label: v.label, axisValueValue: v.value })),
    } as GeneratedQuestion,
  };
}

/**
 * 5.1 hard floor: fill to MIN_QUESTIONS_FLOOR from the archetype stock
 * bank (plus the vendor candidate, plus the universal fillers) when the
 * model went low - the Luna failure was a 17-product store producing 2
 * questions. Bank questions carry no matrix rules, so a pure-matrix config
 * switches to hybrid (its rules keep winning where they match; the ranker
 * interprets the rest).
 */
function fillQuestionsToMinimum(
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
  bank: () => GeneratedQuizConfig,
  fillers: () => FillerCandidate[] = () => [],
): GeneratedQuizConfig {
  if (config.questions.length >= MIN_QUESTIONS_FLOOR) return config;
  const axes = [...config.axes];
  const questions = [...config.questions];
  const existing = new Set(axes.map((a) => a.key));

  const candidates: Array<{ axis: GeneratedAxis; question: GeneratedQuestion }> = [];
  const stock = bank();
  for (const q of stock.questions) {
    const axis = stock.axes.find((a) => a.key === q.axisKey);
    if (axis) candidates.push({ axis, question: q });
  }
  const vendor = vendorQuestionCandidate(catalog);
  if (vendor) candidates.push(vendor);
  // Universal fillers last (M2): the bank itself only appends them until
  // ITS floor is met, but the model's questions may overlap the bank's
  // facet questions, so the full filler list must be reachable here too.
  for (const f of fillers()) candidates.push(f);

  let added = 0;
  for (const c of candidates) {
    if (questions.length >= MIN_QUESTIONS_FLOOR) break;
    if (existing.has(c.axis.key)) continue;
    axes.push(c.axis);
    questions.push(c.question);
    existing.add(c.axis.key);
    added++;
  }
  if (added === 0) return config;

  const next: GeneratedQuizConfig = { ...config, axes, questions };
  if (next.recommendationMode === "matrix") {
    next.recommendationMode = "hybrid";
    next.aiGuidance = [
      next.aiGuidance ?? "",
      "Added-axis guidance: vibe/brand/budget answers PRIORITIZE matching products, never exclude; matrix rules take precedence where they match.",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return next;
}

/** 5.3 backstop: the intro is always its own generated screen - headline
 * plus one support line. The validator asserts both; this guarantees the
 * assertion can never fail on a model omission. */
function ensureIntroCopy(config: GeneratedQuizConfig): void {
  const copy = { ...(config.copy ?? {}) };
  if (!(copy.quiz_headline ?? "").trim()) copy.quiz_headline = "Your perfect match, in 60 seconds";
  if (!(copy.quiz_subtext ?? "").trim()) {
    copy.quiz_subtext = "Answer a few quick questions and we'll match you to exactly what suits you.";
  }
  config.copy = copy;
}

/** 5.4: park every in-scope product no answer path reaches in the
 * generated "everything else" wildcard slot, so the "N products no path
 * reaches" state is impossible post-generation. */
function emitWildcardSlot(config: GeneratedQuizConfig, catalog: CatalogProduct[]): void {
  const map = computeAnswerProductMap(config, catalog);
  const reachable = new Set<string>();
  for (const ids of map.values()) for (const id of ids) reachable.add(id);
  const unreached = catalog
    .filter(isLiveProduct)
    .filter((p) => !reachable.has(p.id))
    .map((p) => p.id)
    .sort();
  config.wildcard = unreached.length > 0 ? { label: "Everything else", productIds: unreached } : null;
}

/**
 * Brand-library imagery per facet (spec 4.1/4.2). CONTRACT (module built in
 * parallel): resolveImagesForFacets(shopDomain, facets[{axis,value,productIds}])
 * -> Record<`${axis}:${value}`, {url, role} | null>. Lazily imported;
 * module-missing or any throw = "no imagery data", and the imagery floor
 * falls back to catalog image_url checks only - generation is never
 * blocked on the brand library.
 */
async function resolveFacetImagery(
  shopDomain: string,
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
  template: TemplateId | null,
): Promise<Record<string, AnswerFacetImage | null> | null> {
  const model = template ? TEMPLATES[template].imageryModel : null;
  if (model !== "per-answer" && model !== "per-question" && model !== "hero") return null;
  const map = computeAnswerProductMap(config, catalog);
  const facets = [...map.entries()].map(([key, ids]) => {
    const sep = key.indexOf(":");
    return { axis: key.slice(0, sep), value: key.slice(sep + 1), productIds: [...ids].sort().slice(0, 200) };
  });
  if (facets.length === 0) return null;
  try {
    const mod = (await import("./brand-library.server")) as {
      resolveImagesForFacets?: (
        shopDomain: string,
        facets: Array<{ axis: string; value: string; productIds: string[] }>,
      ) => Promise<Record<string, { url: string; role: string } | null>>;
    };
    if (typeof mod.resolveImagesForFacets !== "function") return null;
    return await mod.resolveImagesForFacets(shopDomain, facets);
  } catch (e) {
    console.warn(`[quiz-generate] brand library imagery unavailable for ${shopDomain}: ${(e as Error).message}`);
    return null;
  }
}

/** 4.2 attachment by construction (per-answer templates): every answer
 * arrives with its facet's imagery attached - brand-library resolution
 * first, else the facet's deterministic catalog image. */
function injectAnswerImages(
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
  imagery: Record<string, AnswerFacetImage | null> | null,
  template: TemplateId | null,
): void {
  if (!template || TEMPLATES[template].imageryModel !== "per-answer") return;
  const map = computeAnswerProductMap(config, catalog);
  for (const q of config.questions) {
    for (const opt of q.options ?? []) {
      if (!opt.axisValueValue || opt.selectAll) continue;
      if ((opt.imageUrl ?? "").trim()) continue;
      const key = `${q.axisKey}:${opt.axisValueValue}`;
      opt.imageUrl = imagery?.[key]?.url ?? catalogImageForProducts(map.get(key) ?? [], catalog);
    }
  }
}

/**
 * 5.6 trust statements: verbatim brandProfile.trustStatements (sourced by
 * the brand-profile agent; optional) plus ONE catalog-computed line. Hard
 * ban on fabrication - nothing model-written ever lands here.
 */
function computeTrustLines(profile: BrandProfile | null, catalog: CatalogProduct[]): string[] {
  const lines: string[] = [];
  const verbatim = Array.isArray((profile as unknown as { trustStatements?: unknown })?.trustStatements)
    ? ((profile as unknown as { trustStatements: unknown[] }).trustStatements)
    : [];
  for (const s of verbatim) {
    const t = String(s ?? "").trim();
    if (t) lines.push(t.slice(0, 200));
    if (lines.length >= 3) return lines;
  }
  const inScope = catalog.filter(isLiveProduct);
  if (inScope.length > 0) {
    const shadeCount = inScope.reduce((n, p) => n + p.variants.filter(isLiveVariant).length, 0);
    lines.push(
      shadeCount > inScope.length
        ? `Matching across ${shadeCount} shades`
        : `Matched from ${inScope.length} products`,
    );
  }
  return lines.slice(0, 3);
}

interface PreparedConfig {
  config: GeneratedQuizConfig;
  grounding: GroundingReport;
  imagery: Record<string, AnswerFacetImage | null> | null;
  filledFromBank: number;
  wildcardCount: number;
}

/** The deterministic post-pass every candidate config goes through before
 * validation: grounding-drop, bank fill to the 4-question floor, template
 * max truncation, intro backstop, wildcard slot, imagery resolution. The
 * model proposes, this pass + the validator dispose. */
async function prepareForValidation(args: {
  config: GeneratedQuizConfig;
  catalog: CatalogProduct[];
  shopDomain: string;
  bank: () => GeneratedQuizConfig;
  fillers?: () => FillerCandidate[];
  questionRange: [number, number];
  template: TemplateId | null;
}): Promise<PreparedConfig> {
  const { catalog, shopDomain, questionRange, template } = args;
  const { enforceGrounding } = await import("./quiz-grounding.server");
  const grounded = enforceGrounding(args.config, catalog, null);
  let config = grounded.config;

  const before = config.questions.length;
  config = fillQuestionsToMinimum(config, catalog, args.bank, args.fillers);
  const filledFromBank = config.questions.length - before;
  if (config.questions.length > questionRange[1]) {
    config = { ...config, questions: config.questions.slice(0, questionRange[1]) };
  }
  ensureIntroCopy(config);
  emitWildcardSlot(config, catalog);
  const imagery = await resolveFacetImagery(shopDomain, config, catalog, template);
  injectAnswerImages(config, catalog, imagery, template);
  return {
    config,
    grounding: grounded.report,
    imagery,
    filledFromBank,
    wildcardCount: config.wildcard?.productIds.length ?? 0,
  };
}

// ---------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------

export interface GenerateResult {
  ok: boolean;
  error?: string;
  warnings: string[];
  summary?: { axes: number; questions: number; rules: number; mode: string };
  /** Set when the imagery floor degraded the assigned template to T5
   * Clean (spec 4.3) - already reassigned in the saved settings. */
  degradedTo?: "t5" | null;
  /** v3: the template the saved quiz carries (assigned, merchant-chosen on
   * the scope screen, or degraded) and the generation report the Studio
   * banner + Build screen read (contract §8). */
  template?: TemplateId | null;
  report?: GenerationReport | null;
  usage: ClaudeUsage[];
}

/** Per-step completion event (contract §10): the Build screen advances
 * ONLY on these. Streamed as SSE {type:"step", key, detail, ms}. */
export type GenerationStepEvent = GenerationStep;

/** Tolerate a ```json fence around the object; everything else must parse. */
function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/** `usage` lists every model call made inside this GeneratorCall (one, or
 * two when the max_tokens retry fired); `stopReason` is the final one's. */
export type GeneratorCall =
  | { config: GeneratedQuizConfig; parseErrors: null; rawText: string; usage: ClaudeUsage[]; stopReason: string | null }
  | { config: null; parseErrors: string[]; rawText: string; usage: ClaudeUsage[]; stopReason: string | null };

/** Positive-integer env override in milliseconds, else the fallback. */
function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Hard ceiling on ONE model call (H3). Env QUIZ_GENERATE_CALL_TIMEOUT_MS. */
export const DEFAULT_CALL_TIMEOUT_MS = 300_000;
/** Wall-clock budget for the whole generateQuizConfig (H3): past it, no
 * further model calls (no repair, no imagery repair) - straight to the
 * stock bank. Env QUIZ_GENERATE_BUDGET_MS. */
export const DEFAULT_BUDGET_MS = 540_000;
// A full config is a few thousand output tokens; 20k bounds worst-case
// adaptive-thinking time (32k let slow generations run multiple minutes
// longer for no quality gain).
const GENERATOR_MAX_TOKENS = 20000;

export interface GeneratorCallOpts {
  onToken?: (deltaChars: number) => void;
  /** Sink for merchant-facing warnings raised inside the call (the
   * max_tokens retry). */
  warnings?: string[];
  /** Per-call deadline override (tests); default env / DEFAULT_CALL_TIMEOUT_MS. */
  callTimeoutMs?: number;
}

/** Exported for the unit tests (the max_tokens retry path); production
 * callers are inside generateQuizConfig. */
export async function callGenerator(
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
  shopDomain: string,
  label: string,
  opts: GeneratorCallOpts = {},
): Promise<GeneratorCall> {
  const client = claudeClient();
  const callTimeoutMs = opts.callTimeoutMs ?? envMs("QUIZ_GENERATE_CALL_TIMEOUT_MS", DEFAULT_CALL_TIMEOUT_MS);

  // NOT structured outputs: this schema blows both API grammar caps (24
  // optional / 16 union parameters), which 400s at request validation. The
  // model returns plain JSON text; the fence-strip + zod parse below and the
  // caller's repair round-trip take the place of the grammar. Parse failures
  // are RETURNED (with the raw text) rather than thrown so the caller can
  // send them back for repair exactly like validator failures.
  const runOnce = (thinking: Anthropic.ThinkingConfigParam, attemptLabel: string) =>
    callClaudeWithRetry(async () => {
      // H3: a hard deadline per attempt. The SDK's own timeout is per
      // HTTP read, so a stream that keeps trickling could run unbounded;
      // the abort surfaces as a PERMANENT error (no retry burns a second
      // deadline) and the caller falls back to the stock bank.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeoutMs);
      const startedAt = Date.now();
      try {
        const stream = client.messages.stream(
          {
            model: CLAUDE_MODEL_MAIN,
            max_tokens: GENERATOR_MAX_TOKENS,
            thinking,
            system,
            messages,
          },
          { signal: controller.signal },
        );
        // Live progress for the minutes-long call: without it the client
        // sees a frozen phase string and reads the whole flow as hung.
        if (opts.onToken) stream.on("text", (delta) => opts.onToken!(delta.length));
        const message = await stream.finalMessage();
        console.log(
          `[quiz-generate] ${attemptLabel} shop=${shopDomain} ms=${Date.now() - startedAt} stop=${message.stop_reason} thinking=${thinking.type}`,
        );
        return message;
      } catch (e) {
        if (controller.signal.aborted) {
          console.error(
            `[quiz-generate] ${attemptLabel} shop=${shopDomain} aborted after ${Date.now() - startedAt}ms (deadline ${callTimeoutMs}ms)`,
          );
          throw new GenerationDeadlineError(attemptLabel, callTimeoutMs);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }, attemptLabel);

  let response = await runOnce({ type: "adaptive" }, label);
  const usage: ClaudeUsage[] = [response.usage as ClaudeUsage];
  logClaudeUsage(shopDomain, `${label} stop=${response.stop_reason}`, response.usage as ClaudeUsage);

  if (response.stop_reason === "max_tokens") {
    // M1: a truncated draft is not repair material (the repair round would
    // be spent re-sending a cut-off JSON). Retry the SAME prompt once with
    // extended thinking off: JSON emission doesn't need it, and the budget
    // that thinking consumed goes to the output instead.
    opts.warnings?.push("The first draft was cut off at the token limit; retried without extended thinking");
    console.warn(`[quiz-generate] ${label} shop=${shopDomain} hit max_tokens; retrying with thinking disabled`);
    response = await runOnce({ type: "disabled" }, `${label}-nothink`);
    usage.push(response.usage as ClaudeUsage);
    logClaudeUsage(shopDomain, `${label}-nothink stop=${response.stop_reason}`, response.usage as ClaudeUsage);
    if (response.stop_reason === "max_tokens") {
      throw new Error(`model output was cut off at the ${GENERATOR_MAX_TOKENS}-token limit twice`);
    }
  }
  const stopReason = response.stop_reason ?? null;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error(`empty model response (stop_reason=${response.stop_reason})`);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFences(text));
  } catch {
    return { config: null, parseErrors: ["response was not valid JSON"], rawText: text, usage, stopReason };
  }
  const parsed = GeneratedQuizConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      config: null,
      parseErrors: parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      rawText: text,
      usage,
      stopReason,
    };
  }
  return { config: parsed.data, parseErrors: null, rawText: text, usage, stopReason };
}

export async function generateQuizConfig(args: {
  shopId: string;
  shopDomain: string;
  brief: BrandBrief;
  /** streamedChars (cumulative model output) lets the client render REAL
   * within-phase progress instead of a bar parked at the phase cap. */
  onProgress?: (phase: string, streamedChars?: number) => void;
  /** v3 (contract §10): fired once per REAL step as it completes, with the
   * number the Build screen shows. Never fired ahead of the work. */
  onStep?: (step: GenerationStepEvent) => void;
  /** Brand accent to apply to the saved design settings. Defaults to the
   * Brand Profile's accent token when absent. */
  accentColor?: string | null;
  /** Collection count from the scope screen (report §8). 0 = unknown. */
  collectionCount?: number | null;
}): Promise<GenerateResult> {
  const { shopId, shopDomain, brief, onProgress, onStep } = args;
  const usage: ClaudeUsage[] = [];
  const steps: GenerationStep[] = [];
  const generationStartedAt = Date.now();
  const elapsedMs = () => Date.now() - generationStartedAt;
  // H3 wall-clock budget: once exceeded, no further model calls - repair
  // rounds are skipped and the stock bank takes over. Checked at every
  // decision point that would start a call, never mid-call (the per-call
  // deadline in callGenerator covers that).
  const budgetMs = envMs("QUIZ_GENERATE_BUDGET_MS", DEFAULT_BUDGET_MS);
  let tooSlow = false;
  const overBudget = (): boolean => {
    if (!tooSlow && elapsedMs() > budgetMs) {
      tooSlow = true;
      console.warn(`[quiz-generate] budget exceeded for ${shopDomain}: ${elapsedMs()}ms > ${budgetMs}ms - no further model calls`);
    }
    return tooSlow;
  };
  let stepStartedAt = Date.now();
  const completeStep = (key: GenerationStepKey, detail: string) => {
    const now = Date.now();
    const step: GenerationStep = { key, detail, ms: Math.max(0, now - stepStartedAt) };
    stepStartedAt = now;
    steps.push(step);
    onStep?.(step);
  };

  // Throttled token progress (~1.5s): plain phase text + machine-readable
  // char count. PER-CALL counter — sharing one across generate + repair
  // made the repair phase report inflated counts and froze the client's
  // within-phase progress mapping.
  let lastTokenEmit = 0;
  const tokenProgress = (label: string) => {
    let chars = 0;
    return (deltaChars: number) => {
      chars += deltaChars;
      const now = Date.now();
      if (now - lastTokenEmit > 1500) {
        lastTokenEmit = now;
        onProgress?.(label, chars);
      }
    };
  };

  onProgress?.("Reading your catalog…");
  const fullCatalog = await loadCatalogForShop(shopId);
  // Scope (Overhaul Part 3): generation only ever sees in-scope products,
  // so every question, rule, and annotation is grounded in the subset the
  // merchant picked. Whole-catalog scope keeps the copilot's prompt-cache
  // bytes identical.
  const scopeIds = args.brief.scope?.productIds?.length
    ? new Set(args.brief.scope.productIds)
    : null;
  const catalog = scopeIds ? fullCatalog.filter((p) => scopeIds.has(p.id)) : fullCatalog;
  const activeCount = catalog.filter((p) => p.status == null || p.status === "active").length;
  if (activeCount === 0) {
    // Don't point back at sync: a 0-product (or all-draft) store syncs
    // "successfully", so "sync your catalog first" is a circular dead-end.
    const error =
      catalog.length === 0
        ? "Your store has no synced products. Add products to your Shopify store first — the quiz can only recommend products you actually sell."
        : `Your catalog has ${catalog.length} synced product${catalog.length === 1 ? "" : "s"}, but none are active. Set products to Active in Shopify (not draft or archived), then try again.`;
    return { ok: false, error, warnings: [], usage };
  }

  // Step 1 - catalog. Collections aren't synced; the scope screen counted
  // them live and passes the number through (0 = unknown, never invented).
  const collectionCount = Math.max(0, Math.floor(Number(args.collectionCount ?? 0)) || 0);
  completeStep("catalog", stepDetail.catalog(activeCount, collectionCount));

  // Machine-derived brief resolution (spec v2 Part 0.1, failure 4): the
  // Brand Profile is the source of truth for category and voice. The
  // client's values are themselves profile-sourced by the build screen;
  // both fall back to neutral defaults, never to merchant free text.
  const profile = await loadBrandProfileSafe(shopDomain);
  const resolvedBrief: BrandBrief = {
    ...brief,
    category: (profile?.category ?? "").trim() || brief.category || "beauty products",
    brandVoice:
      (profile?.tone ? TONE_VOICE[profile.tone] : null) ?? (brief.brandVoice || "warm and confident"),
  };
  // Template: the Brand Profile's assignment (spec 2.4), unless the scope
  // screen persisted a merchant choice that is still eligible (t5 always).
  // The persisted column is only consulted here for shops that have no real
  // quiz yet - the save guard below refuses everyone else before any write.
  const profileTemplate: TemplateId | null =
    profile?.templateAssignment?.template &&
    (TEMPLATE_IDS as string[]).includes(profile.templateAssignment.template)
      ? (profile.templateAssignment.template as TemplateId)
      : null;
  const existingConfig = await captureLiveConfigSafe(shopId);
  const persistedTemplate = existingConfig?.settings.quiz_template ?? null;
  let assignedTemplate: TemplateId | null = profileTemplate;
  let templateSource: "profile" | "merchant" = "profile";
  if (isTemplateId(persistedTemplate) && persistedTemplate !== profileTemplate) {
    let eligible = persistedTemplate === "t5";
    if (!eligible && profile) {
      try {
        const { templateSignalsFromProfile } = await import("./brand-profile.server");
        eligible = isTemplateEligible(persistedTemplate, templateSignalsFromProfile(profile));
      } catch {
        eligible = false;
      }
    }
    if (eligible) {
      assignedTemplate = persistedTemplate;
      templateSource = "merchant";
    }
  }
  const questionRange: [number, number] = assignedTemplate
    ? TEMPLATES[assignedTemplate].questionRange
    : [MIN_QUESTIONS_FLOOR, 6];

  // Step 2 - theme. Font only when it really came from the theme/homepage;
  // colors only when extracted (presets never count).
  const headingFont = headingFontFromProfile(profile);
  const extractedColors = extractedColorsFromProfile(profile);
  completeStep("theme", stepDetail.theme(headingFont.name, extractedColors.length));
  const accentColor =
    args.accentColor ?? (profile?.sources?.colorAccent?.source !== "preset" ? profile?.tokens?.colorAccent ?? null : null);

  // NO per-call serializeCatalog options: the copilot reuses these exact
  // bytes as its cached system prefix, so any argument that reorders the
  // catalog (e.g. priority products) would split the prompt cache. Priority
  // products are expressed in the volatile brief text instead.
  const { text: catalogText, truncated } = serializeCatalog(catalog);
  const system = buildSystemBlocks(catalogText);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: briefToPrompt(resolvedBrief, questionRange, assignedTemplate) },
  ];

  // L4: the step clock measures the LLM phase from here, so questions.ms
  // is drafting time, not drafting plus the theme/catalog prep before it.
  stepStartedAt = Date.now();
  onProgress?.("Drafting your quiz…");
  // Exactly ONE repair round-trip total, spent on whichever failure comes
  // first: a schema-parse miss (free-form JSON), a validation miss, or an
  // imagery miss. An LLM HARD failure never dead-ends: the archetype stock
  // bank instantiates a catalog-grounded quiz instead (fallback_generation)
  // so the merchant still lands on a Reveal (Overhaul Part 3).
  const { archetypeForCategory, stockConfigFromCatalog, universalFillerCandidates } = await import(
    "./quiz-archetypes.server"
  );
  const archetype = archetypeForCategory(resolvedBrief.category || null);
  const bank = () => stockConfigFromCatalog(archetype, catalog, null);
  const fillers = () => universalFillerCandidates(archetype, catalog, null);

  let config: GeneratedQuizConfig | null = null;
  let repairUsed = false;
  let fallbackGeneration = false;
  // Set when the fallback happened because of TIME (per-call deadline or
  // the whole-run budget) rather than a model/parse failure - the merchant
  // warning says so instead of "AI generation unavailable".
  let fallbackBecauseSlow = false;
  const llmFailures: string[] = [];
  const callWarnings: string[] = [];
  try {
    let call = await callGenerator(system, messages, shopDomain, "quiz-generate", {
      onToken: tokenProgress("Drafting your quiz…"),
      warnings: callWarnings,
    });
    usage.push(...call.usage);
    if (call.parseErrors && overBudget()) {
      llmFailures.push(`model output malformed (${call.parseErrors[0]}) and the time budget is spent`);
      fallbackBecauseSlow = true;
    } else if (call.parseErrors) {
      onProgress?.("Fixing a few issues…", 0);
      repairUsed = true;
      messages.push(
        { role: "assistant", content: call.rawText },
        {
          role: "user",
          content:
            `Your response did not match the documented config JSON. Fix ONLY these issues and return the full corrected JSON object:\n- ` +
            call.parseErrors.join("\n- "),
        },
      );
      call = await callGenerator(system, messages, shopDomain, "quiz-generate-repair", {
        onToken: tokenProgress("Fixing a few issues…"),
        warnings: callWarnings,
      });
      usage.push(...call.usage);
      if (call.parseErrors) {
        llmFailures.push(`model output stayed malformed (${call.parseErrors[0]})`);
      }
    }
    if (!llmFailures.length) config = call.config!;
  } catch (e) {
    llmFailures.push((e as Error).message);
    if (e instanceof GenerationDeadlineError) fallbackBecauseSlow = true;
  }

  if (!config) {
    config = bank();
    fallbackGeneration = true;
    console.warn(
      `[quiz-generate] LLM fallback for ${shopDomain} (${llmFailures[0] ?? "?"}) — stock bank ${archetype} at ${elapsedMs()}ms`
    );
  }

  // Deterministic post-pass + the one-pass v2 validator (spec 5.2): three
  // floors per answer (products, reachability, imagery), the 4-question
  // hard floor, intro assertion, and 100%-coverage-or-wildcard.
  const prepareArgs = { catalog, shopDomain, bank, fillers, questionRange, template: assignedTemplate };
  let prepared = await prepareForValidation({ config, ...prepareArgs });
  const floorOpts = () => ({
    floors: { templateId: assignedTemplate, imagery: prepared.imagery },
  });
  let result = validateGeneratedConfig(prepared.config, catalog, floorOpts());

  if (!result.ok && !repairUsed && overBudget()) {
    // No time for a repair round: the bank last-resort below takes over.
    fallbackBecauseSlow = true;
  } else if (!result.ok && !repairUsed) {
    // One repair round-trip: send the validator errors back.
    repairUsed = true;
    onProgress?.("Fixing a few issues…", 0);
    messages.push(
      { role: "assistant", content: JSON.stringify(prepared.config) },
      {
        role: "user",
        content:
          `Your config failed validation. Fix ONLY these issues and return the full corrected config:\n- ` +
          result.errors.slice(0, 20).join("\n- "),
      },
    );
    try {
      const repaired = await callGenerator(system, messages, shopDomain, "quiz-generate-repair", {
        onToken: tokenProgress("Fixing a few issues…"),
        warnings: callWarnings,
      });
      usage.push(...repaired.usage);
      if (repaired.parseErrors) {
        return {
          ok: false,
          error: `Repair attempt failed: ${repaired.parseErrors[0]}`,
          warnings: result.warnings,
          usage,
        };
      }
      prepared = await prepareForValidation({ config: repaired.config!, ...prepareArgs });
      result = validateGeneratedConfig(prepared.config, catalog, floorOpts());
    } catch (e) {
      return { ok: false, error: `Repair attempt failed: ${(e as Error).message}`, warnings: result.warnings, usage };
    }
  }

  // M5: an imagery repair can only help when the catalog (or the library)
  // owns at least one image to re-anchor onto; otherwise it is a paid
  // round that lands on the same degrade.
  const anyImageryAvailable = (): boolean =>
    Object.values(prepared.imagery ?? {}).some((e) => Boolean(e?.url)) ||
    catalogImageForProducts(catalog.filter(isLiveProduct).map((p) => p.id), catalog) !== null;

  // Imagery misses never hard-fail (spec 5 delta / 4.3): spend the repair
  // budget re-anchoring failing answers to facets that have imagery when
  // it's still unspent; otherwise accept degradation to T5 Clean below.
  if (
    result.ok &&
    result.degradedTo &&
    !repairUsed &&
    !fallbackGeneration &&
    result.imageryFailures?.length &&
    anyImageryAvailable() &&
    !overBudget()
  ) {
    repairUsed = true;
    onProgress?.("Fixing a few issues…", 0);
    messages.push(
      { role: "assistant", content: JSON.stringify(prepared.config) },
      {
        role: "user",
        content:
          `Some answers have no product imagery behind them. Replace ONLY those answers with options grounded in catalog facets whose products have images (keep everything else identical) and return the full config:\n- ` +
          result.imageryFailures.slice(0, 20).join("\n- "),
      },
    );
    try {
      const repaired = await callGenerator(system, messages, shopDomain, "quiz-generate-repair", {
        onToken: tokenProgress("Fixing a few issues…"),
        warnings: callWarnings,
      });
      usage.push(...repaired.usage);
      if (!repaired.parseErrors) {
        const prepared2 = await prepareForValidation({ config: repaired.config!, ...prepareArgs });
        const result2 = validateGeneratedConfig(prepared2.config, catalog, {
          floors: { templateId: assignedTemplate, imagery: prepared2.imagery },
        });
        // Only adopt a strict improvement; otherwise keep the original and
        // let the degradation path handle it.
        if (result2.ok && !result2.degradedTo) {
          prepared = prepared2;
          result = result2;
        }
      }
    } catch {
      /* keep the original result; degrade below */
    }
  }

  // Last resort before erroring: the stock bank through the same
  // post-pass - grounded by construction, so the merchant still lands on
  // a Reveal instead of a dead-end.
  if (!result.ok && !fallbackGeneration) {
    prepared = await prepareForValidation({ config: bank(), ...prepareArgs });
    result = validateGeneratedConfig(prepared.config, catalog, floorOpts());
    if (result.ok) fallbackGeneration = true;
  }
  if (!result.ok) {
    return {
      ok: false,
      error: `Generated config is invalid even after repair: ${result.errors.slice(0, 5).join("; ")}`,
      warnings: result.warnings,
      usage,
    };
  }

  const grounded = prepared.grounding;
  const warnings = [...callWarnings, ...result.warnings];
  if (grounded.droppedAnswers.length) {
    warnings.push(
      `Grounding dropped ${grounded.droppedAnswers.length} answer(s) that matched fewer than ${grounded.floor} products` +
        (grounded.droppedQuestions.length
          ? ` and ${grounded.droppedQuestions.length} question(s)`
          : "")
    );
  }
  if (prepared.filledFromBank > 0) {
    warnings.push(
      `Added ${prepared.filledFromBank} question(s) from the stock bank to reach the ${MIN_QUESTIONS_FLOOR}-question minimum`
    );
  }
  if (prepared.wildcardCount > 0) {
    warnings.push(
      `${prepared.wildcardCount} product(s) matched no specific answer path and were parked in the "everything else" slot`
    );
  }
  if (fallbackGeneration) {
    warnings.push(
      fallbackBecauseSlow || tooSlow
        ? "AI generation took too long; built from the stock bank — the copilot can restyle it any time"
        : "Built from the stock question bank (AI generation unavailable) — the copilot can restyle it any time",
    );
  }
  if (truncated > 0) warnings.push(`Catalog truncated: ${truncated} products were not shown to the AI`);

  const draft = result.draft! as unknown as QuizDraft;

  // Imagery degradation (spec 4.3): reassign to T5 Clean in the saved
  // settings; publishing is NEVER blocked by imagery. T4 is never a
  // fallback - degradation always lands on T5.
  const degradedTo = result.degradedTo ?? null;
  const degraded = Boolean(degradedTo && assignedTemplate && assignedTemplate !== "t5");
  const finalTemplate: TemplateId = degraded ? "t5" : (assignedTemplate ?? "t5");
  // The saved quiz always carries its template (NULL would mean legacy
  // rendering). Safe by construction: the locked save below refuses any
  // shop that already has real quiz content, so this never touches a live
  // merchant's template.
  (draft.settings as Record<string, unknown>).quiz_template = finalTemplate;
  if (degraded) {
    warnings.push(
      `Not enough imagery for the ${TEMPLATES[assignedTemplate!].name} template - the quiz uses ${TEMPLATES.t5.name} instead. Add images later from the Studio's Images rail.`
    );
  }

  // Step 3 - questions (+ phases, Match only). Phases are resolved against
  // the FINAL question list: the post-pass may have dropped or added
  // questions since the model proposed its grouping.
  const finalConfig = prepared.config;
  const axisLabels: Record<string, string> = {};
  for (const a of finalConfig.axes) axisLabels[a.key] = a.label;
  const phases: QuizPhase[] | null =
    finalTemplate === "t1" ? resolvePhases(finalConfig.questions, finalConfig.phases ?? null, axisLabels) : null;
  completeStep("questions", stepDetail.questions(finalConfig.questions.length, phases?.length ?? 0));

  // Step 4 - paths: products reachable through an answer path, plus the
  // wildcard slot (the validator guarantees the union is 100%).
  const inScopeLive = catalog.filter(isLiveProduct);
  const answerMap = computeAnswerProductMap(finalConfig, catalog);
  const answerCounts: Record<string, number> = {};
  const reachedIds = new Set<string>();
  for (const [key, ids] of answerMap) {
    answerCounts[key] = ids.size;
    for (const id of ids) reachedIds.add(id);
  }
  const inScopeIds = new Set(inScopeLive.map((p) => p.id));
  for (const id of finalConfig.wildcard?.productIds ?? []) if (inScopeIds.has(id)) reachedIds.add(id);
  const reached = [...reachedIds].filter((id) => inScopeIds.has(id)).length;
  completeStep("paths", stepDetail.paths(reached, inScopeLive.length));

  // Step 5 - images: declared non-optional slots resolved by an answer's
  // own image or a merchant-placed quiz_image_slots entry.
  const reportFlow = {
    questions: finalConfig.questions.map((q) => ({
      axisKey: q.axisKey,
      prompt: q.prompt,
      options: (q.options ?? []).map((o) => ({
        label: o.label,
        axisValueValue: o.axisValueValue,
        imageUrl: o.imageUrl ?? null,
        selectAll: Boolean(o.selectAll),
        displayMeta: o.displayMeta ?? null,
      })),
    })),
  };
  const existingSlots = existingConfig?.settings.quiz_image_slots ?? null;
  let slotCount = { placed: 0, total: 0 };
  try {
    slotCount = countImageSlots(finalTemplate, reportFlow, existingSlots, {
      autoResolved: {
        // L1: stored pre-v3 profiles can lack `brand` entirely.
        hero: existingConfig?.settings.quiz_hero_image ?? profile?.brand?.coverImageUrl ?? null,
      },
    });
  } catch (e) {
    console.warn(`[quiz-generate] image slot count failed for ${shopDomain}: ${(e as Error).message}`);
  }
  completeStep("images", stepDetail.images(slotCount.placed, slotCount.total));

  // 5.6 trust lines: verbatim brand-profile statements + catalog-computed
  // scale line, never model output. (quiz_trust_lines persists once its
  // settings column lands; the save path drops-with-log until then.)
  const trustLines = computeTrustLines(profile, catalog);
  if (trustLines.length > 0) {
    (draft.settings as Record<string, unknown>).quiz_trust_lines = trustLines;
  }

  // NOT enabled here: save-to-live means this write IS the site config, and
  // generation must never flip the storefront surface on as a side effect.
  // The studio's Live step owns the on/off toggle; assistant_mode is set
  // there too when the merchant turns it on.
  if (accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    (draft.settings as Record<string, unknown>).quiz_accent_color = accentColor;
  }
  // The v3 jsonb columns (quiz_phases, quiz_generation_report; migration
  // 080) are written in their OWN call after the save, never inside this
  // settings upsert: an unrun migration must degrade to a missing banner,
  // not turn a saved quiz into a reported failure. quiz_founder stays
  // null (intro type E default).
  // Scope narrows serving too, not just generation: the recommender's
  // candidate pool honors product_scope 'selected'.
  if (scopeIds) {
    (draft.settings as Record<string, unknown>).product_scope = "selected";
    (draft.settings as Record<string, unknown>).selected_product_ids = [...scopeIds];
  }
  // L4: "Saving" is announced only once the three real steps have been
  // reported, so the Build screen never shows the save phase ahead of them.
  onProgress?.("Saving your quiz…");
  // Locked save with an overwrite guard: generation runs for a minute or
  // more, and the unconditional save could stomp a quiz the merchant
  // created or meaningfully edited in that window (or in another tab).
  const saved = await withShopSaveLock(shopId, async () => {
    const existing = await captureLiveConfig(shopId);
    const hasRealContent = existing.flow.questions.some((q) => q.prompt.trim() !== "");
    if (hasRealContent) {
      return {
        ok: false as const,
        error: "This store already has a quiz with content — edit it in the studio instead of generating over it.",
      };
    }
    return saveLiveQuizConfig(shopId, draft, {
      snapshotLabel: "before generated quiz",
      forceSnapshot: true,
      preWriteConfig: existing,
    });
  });
  if (!saved.ok) return { ok: false, error: `Save failed: ${saved.error}`, warnings, usage };

  // L1: the quiz is saved; the report is best-effort from here. A report
  // build failure (a stored pre-v3 profile missing a field, say) must
  // never turn a saved quiz into a reported failure.
  let report: GenerationReport | null = null;
  try {
    report = buildGenerationReport({
      productCount: inScopeLive.length,
      collectionCount,
      flow: reportFlow,
      answerCounts,
      groundingFloor: grounded.floor,
      phases,
      profile,
      template: finalTemplate,
      degradedFrom: degraded ? assignedTemplate : null,
      imageSlots: existingSlots,
      hasFounder: false, // quiz_founder stays null (Q13 default → intro type E)
      steps,
    });
  } catch (e) {
    console.warn(`[quiz-generate] report build failed for ${shopDomain}: ${(e as Error).message}`);
    warnings.push("The generation report could not be built; the Studio banner will use its fallback line.");
  }
  // Generator-owned v3 columns, written directly (see above). A failure
  // here (e.g. migration 080 not yet run) is a warning, not a lost quiz.
  try {
    await saveChatAssistantConfig(shopDomain, {
      quiz_template: finalTemplate,
      quiz_phases: phases && phases.length ? phases : null,
      quiz_generation_report: report ? (report as unknown as Record<string, unknown>) : null,
    });
  } catch (e) {
    console.warn(`[quiz-generate] report write failed for ${shopDomain}: ${(e as Error).message}`);
    warnings.push("The generation report could not be saved; the Studio banner will use its fallback line.");
  }

  // Recommendation Logic Spec v2: a brand-new quiz runs on its answer
  // sentences, so draft them ACTIVE now. Fire-and-forget: it never delays
  // or fails generation, and ensureAnswerRules serializes per shop, so the
  // Studio opening on this quiz waits for these drafts instead of writing
  // display-only ones.
  void import("./answer-rules.server")
    .then(({ ensureAnswerRules }) => ensureAnswerRules({ shopId, shopDomain, forceActive: true }))
    .catch((e) => console.warn(`[quiz-generate] answer sentence draft failed for ${shopDomain}: ${(e as Error).message}`));

  console.log(
    `[quiz-generate] done shop=${shopDomain} total=${elapsedMs()}ms calls=${usage.length} fallback=${fallbackGeneration} ` +
      `repair=${repairUsed} tooSlow=${tooSlow || fallbackBecauseSlow} steps=${steps.map((s) => `${s.key}:${s.ms}`).join(",")}`,
  );

  // Part 6/8: generation_completed with the properties the funnel needs,
  // plus a template_assigned degrade event (L2 shape: {template,
  // degraded_from, reason, signals: []}).
  const { trackOverhaulEvent } = await import("./overhaul-events.server");
  if (degradedTo && assignedTemplate && assignedTemplate !== "t5") {
    trackOverhaulEvent(shopDomain, "template_assigned", {
      template: "t5",
      degraded_from: assignedTemplate,
      reason: "imagery_floor",
      signals: [],
    });
  }
  trackOverhaulEvent(shopDomain, "generation_completed", {
    fallback_generation: fallbackGeneration,
    scope_kind: brief.scope?.kind ?? "all",
    questions: draft.flow.questions.length,
    rules: draft.flow.rules.length,
    reachability: Math.round(grounded.reachability * 100) / 100,
    dropped_answers: grounded.droppedAnswers.length,
    template: finalTemplate,
    template_source: templateSource,
    degraded_to: degradedTo,
    phases: phases?.length ?? 0,
    bank_filled: prepared.filledFromBank,
    wildcard_products: prepared.wildcardCount,
    images_placed: slotCount.placed,
    images_total: slotCount.total,
  });

  return {
    ok: true,
    warnings,
    summary: {
      axes: draft.flow.axes.length,
      questions: draft.flow.questions.length,
      rules: draft.flow.rules.length,
      mode: String((draft.settings as Record<string, unknown>).recommendation_mode ?? "?"),
    },
    degradedTo,
    template: finalTemplate,
    report,
    usage,
  };
}

/** The live config read OUTSIDE the save lock, for template/look/slot
 * inputs only. The guarded save re-reads under the lock before writing. */
async function captureLiveConfigSafe(shopId: string): Promise<QuizDraft | null> {
  try {
    return await captureLiveConfig(shopId);
  } catch (e) {
    console.warn(`[quiz-generate] live config unavailable for ${shopId}: ${(e as Error).message}`);
    return null;
  }
}
