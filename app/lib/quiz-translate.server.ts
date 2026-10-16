import type Anthropic from "@anthropic-ai/sdk";
import { claudeClient, callClaudeWithRetry, logClaudeUsage, CLAUDE_MODEL_MAIN } from "./claude.server";
import { acceptTranslation, type TranslateItem } from "./quiz-translate";

// Translate quiz, the Claude half (see quiz-translate.ts). The texts go in
// chunks run side by side so a full quiz (~300 short strings) comes back
// in well under a minute; each translation is checked for its
// placeholders before it's used, and a string that fails keeps its text.

const CHUNK = 60;
const PARALLEL = 5;

const TOOL: Anthropic.Tool = {
  name: "save_translations",
  description: "Save the translation of every text, keyed by the same id.",
  input_schema: {
    type: "object",
    properties: {
      translations: {
        type: "object",
        description: "id -> translated text, one entry for every id you were given",
        additionalProperties: { type: "string" },
      },
    },
    required: ["translations"],
  },
};

function systemPrompt(language: string, formality: "informal" | "formal"): string {
  return [
    `You translate the shopper-facing text of a Shopify store's product quiz into ${language}.`,
    formality === "informal"
      ? "Address the shopper informally (for example tu in French, tú in Spanish, du in German, tu in Italian), the way modern beauty and lifestyle brands do."
      : "Address the shopper formally (for example vous in French, usted in Spanish, Sie in German, Lei in Italian).",
    "Rules:",
    "- Translate every id you are given and return each one under the same id.",
    "- Ids starting with \"a\" are answer choices the shopper taps, written in the shopper's own voice: keep that voice (for example \"Feel closer to Him\" becomes \"Me sentir plus proche de Lui\" in French), never address the shopper in them.",
    "- Keep anything in braces exactly as it is, untranslated: {count}, {total}, {name}, {assistant_name} and so on.",
    "- Keep **double asterisks** around the translation of the same words.",
    "- Keep symbols such as ✓ → · and emoji where they are.",
    "- Do not translate brand names, product names, URLs or email addresses.",
    "- These are buttons, labels and short lines: keep each about as short as the original and keep its capitalization style (a text that starts lowercase continues a sentence).",
    "- Use the usual online-shopping words of that language (cart, checkout, add to cart).",
    `- If a text is already in ${language}, return it unchanged.`,
    "Call save_translations once with all of them.",
  ].join("\n");
}

async function translateChunk(
  items: TranslateItem[],
  language: string,
  formality: "informal" | "formal",
  shopDomain: string,
): Promise<Record<string, string>> {
  const input: Record<string, string> = {};
  for (const it of items) input[it.id] = it.text;
  const res = await callClaudeWithRetry(
    () =>
      claudeClient().messages.create({
        model: CLAUDE_MODEL_MAIN,
        max_tokens: 8000,
        system: systemPrompt(language, formality),
        tools: [TOOL],
        tool_choice: { type: "tool", name: "save_translations" },
        messages: [{ role: "user", content: JSON.stringify(input) }],
      }),
    "translate-quiz",
  );
  logClaudeUsage(shopDomain, "translate-quiz", res.usage);
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const out = (block?.input as { translations?: Record<string, unknown> } | undefined)?.translations ?? {};
  const accepted: Record<string, string> = {};
  for (const it of items) {
    const t = acceptTranslation(it.text, out[it.id]);
    if (t != null) accepted[it.id] = t;
  }
  return accepted;
}

/** Translate every item; failed chunks or strings simply come back missing. */
export async function translateItems(
  items: TranslateItem[],
  language: string,
  formality: "informal" | "formal",
  shopDomain: string,
): Promise<{ translations: Record<string, string>; failedChunks: number }> {
  const chunks: TranslateItem[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  const translations: Record<string, string> = {};
  let failedChunks = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const results = await Promise.allSettled(
      chunks.slice(i, i + PARALLEL).map((c) => translateChunk(c, language, formality, shopDomain)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") Object.assign(translations, r.value);
      else {
        failedChunks++;
        console.error("[translate-quiz] chunk failed:", (r.reason as Error)?.message);
      }
    }
  }
  return { translations, failedChunks };
}
