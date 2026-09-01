// Recommendation-logic guidance compiler (self-serve overhaul).
//
// Takes the merchant's per-question merchandising notes (quiz_question_guidance,
// migration 059) plus the live question structure and synced catalog, and has
// Claude compile them into a single ranking rulebook in the shape of the
// hand-written ORLY guidance (scripts/orly-guidance.cjs): ordered LAYER RULES
// sections followed by PRODUCT FACTS.
//
// Generation SAVES NOTHING — the result rides back to the logic page for
// review; the merchant applies it to chat_assistant_config.ai_guidance
// explicitly. The storefront runtime contract is untouched: ai_guidance is
// injected verbatim into the Gemini ranker prompt as before.
//
// Prompt-cache structure (own cache entry, same discipline as quiz-generator):
//   system[0] role + output format skeleton       (stable)
//   system[1] serialized catalog + cache_control  (stable per catalog sync)
//   ...volatile input (questions, notes, settings) in the user message.

import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  claudeClient,
  callClaudeWithRetry,
  logClaudeUsage,
  CLAUDE_MODEL_MAIN,
  type ClaudeUsage,
} from "./claude.server";
import { serializeCatalog } from "./quiz-config-schema.server";
import { loadCatalogForShop } from "./quiz-generator.server";
import { captureLiveConfig, getQuizDraft } from "./quiz-draft.server";
import { getQuestionGuidance, getChatAssistantConfig } from "./supabase.server";
import { GENERAL_GUIDANCE_KEY } from "./quiz-guidance-shared";

const GuidanceOutputSchema = z.object({
  // The full rulebook, saved verbatim to ai_guidance on apply.
  guidanceText: z.string(),
  // 1-2 sentences per question for the review UI: how this question now
  // steers ranking.
  perQuestionSummary: z.array(
    z.object({
      axisKey: z.string(),
      summary: z.string(),
    }),
  ),
  // Gaps the merchant should know about: unanswered questions, notes that
  // name unknown products, ambiguous instructions.
  warnings: z.array(z.string()),
});

export type GuidanceOutput = z.infer<typeof GuidanceOutputSchema>;

const ROLE_BLOCK = `You compile a merchant's merchandising notes into a ranking rulebook for an LLM product ranker behind a Shopify "find my fit" quiz. At runtime the ranker receives: the shopper's quiz answers, a JSON array of candidate products, and your rulebook VERBATIM as part of its instructions. Your rulebook is the merchant's merchandising brain — write it so a ranker that has never seen this store ranks like the merchant would.

OUTPUT FORMAT for guidanceText — plain text, ALL-CAPS section headers, in this order:
1. One opening line naming the quiz and ending with: "Apply these rules in order; higher rules win conflicts."
2. RESULT SHAPE: how many results to return and any structure the merchant wants (e.g. best matches first, a wildcard slot, bundles). Derive the count from the settings given.
3. SHOPPER PICKS ARE HARD PREFERENCES: which quiz answers are hard constraints every top pick must satisfy, and which are soft. Say explicitly that "open to anything"-style answers add no constraint.
4. One profile section per quiz question (header = the question topic in caps): for each answer value, which products, product traits, or collections to prefer. Use the merchant's notes as the source of truth; where notes are thin, fill in conservatively from the catalog.
5. When a question modifies other answers rather than selecting products (e.g. intensity, budget), write it as a modifier section applied on top of the profiles.
6. ASSEMBLY: how to fill the final slots — priority/bestseller placement, variety across products, tie-breaking.
7. RELAXATION: an ordered ladder of which constraints to drop, one at a time, when too few products qualify.
8. PRODUCT FACTS: one line per catalog product with the traits your rules reference (only traits evident from the catalog data or the merchant's notes). If the catalog is large, cover every product the rules name explicitly plus a representative line per product family, and say how to judge unlisted products.

HARD RULES:
- Never invent products, traits, or collections. Every product name in the rulebook must exist in the catalog listing. If the merchant's notes mention a product you cannot find, keep the intent as a generic rule and add a warning naming it.
- Only reference quiz answers (axis values) that exist in the question structure given.
- Write imperative, specific rules — no marketing copy, no hedging. The ranker judges ONLY from candidate data plus this rulebook.
- If a question has no merchant notes, write a sensible neutral profile from the catalog and add a warning that the merchant should fill in notes for it.
- Do not contradict the merchant's notes; when two notes conflict, follow the more specific one and add a warning.
- Keep guidanceText under 20000 characters.`;

