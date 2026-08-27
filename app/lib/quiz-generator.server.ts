// AI quiz generation (Phase 5): brand brief + synced catalog -> draft quiz.
//
// Writes DRAFTS ONLY (quiz-draft.server.ts); the merchant reviews and
// publishes. On validation failure there is exactly one repair round-trip
// (validator errors are sent back to the model) before giving up with a
// friendly error.
//
// Prompt-cache structure (shared byte-identical with the copilot so both
// surfaces hit the same cache entry):
//   system[0] role + generation rules            (stable)
//   system[1] quiz schema documentation          (stable)
//   system[2] serialized catalog + cache_control (stable per catalog sync)
//   ...everything volatile (brief, conversation) comes after the breakpoint.

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  claudeClient,
  callClaudeWithRetry,
  logClaudeUsage,
  CLAUDE_MODEL_MAIN,
  type ClaudeUsage,
} from "./claude.server";
import {
  GeneratedQuizConfigSchema,
  validateGeneratedConfig,
  serializeCatalog,
  type CatalogProduct,
  type GeneratedQuizConfig,
} from "./quiz-config-schema.server";
import { saveQuizDraft, type QuizDraft } from "./quiz-draft.server";
import { supabase, getVariantsForProducts, getChatAssistantConfig } from "./supabase.server";

