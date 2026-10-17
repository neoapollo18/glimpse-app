// Translate quiz (Studio → Text & labels, 2026-10-16): the merchant picks
// a language and Gleame machine-translates the quiz's actual text, the
// built-in labels plus (optionally) headlines, questions, answers and the
// "why this fits" lines. This module is the pure half: collect what to
// translate from a draft, check a translation kept its placeholders, and
// write accepted translations back. quiz-translate.server.ts calls Claude.

import { UI_TEXT_ENTRIES, sanitizeProductWhy, sanitizeUiText, uiTextDefault } from "./quiz-ui-text";

// Screen copy with its own settings column. Only string values are sent;
// a key a shop's row doesn't have is skipped.
export const TRANSLATABLE_COPY_KEYS = [
  "quiz_eyebrow",
  "quiz_headline",
  "quiz_subtext",
  "quiz_visual_caption",
  "quiz_alt_audience_label",
  "quiz_photo_note",
  "quiz_gate_headline",
  "quiz_gate_helper",
  "quiz_privacy_note",
  "quiz_results_headline_photo",
  "quiz_results_headline_nophoto",
  "quiz_results_subtext",
  "quiz_match_footnote",
  "quiz_upsell_title",
  "quiz_upsell_body",
  "quiz_upsell_cta",
  "quiz_shade_headline",
  "quiz_shade_body",
  "quiz_shade_cta_photo",
  "quiz_shade_cta_manual",
  "quiz_lead_headline",
  "quiz_lead_body",
  "quiz_lead_consent_text",
  "quiz_lead_discount_message",
  "quiz_bundle_label",
  "quiz_results_prose",
  "quiz_archetype_title",
  "quiz_archetype_line",
] as const;

/** Where a translated string goes back to. */
export type TranslateTarget =
  | { kind: "ui"; key: string }
  | { kind: "column"; key: string }
  | { kind: "trust"; index: number }
  | { kind: "axis"; axisKey: string }
  | { kind: "prompt"; axisKey: string }
  | { kind: "helper"; axisKey: string }
  | { kind: "option"; axisKey: string; index: number; value: string; field: "label" | "reasonText" | "sublabel" }
  | { kind: "why"; productId: string };

export interface TranslateItem {
  id: string;
  text: string;
  target: TranslateTarget;
}

type DraftLike = {
  flow: {
    axes: Array<{ key: string; label: string }>;
    questions: Array<{
      axisKey: string;
      prompt: string;
      helperText?: string | null;
      options: Array<{ label: string; axisValueValue: string; reasonText?: string | null; displayMeta?: unknown }>;
    }>;
  };
  settings: Record<string, unknown>;
};

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Everything to send, each with a short id. Labels go as the shopper sees
 * them now: the merchant's wording where set, else the default for the
 * current template. `content` adds headlines, questions, answers and why
 * lines. Duplicated texts still get their own ids (cheap, and each lands
 * back exactly where it came from).
 */
export function collectTranslatable(draft: DraftLike, opts: { content: boolean; template: string | null }): TranslateItem[] {
  const items: TranslateItem[] = [];
  // Answer choices get an "a" id: they're the shopper's own words, which
  // the translator keeps in the shopper's voice instead of addressing them.
  const add = (text: unknown, target: TranslateTarget) => {
    if (!isText(text)) return;
    const answer = target.kind === "option" && target.field === "label";
    items.push({ id: (answer ? "a" : "") + String(items.length + 1), text, target });
  };
  const s = draft.settings;
  const overrides = sanitizeUiText(s.quiz_ui_text);
  for (const e of UI_TEXT_ENTRIES) {
    if (e.column) add(isText(s[e.key]) ? s[e.key] : e.default, { kind: "column", key: e.key });
    else add(overrides[e.key] ?? uiTextDefault(e, opts.template), { kind: "ui", key: e.key });
  }
  if (!opts.content) return items;
  for (const key of TRANSLATABLE_COPY_KEYS) add(s[key], { kind: "column", key });
  if (Array.isArray(s.quiz_trust_items)) {
    (s.quiz_trust_items as unknown[]).forEach((t, index) => add(t, { kind: "trust", index }));
  }
  for (const a of draft.flow.axes) add(a.label, { kind: "axis", axisKey: a.key });
  for (const q of draft.flow.questions) {
    add(q.prompt, { kind: "prompt", axisKey: q.axisKey });
    add(q.helperText, { kind: "helper", axisKey: q.axisKey });
    // Options go by position: a select-all answer ("Surprise me") reuses
    // another answer's value, so the value alone can't tell them apart.
    q.options.forEach((o, index) => {
      const at = { kind: "option", axisKey: q.axisKey, index, value: o.axisValueValue } as const;
      add(o.label, { ...at, field: "label" });
      add(o.reasonText, { ...at, field: "reasonText" });
      const sub = o.displayMeta && typeof o.displayMeta === "object" ? (o.displayMeta as Record<string, unknown>).sublabel : null;
      add(sub, { ...at, field: "sublabel" });
    });
  }
  for (const [productId, line] of Object.entries(sanitizeProductWhy(s.quiz_product_why))) {
    add(line, { kind: "why", productId });
  }
  return items;
}

/** One run's budget. A real quiz is a few hundred short strings (Aurora's:
 * 258); trust items and why lines have no count cap, so a padded config
 * could otherwise turn one click into hundreds of Opus calls. Characters
 * bound the tokens; the item count bounds the calls (one per 60 items), so
 * thousands of one-letter strings can't slip under the character budget. */