export interface GenerateGuidanceResult {
  ok: boolean;
  error?: string;
  warnings: string[];
  guidanceText?: string;
  perQuestionSummary?: Array<{ axisKey: string; summary: string }>;
  usage: ClaudeUsage[];
}

/** Volatile user message: question structure + merchant notes + settings. */
function buildInputMessage(args: {
  flow: Awaited<ReturnType<typeof captureLiveConfig>>["flow"];
  notes: Record<string, string>;
  numRecommendations: number;
  priorityProductIds: string[];
  previousGuidance: string;
}): string {
  const { flow, notes, numRecommendations, priorityProductIds, previousGuidance } = args;

  const questionLines = flow.questions.map((q, i) => {
    const opts = q.options
      .map((o) => `    - ${o.axisValueValue}: "${o.label}"${o.selectAll ? " (open to anything)" : ""}`)
      .join("\n");
    const note = notes[q.axisKey]?.trim();
    return [
      `Question ${i + 1} [${q.axisKey}]${q.multiSelect ? " (multi-select)" : ""}: "${q.prompt}"`,
      `  Answers:`,
      opts,
      `  Merchant notes: ${note ? note : "(none — fill in conservatively and warn)"}`,
    ].join("\n");
  });

  const photoAxes = flow.axes.filter((a) => a.source === "photo");
  const photoLines = photoAxes.map((a) => {
    const note = notes[a.key]?.trim();
    const values = a.values.map((v) => v.value).join(", ");
    return `Photo-detected trait [${a.key}] "${a.label}" (values: ${values}). Merchant notes: ${note || "(none)"}`;
  });

  return [
    `Compile the ranking rulebook for this store.`,
    ``,
    `QUIZ QUESTIONS AND MERCHANT NOTES:`,
    ...questionLines,
    ...(photoLines.length > 0 ? ["", ...photoLines] : []),
    ``,
    `STORE-WIDE MERCHANT NOTES: ${notes[GENERAL_GUIDANCE_KEY]?.trim() || "(none)"}`,
    ``,
    `SETTINGS: show ${numRecommendations} recommendations.` +
      (priorityProductIds.length > 0
        ? ` Priority products the store wants surfaced: ${priorityProductIds.map((id) => `p:${id}`).join(", ")}.`
        : ""),
    previousGuidance.trim()
      ? `\nPREVIOUS GUIDANCE (for reference only — REWRITE from the notes above, don't merely append):\n${previousGuidance}`
      : "",
    ``,
    `Return guidanceText, perQuestionSummary (one entry per quiz question, keyed by the [axis_key] shown above), and warnings.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function callCompiler(
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
  shopDomain: string,
  label: string,
): Promise<{ output: GuidanceOutput; usage: ClaudeUsage }> {
  const client = claudeClient();
  const response = await callClaudeWithRetry(async () => {
    const stream = client.messages.stream({
      model: CLAUDE_MODEL_MAIN,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(GuidanceOutputSchema) },
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

  const parsed = GuidanceOutputSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `model output failed schema parse: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`,
    );
  }
  return { output: parsed.data, usage: response.usage as ClaudeUsage };
}

export async function generateGuidance(args: {
  shopId: string;
  shopDomain: string;
  /** "draft" compiles against the quiz DRAFT (Studio); "live" (default)
   * against the published config. Matters because draft axis keys and
   * questions can differ from live, and summaries/warnings must reference
   * what the merchant is actually looking at. */
  source?: "live" | "draft";
  onProgress?: (phase: string) => void;
}): Promise<GenerateGuidanceResult> {
  const { shopId, shopDomain, source = "live", onProgress } = args;
  const usage: ClaudeUsage[] = [];

  onProgress?.("Reading your catalog…");
  const catalog = await loadCatalogForShop(shopId);
  const activeCount = catalog.filter((p) => p.status == null || p.status === "active").length;
  if (activeCount === 0) {
    return {
      ok: false,
      error: "No products found. Sync your catalog in the Quiz Builder first.",
      warnings: [],
      usage,
    };
  }

  onProgress?.("Reading your answers…");
  const [config, notes, chatConfig] = await Promise.all([
    source === "draft"
      ? getQuizDraft(shopId).then((d) => d ?? captureLiveConfig(shopId))
      : captureLiveConfig(shopId),
    getQuestionGuidance(shopId),
    getChatAssistantConfig(shopDomain),
  ]);

  const userQuestions = config.flow.questions;
  if (userQuestions.length === 0) {
    return {
      ok: false,
      error: "No quiz questions yet. Set up your questions first, then describe your logic here.",
      warnings: [],
      usage,
    };
  }
  const answeredCount = userQuestions.filter((q) => notes[q.axisKey]?.trim()).length;
  if (answeredCount === 0 && !notes[GENERAL_GUIDANCE_KEY]?.trim()) {
    return {
      ok: false,
      error: "Fill in notes for at least one question (or the store-wide box) before generating.",
      warnings: [],
      usage,
    };
  }

  // NO serializeCatalog options — byte-identical catalog text keeps this
  // route on the same deterministic bytes across runs so the cache prefix
  // survives regenerate cycles (same rationale as quiz-generator).
  const { text: catalogText, truncated } = serializeCatalog(catalog);
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: ROLE_BLOCK },
    { type: "text", text: catalogText, cache_control: { type: "ephemeral" } },
  ];

  // Draft settings override live for the knobs baked into the rulebook
  // (num_recommendations etc.) so the generated text matches what will
  // actually publish.
  const settings =
    source === "draft"
      ? { ...chatConfig, ...(config.settings as Record<string, unknown>) }
      : (chatConfig as unknown as Record<string, unknown>);
  const priorityIds = Array.isArray(settings.priority_product_ids)
    ? (settings.priority_product_ids as string[])
    : [];
  const input = buildInputMessage({
    flow: config.flow,
    notes,
    numRecommendations: Number(settings.num_recommendations) || 3,
    priorityProductIds: priorityIds,
    previousGuidance: String(settings.ai_guidance ?? ""),
  });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input }];

  onProgress?.("Writing your recommendation logic…");
  let output: GuidanceOutput | null = null;
  try {
    const first = await callCompiler(system, messages, shopDomain, "guidance-generate");
    usage.push(first.usage);
    output = first.output;
  } catch (e) {
    // One retry from scratch on a malformed response — structured output
    // makes this rare, and a second clean call beats giving up.
    try {
      const retry = await callCompiler(system, messages, shopDomain, "guidance-generate-retry");
      usage.push(retry.usage);
      output = retry.output;
    } catch (e2) {
      return { ok: false, error: `Generation failed: ${(e2 as Error).message}`, warnings: [], usage };
    }
  }

  const warnings = [...output.warnings];
  const guidanceText = output.guidanceText.trim();
  if (!guidanceText) {
    return { ok: false, error: "The model returned empty guidance — try again.", warnings, usage };
  }
  if (guidanceText.length > 50_000) {
    return {
      ok: false,
      error: "Generated guidance is unreasonably long — trim your notes and try again.",
      warnings,
      usage,
    };
  }
  const summarized = new Set(output.perQuestionSummary.map((s) => s.axisKey));
  for (const q of userQuestions) {
    if (!summarized.has(q.axisKey)) {
      warnings.push(`No summary returned for "${q.prompt}" — review the generated text to confirm it's covered.`);
    }
  }
  if (truncated > 0) {
    warnings.push(`Catalog truncated: ${truncated} products were not shown to the AI.`);
  }

  return {
    ok: true,
    warnings,
    guidanceText,
    perQuestionSummary: output.perQuestionSummary,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Notes drafter — writes a FIRST PASS of the merchant's per-answer notes from
// the catalog, so the Logic step starts as a review task instead of a blank
// page. Output goes to the editor UI only; nothing is saved server-side.

const NotesDraftSchema = z.object({
  questions: z.array(
    z.object({
      axisKey: z.string(),
      answers: z.array(z.object({ label: z.string(), note: z.string() })),
      // How multi-select combinations should interact; empty when N/A.
      combos: z.string(),
    }),
  ),
});

export type NotesDraft = z.infer<typeof NotesDraftSchema>;

const DRAFT_NOTES_ROLE = `You draft merchandising notes for a Shopify "find my fit" quiz. The merchant will review and edit them, then a separate step compiles them into ranking rules.

For each quiz question given, write one short note PER ANSWER: which of this store's actual products, collections, or product traits fit a shopper who picks that answer. Ground every note in the catalog you are given.

RULES:
- One line per answer, at most ~20 words. Plain, specific, no marketing voice.
- Name only products, collections, product types, or traits that appear in the catalog. Never invent.
- Prefer traits and families over long product lists ("the sheer nudes and milky pinks" beats naming 12 SKUs). Name specific products only when they are clearly the match.
- If an answer expresses no preference ("surprise me", "open to anything"), write exactly: no constraint.
- If the catalog genuinely offers nothing for an answer, write what to fall back to rather than inventing.
- "combos": for multi-select questions only, one short line on how picking several answers should combine (e.g. "picks are OR'd; favor products matching most picks"); otherwise an empty string.
- If the merchant already wrote a note for an answer, write your draft to COMPLEMENT it (their text is kept; do not repeat it).`;

export interface DraftNotesResult {
  ok: boolean;
  error?: string;
  draft?: NotesDraft;
  usage: ClaudeUsage[];
}

export async function draftQuestionNotes(args: {
  shopId: string;
  shopDomain: string;
  /** Limit drafting to these axis keys (per-question button); omit for all. */
  axisKeys?: string[];
}): Promise<DraftNotesResult> {
  const { shopId, shopDomain, axisKeys } = args;
  const usage: ClaudeUsage[] = [];

  const catalog = await loadCatalogForShop(shopId);
  const activeCount = catalog.filter((p) => p.status == null || p.status === "active").length;
  if (activeCount === 0) {
    return { ok: false, error: "No products found. Sync your catalog first.", usage };
  }

  // Studio-only feature: always draft against the DRAFT flow.
  const [config, notes] = await Promise.all([
    getQuizDraft(shopId).then((d) => d ?? captureLiveConfig(shopId)),
    getQuestionGuidance(shopId),
  ]);
  let questions = config.flow.questions;
  if (axisKeys && axisKeys.length > 0) {
    questions = questions.filter((q) => axisKeys.includes(q.axisKey));
  }
  if (questions.length === 0) {
    return { ok: false, error: "No quiz questions to draft notes for.", usage };
  }

  const { text: catalogText } = serializeCatalog(catalog);
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: DRAFT_NOTES_ROLE },
    { type: "text", text: catalogText, cache_control: { type: "ephemeral" } },
  ];

  const questionLines = questions.map((q, i) => {
    const opts = q.options
      .map((o) => `    - "${o.label}"${o.selectAll ? " (open to anything)" : ""}`)
      .join("\n");
    const existing = notes[q.axisKey]?.trim();
    return [
      `Question ${i + 1} [${q.axisKey}]${q.multiSelect ? " (multi-select)" : ""}: "${q.prompt}"`,
      `  Answers:`,
      opts,
      existing ? `  Merchant's existing notes (complement, don't repeat): ${existing}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const input = [
    `Draft per-answer merchandising notes for these quiz questions. Return one entry per question, keyed by the [axis_key] shown, with one note per answer label exactly as given.`,
    ``,
    ...questionLines,
  ].join("\n");

  try {
    const client = claudeClient();
    const response = await callClaudeWithRetry(async () => {
      const stream = client.messages.stream({
        model: CLAUDE_MODEL_MAIN,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { format: zodOutputFormat(NotesDraftSchema) },
        system,
        messages: [{ role: "user", content: input }],
      });
      return stream.finalMessage();
    }, "draft-notes");
    logClaudeUsage(shopDomain, "draft-notes", response.usage as ClaudeUsage);
    usage.push(response.usage as ClaudeUsage);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = NotesDraftSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return { ok: false, error: "The AI returned an unreadable draft. Try again.", usage };
    }
    // Only pass through questions that actually exist in the flow.
    const known = new Set(questions.map((q) => q.axisKey));
    return {
      ok: true,
      draft: { questions: parsed.data.questions.filter((q) => known.has(q.axisKey)) },
      usage,
    };
  } catch (e) {
    return { ok: false, error: `Drafting failed: ${(e as Error).message}`, usage };
  }
}