export interface BrandBrief {
  category: string; // "nail polish", "hair extensions", ...
  brandVoice: string; // "playful and bold", "clean and clinical", ...
  quizLength: "short" | "standard";
  modePreference: "matrix" | "ai" | "hybrid" | "auto";
  extraNotes?: string;
  priorityProductIds?: string[];
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
    variants: (variantsByProduct.get(p.id) ?? []).map((v) => ({
      id: v.id,
      title: v.variant_title ?? "",
      displayColor: v.display_color ?? null,
      price: v.price ?? null,
      status: v.status ?? null,
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
- Generate at most 8 questions; each question has 2-8 options. (Existing hand-built quizzes may exceed this; never generate beyond it yourself.)
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
- designTokens: quiz_accent_color/quiz_ink_color/quiz_card_bg_color/quiz_line_color/quiz_cta_color (hex), quiz_button_radius/quiz_card_radius (px numbers), quiz_progress_style (pips|bar|counter|none), quiz_intro_layout (split|centered), quiz_animation_style (full|minimal|off).`;

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

function briefToPrompt(brief: BrandBrief): string {
  return [
    `Design a complete quiz for this store.`,
    `Category: ${brief.category}`,
    `Brand voice: ${brief.brandVoice}`,
    `Quiz length: ${brief.quizLength === "short" ? "short (3-4 questions)" : "standard (5-7 questions)"}`,
    `Recommendation mode preference: ${brief.modePreference === "auto" ? "you decide based on the catalog" : brief.modePreference}`,
    brief.priorityProductIds?.length
      ? `Priority products (feature these prominently): ${brief.priorityProductIds.map((id) => `p:${id}`).join(", ")}`
      : "",
    brief.extraNotes ? `Merchant notes: ${brief.extraNotes}` : "",
    `Return the full quiz config.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------

export interface GenerateResult {
  ok: boolean;
  error?: string;
  warnings: string[];
  summary?: { axes: number; questions: number; rules: number; mode: string };
  usage: ClaudeUsage[];
}

async function callGenerator(
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
  shopDomain: string,
  label: string,
): Promise<{ config: GeneratedQuizConfig; usage: ClaudeUsage }> {
  const client = claudeClient();
  const response = await callClaudeWithRetry(async () => {
    const stream = client.messages.stream({
      model: CLAUDE_MODEL_MAIN,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(GeneratedQuizConfigSchema) },
      system,
      messages,
    });
    return stream.finalMessage();
  }, label);

  logClaudeUsage(shopDomain, label, response.usage as ClaudeUsage);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error(`empty model response (stop_reason=${response.stop_reason})`);

  const parsed = GeneratedQuizConfigSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`model output failed schema parse: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`);
  }
  return { config: parsed.data, usage: response.usage as ClaudeUsage };
}

export async function generateQuizConfig(args: {
  shopId: string;
  shopDomain: string;
  brief: BrandBrief;
  onProgress?: (phase: string) => void;
}): Promise<GenerateResult> {
  const { shopId, shopDomain, brief, onProgress } = args;
  const usage: ClaudeUsage[] = [];

  onProgress?.("Reading your catalog…");
  const catalog = await loadCatalogForShop(shopId);
  const activeCount = catalog.filter((p) => p.status == null || p.status === "active").length;
  if (activeCount === 0) {
    return { ok: false, error: "No products found. Sync your catalog first.", warnings: [], usage };
  }

  // NO per-call serializeCatalog options: the copilot reuses these exact
  // bytes as its cached system prefix, so any argument that reorders the
  // catalog (e.g. priority products) would split the prompt cache. Priority
  // products are expressed in the volatile brief text instead.
  const { text: catalogText, truncated } = serializeCatalog(catalog);
  const system = buildSystemBlocks(catalogText);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: briefToPrompt(brief) }];

  onProgress?.("Drafting your quiz…");
  let config: GeneratedQuizConfig;
  try {
    const first = await callGenerator(system, messages, shopDomain, "quiz-generate");
    usage.push(first.usage);
    config = first.config;
  } catch (e) {
    return { ok: false, error: `Generation failed: ${(e as Error).message}`, warnings: [], usage };
  }

  let result = validateGeneratedConfig(config, catalog);

  if (!result.ok) {
    // One repair round-trip: send the validator errors back.
    onProgress?.("Fixing a few issues…");
    messages.push(
      { role: "assistant", content: JSON.stringify(config) },
      {
        role: "user",
        content:
          `Your config failed validation. Fix ONLY these issues and return the full corrected config:\n- ` +
          result.errors.slice(0, 20).join("\n- "),
      },
    );
    try {
      const repaired = await callGenerator(system, messages, shopDomain, "quiz-generate-repair");
      usage.push(repaired.usage);
      result = validateGeneratedConfig(repaired.config, catalog);
    } catch (e) {
      return { ok: false, error: `Repair attempt failed: ${(e as Error).message}`, warnings: result.warnings, usage };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: `Generated config is invalid even after repair: ${result.errors.slice(0, 5).join("; ")}`,
        warnings: result.warnings,
        usage,
      };
    }
  }

  const warnings = [...result.warnings];
  if (truncated > 0) warnings.push(`Catalog truncated: ${truncated} products were not shown to the AI`);

  onProgress?.("Saving your draft…");
  const draft = result.draft! as unknown as QuizDraft;

  // Activation: a published quiz that stays invisible reads as broken. Turn
  // the quiz surface on in the draft settings, preserving chat for shops
  // that run it ('chat' becomes 'both', never silently killing the bubble).
  try {
    const current = await getChatAssistantConfig(shopDomain);
    (draft.settings as Record<string, unknown>).enabled = true;
    (draft.settings as Record<string, unknown>).assistant_mode =
      current.assistant_mode === "chat" || current.assistant_mode === "both" ? "both" : "quiz";
  } catch {
    (draft.settings as Record<string, unknown>).enabled = true;
    (draft.settings as Record<string, unknown>).assistant_mode = "quiz";
  }
  const saved = await saveQuizDraft(shopId, draft, "ai");
  if (!saved.ok) return { ok: false, error: `Draft save failed: ${saved.error}`, warnings, usage };

  return {
    ok: true,
    warnings,
    summary: {
      axes: draft.flow.axes.length,
      questions: draft.flow.questions.length,
      rules: draft.flow.rules.length,
      mode: String((draft.settings as Record<string, unknown>).recommendation_mode ?? "?"),
    },
    usage,
  };
}