export const TRANSLATE_MAX_SOURCE_CHARS = 200_000;
export const TRANSLATE_MAX_ITEMS = 3_000;

export function exceedsTranslateBudget(items: TranslateItem[]): boolean {
  if (items.length > TRANSLATE_MAX_ITEMS) return true;
  let total = 0;
  for (const it of items) total += it.text.length;
  return total > TRANSLATE_MAX_SOURCE_CHARS;
}

const braces = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join("|");
const stars = (s: string) => (s.match(/\*\*/g) ?? []).length;
const angles = (s: string) => /[<>]/.test(s);

/** A translation is only used if it kept every {placeholder} and **bold**
 * marker, added no angle brackets the source didn't have, and isn't empty
 * or wildly longer than the source. */
export function acceptTranslation(source: string, translated: unknown): string | null {
  if (typeof translated !== "string") return null;
  const t = translated.trim();
  if (!t) return null;
  if (braces(t) !== braces(source)) return null;
  if (stars(t) !== stars(source)) return null;
  // Model output lands in shopper-facing labels: markup the merchant never
  // wrote is dropped, the line keeps its source text.
  if (angles(t) && !angles(source)) return null;
  if (t.length > source.length * 4 + 60) return null;
  return t;
}

/**
 * Write accepted translations into a fresh copy of the CURRENT draft. Each
 * item lands only if its source text is still what was sent: a field the
 * merchant edited while the translation ran keeps their edit.
 */
export function applyTranslations<D extends DraftLike>(
  current: D,
  items: TranslateItem[],
  translated: Record<string, string>,
  template: string | null,
): { draft: D; applied: number; skipped: number } {
  const next = JSON.parse(JSON.stringify(current)) as D;
  const s = next.settings;
  const uiText = { ...sanitizeUiText(s.quiz_ui_text) };
  let why = sanitizeProductWhy(s.quiz_product_why);
  let applied = 0;
  let skipped = 0;
  for (const item of items) {
    const t = translated[item.id];
    if (t == null) {
      skipped++;
      continue;
    }
    const tg = item.target;
    let ok = false;
    if (tg.kind === "ui") {
      const entry = UI_TEXT_ENTRIES.find((e) => e.key === tg.key)!;
      const now = uiText[tg.key] ?? uiTextDefault(entry, template);
      if (now === item.text) {
        uiText[tg.key] = t;
        ok = true;
      }
    } else if (tg.kind === "column") {
      const entry = UI_TEXT_ENTRIES.find((e) => e.key === tg.key);
      const now = isText(s[tg.key]) ? s[tg.key] : entry?.default;
      if (now === item.text) {
        s[tg.key] = t;
        ok = true;
      }
    } else if (tg.kind === "trust") {
      const arr = Array.isArray(s.quiz_trust_items) ? (s.quiz_trust_items as unknown[]) : null;
      if (arr && arr[tg.index] === item.text) {
        arr[tg.index] = t;
        ok = true;
      }
    } else if (tg.kind === "axis") {
      const a = next.flow.axes.find((x) => x.key === tg.axisKey);
      if (a && a.label === item.text) {
        a.label = t;
        ok = true;
      }
    } else if (tg.kind === "prompt" || tg.kind === "helper") {
      const q = next.flow.questions.find((x) => x.axisKey === tg.axisKey);
      if (q && tg.kind === "prompt" && q.prompt === item.text) {
        q.prompt = t;
        ok = true;
      } else if (q && tg.kind === "helper" && q.helperText === item.text) {
        q.helperText = t;
        ok = true;
      }
    } else if (tg.kind === "option") {
      // Same position and value as when sent, else skipped: an option
      // reordered meanwhile is never written onto its neighbor.
      const q = next.flow.questions.find((x) => x.axisKey === tg.axisKey);
      const at = q?.options[tg.index];
      const o = at && at.axisValueValue === tg.value ? at : undefined;
      if (o && tg.field === "label" && o.label === item.text) {
        o.label = t;
        ok = true;
      } else if (o && tg.field === "reasonText" && o.reasonText === item.text) {
        o.reasonText = t;
        ok = true;
      } else if (o && tg.field === "sublabel") {
        const meta = o.displayMeta && typeof o.displayMeta === "object" ? (o.displayMeta as Record<string, unknown>) : null;
        if (meta && meta.sublabel === item.text) {
          meta.sublabel = t;
          ok = true;
        }
      }
    } else if (tg.kind === "why") {
      if (why[tg.productId] === item.text) {
        why = { ...why, [tg.productId]: t.slice(0, 160) };
        ok = true;
      }
    }
    if (ok) applied++;
    else skipped++;
  }
  s.quiz_ui_text = Object.keys(uiText).length > 0 ? uiText : null;
  if (s.quiz_product_why != null || Object.keys(why).length > 0) s.quiz_product_why = Object.keys(why).length > 0 ? why : null;
  return { draft: next, applied, skipped };
}

export const TRANSLATE_LANGUAGES = [
  "French",
  "Spanish",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Polish",
  "Swedish",
  "Danish",
  "Norwegian",
  "Finnish",
  "Czech",
  "Greek",
  "Turkish",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Arabic",
  "Hebrew",
  "English",
] as const;
