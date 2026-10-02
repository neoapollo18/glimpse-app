// Generation report (V3-CONTRACTS §8) — the ONE object the Studio arrival
// banner and the onboarding Build screen read their numbers from.
//
// Pure module on purpose: no Supabase, no Shopify, no model calls. The
// generator feeds it real numbers (in-scope catalog, resolved profile, the
// saved flow) and it derives the honest parts — heading font name only
// when the token came from the theme/homepage, a palette word only when
// at least two colors were actually extracted, phases only for Match,
// image slots counted from declareSlots over the saved flow. Every helper
// here is unit-tested with the value ABSENT (spec 8.2 truth tests).

import {
  TEMPLATES,
  declareSlots,
  describeStoreType,
  isTemplateId,
  type SlotFlow,
  type TemplateAssignment,
  type TemplateId,
} from "./quiz-templates";

export type GenerationStepKey = "catalog" | "theme" | "questions" | "paths" | "images";

export interface GenerationStep {
  key: GenerationStepKey;
  detail: string;
  ms: number;
}

export const GENERATION_STEP_KEYS: GenerationStepKey[] = ["catalog", "theme", "questions", "paths", "images"];

/** Merchant-facing step labels (the Build screen and the failure state). */
export const GENERATION_STEP_LABELS: Record<GenerationStepKey, string> = {
  catalog: "Reading your catalog",
  theme: "Matching your theme",
  questions: "Writing questions",
  paths: "Checking every product has a path",
  images: "Placing your images",
};

export interface GenerationReport {
  version: 3;
  generatedAt: string;
  productCount: number;
  collectionCount: number;
  questions: number;
  groundedQuestions: number;
  phases: number;
  headingFont: { name: string | null; confidence: "high" | "medium" | "low" | null };
  colors: string[];
  paletteWord: string | null;
  template: TemplateId;
  degradedFrom: TemplateId | null;
  imagesPlaced: number;
  imagesTotal: number;
  storeType: string | null;
  steps: GenerationStep[];
}

export interface QuizPhase {
  label: string;
  axisKeys: string[];
}

/** The slice of the Brand Profile the report reads. Structural so tests
 * (and older stored profiles) can pass a partial object. */
export interface ReportProfile {
  tokens?: { fontHeading?: string; colorBg?: string; colorText?: string; colorAccent?: string } | null;
  sources?: Record<string, { source: string; confidence: "high" | "medium" | "low" }> | null;
  homepage?: { palette?: string[] | null } | null;
  brand?: { primaryColor?: string | null } | null;
  category?: string | null;
  templateAssignment?: TemplateAssignment | null;
}

// ---------------------------------------------------------------------
// Heading font
// ---------------------------------------------------------------------

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "inherit", "initial", "unset", "-apple-system", "blinkmacsystemfont",
  "segoe ui", "roboto", "helvetica neue", "helvetica", "arial", "georgia", "times new roman",
]);

/** First concrete family name in a CSS font stack, or null when the stack
 * is generic/system only ("Georgia, serif" → null; '"Fraunces", serif' →
 * "Fraunces"). */
export function fontFamilyName(stack: string | null | undefined): string | null {
  if (!stack) return null;
  for (const raw of String(stack).split(",")) {
    const name = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (!name) continue;
    if (GENERIC_FAMILIES.has(name.toLowerCase())) continue;
    if (/^var\(/.test(name)) continue;
    return name;
  }
  return null;
}

/** headingFont per §8: the family name ONLY when the profile's heading
 * token came from the theme or the homepage. Preset → { null, null }. */
export function headingFontFromProfile(
  profile: ReportProfile | null | undefined,
): GenerationReport["headingFont"] {
  const src = profile?.sources?.fontHeading;
  if (!src || (src.source !== "theme" && src.source !== "homepage")) return { name: null, confidence: null };
  const name = fontFamilyName(profile?.tokens?.fontHeading);
  if (!name) return { name: null, confidence: null };
  return { name, confidence: src.confidence ?? null };
}

// ---------------------------------------------------------------------
// Colors + palette word
// ---------------------------------------------------------------------

const HEX6 = /^#[0-9a-f]{6}$/;

function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX6.test(s) ? s : null;
}

/** Extracted colors per §8: the homepage palette plus every color token
 * whose source is the theme (or the Brand API accent). Presets never
 * count, so a store with no reachable theme/homepage yields []. */
export function extractedColorsFromProfile(profile: ReportProfile | null | undefined): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const hex = normalizeHex(v);
    if (hex && !out.includes(hex)) out.push(hex);
  };
  for (const key of ["colorBg", "colorText", "colorAccent"] as const) {
    const src = profile?.sources?.[key]?.source;
    if (src === "theme" || src === "brand_api") push(profile?.tokens?.[key]);
  }
  for (const c of profile?.homepage?.palette ?? []) push(c);
  return out.slice(0, 12);
}

function hsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const isWarmHue = (h: number) => h < 75 || h >= 320;

/**
 * Palette word per §8 — derived ONLY when ≥ 2 colors were extracted
 * (otherwise null and the banner never claims a palette). Reads the
 * resolved bg/accent when given, else the extracted colors themselves:
 *   dark bg           → "deep"
 *   saturated accent  → "vivid"
 *   near-grey set     → "monochrome"
 *   else light + low-saturation → "warm neutral" | "cool neutral"
 *   else                        → "soft"
 */
export function paletteWordFor(
  colors: string[],
  resolved?: { bg?: string | null; accent?: string | null } | null,
): string | null {
  const clean = colors.map(normalizeHex).filter((c): c is string => Boolean(c));
  if (clean.length < 2) return null;
  const bgHex = normalizeHex(resolved?.bg) ?? clean[0];
  const accentHex = normalizeHex(resolved?.accent) ?? clean[Math.min(2, clean.length - 1)];
  const [, , bgL] = hsl(bgHex);
  const [accentH, accentS] = hsl(accentHex);
  const sats = clean.map((c) => hsl(c)[1]);
  const avgS = sats.reduce((a, b) => a + b, 0) / sats.length;

  if (bgL < 0.35) return "deep";
  if (accentS >= 0.55 || avgS >= 0.5) return "vivid";
  if (avgS < 0.08 && accentS < 0.12) return "monochrome";
  if (accentS < 0.4) {
    // Neutral palette: warmth from the tinted colors, not the near-greys.
    const tinted = clean.map(hsl).filter(([, s]) => s >= 0.05);
    const ref = tinted.length ? tinted : [hsl(accentHex)];
    const warm = ref.filter(([h]) => isWarmHue(h)).length;
    return warm * 2 >= ref.length ? "warm neutral" : "cool neutral";
  }
  return isWarmHue(accentH) ? "warm" : "cool";
}

// ---------------------------------------------------------------------
// Phases (Match only)
// ---------------------------------------------------------------------

export interface PhaseQuestion {
  axisKey: string;
}

/**
 * Model-proposed phases are accepted only when they partition the flow
 * into 2–3 contiguous, labelled runs covering every question exactly once;
 * anything else falls to the deterministic chunking (2 phases ≤ 5
 * questions, else 3) labelled from each chunk's first axis label.
 */
export function resolvePhases(
  questions: PhaseQuestion[],
  proposed: Array<{ label?: unknown; axisKeys?: unknown }> | null | undefined,
  axisLabels: Record<string, string>,
): QuizPhase[] {
  const order = questions.map((q) => q.axisKey);
  if (order.length === 0) return [];
  const valid = validateProposedPhases(order, proposed);
  if (valid) return valid;
  return chunkPhases(order, axisLabels);
}

function validateProposedPhases(
  order: string[],
  proposed: Array<{ label?: unknown; axisKeys?: unknown }> | null | undefined,
): QuizPhase[] | null {
  if (!Array.isArray(proposed) || proposed.length < 2 || proposed.length > 3) return null;
  const phases: QuizPhase[] = [];
  for (const p of proposed) {
    const label = typeof p?.label === "string" ? p.label.trim().slice(0, 40) : "";
    const keys = Array.isArray(p?.axisKeys) ? p.axisKeys.filter((k): k is string => typeof k === "string") : [];
    if (!label || keys.length === 0) return null;
    phases.push({ label, axisKeys: keys });
  }
  // Contiguous + exhaustive: the concatenation must equal the flow order.
  const concat = phases.flatMap((p) => p.axisKeys);
  if (concat.length !== order.length) return null;
  for (let i = 0; i < order.length; i++) if (concat[i] !== order[i]) return null;
  return phases;
}

function chunkPhases(order: string[], axisLabels: Record<string, string>): QuizPhase[] {
  if (order.length < 2) {
    return [{ label: axisLabels[order[0]] || "About you", axisKeys: [...order] }];
  }
  const count = order.length <= 5 ? 2 : 3;
  const size = Math.ceil(order.length / count);
  const out: QuizPhase[] = [];
  for (let i = 0; i < order.length; i += size) {
    const keys = order.slice(i, i + size);
    out.push({ label: axisLabels[keys[0]] || `Part ${out.length + 1}`, axisKeys: keys });
  }
  return out;
}

// ---------------------------------------------------------------------
// Slots, grounding, paths
// ---------------------------------------------------------------------

export interface ReportFlowOption {
  label: string;
  axisValueValue: string;
  imageUrl?: string | null;
  selectAll?: boolean | null;
  displayMeta?: Record<string, unknown> | null;
}
export interface ReportFlowQuestion {
  axisKey: string;
  prompt: string;
  options: ReportFlowOption[];
}
export interface ReportFlow {
  questions: ReportFlowQuestion[];
}

/** imagesPlaced / imagesTotal per §8: total = declared NON-optional slots;
 * placed = the answer carries its own imageUrl or quiz_image_slots holds
 * the key. Auto-resolved library picks are NOT counted (they are a render-
 * time fallback, not a placed image). */
export function countImageSlots(
  template: TemplateId,
  flow: ReportFlow,
  imageSlots: Record<string, string> | null | undefined,
  opts: {
    hasFounder?: boolean;
    /** Slots the runtime resolves without a merchant pick (hero from
     * quiz_hero_image / brand cover, founder portrait). Counted as placed
     * so the report agrees with what the Studio's Images rail shows. */
    autoResolved?: Record<string, string | null | undefined>;
  } = {},
): { placed: number; total: number } {
  const slotFlow: SlotFlow = {
    questions: flow.questions.map((q) => ({
      axisKey: q.axisKey,
      prompt: q.prompt,
      options: q.options.map((o) => ({
        label: o.label,
        axisValueValue: o.axisValueValue,
        imageUrl: o.imageUrl ?? null,
        selectAll: Boolean(o.selectAll),
        displayMeta: o.displayMeta ?? null,
      })),
    })),
  };
  const answerImage = new Map<string, boolean>();
  for (const q of flow.questions) {
    for (const o of q.options) {
      if (o.selectAll || !o.axisValueValue) continue;
      answerImage.set(`answer:${q.axisKey}:${o.axisValueValue}`, Boolean((o.imageUrl ?? "").trim()));
    }
  }
  const slots = declareSlots(template, slotFlow, opts).filter((s) => !s.optional);
  let placed = 0;
  for (const s of slots) {
    const merchant = Boolean((imageSlots?.[s.key] ?? "").trim());
    const auto = Boolean((opts.autoResolved?.[s.key] ?? "").trim());
    if (merchant || auto || answerImage.get(s.key)) placed++;
  }
  return { placed, total: slots.length };
}

/** Questions whose every non-selectAll answer maps to ≥ floor products
 * (answerCounts keyed `${axisKey}:${value}`). */
export function countGroundedQuestions(
  flow: ReportFlow,
  answerCounts: Record<string, number>,
  floor: number,
): number {
  let grounded = 0;
  for (const q of flow.questions) {
    const answers = q.options.filter((o) => !o.selectAll && o.axisValueValue);
    if (answers.length === 0) continue;
    const ok = answers.every((o) => (answerCounts[`${q.axisKey}:${o.axisValueValue}`] ?? 0) >= floor);
    if (ok) grounded++;
  }
  return grounded;
}

// ---------------------------------------------------------------------
// Step detail formatters (the Build screen shows these verbatim)
// ---------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const stepDetail = {
  catalog: (productCount: number, collectionCount: number) =>
    collectionCount > 0
      ? `${plural(productCount, "product")} · ${plural(collectionCount, "collection")}`
      : plural(productCount, "product"),
  theme: (fontName: string | null, colorCount: number) =>
    [fontName, colorCount > 0 ? plural(colorCount, "color") : null].filter(Boolean).join(" · ") ||
    "Neutral preset",
  questions: (questions: number, phases: number) =>
    phases > 0
      ? `${plural(questions, "question")} across ${plural(phases, "phase")}`
      : plural(questions, "question"),
  paths: (reached: number, total: number) => `${reached} / ${total}`,
  images: (placed: number, total: number) => `${placed} / ${total}`,
};

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

export interface GenerationReportInput {
  productCount: number;
  collectionCount: number;
  flow: ReportFlow;
  answerCounts: Record<string, number>;
  groundingFloor: number;
  phases: QuizPhase[] | null;
  profile: ReportProfile | null;
  template: TemplateId;
  degradedFrom: TemplateId | null;
  imageSlots: Record<string, string> | null;
  hasFounder?: boolean;
  steps: GenerationStep[];
  generatedAt?: string;
}

export function buildGenerationReport(input: GenerationReportInput): GenerationReport {
  const template = isTemplateId(input.template) ? input.template : "t5";
  const headingFont = headingFontFromProfile(input.profile);
  const colors = extractedColorsFromProfile(input.profile);
  const paletteWord = paletteWordFor(colors, {
    bg: input.profile?.tokens?.colorBg ?? null,
    accent: input.profile?.tokens?.colorAccent ?? null,
  });
  const phases = template === "t1" ? (input.phases?.length ?? 0) : 0;
  const { placed, total } = countImageSlots(template, input.flow, input.imageSlots, {
    hasFounder: input.hasFounder,
  });
  const assignment = input.profile?.templateAssignment ?? null;
  const storeType = assignment
    ? describeStoreType({ ...assignment, template }, input.profile?.category ?? null)
    : null;

  return {
    version: 3,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productCount: input.productCount,
    collectionCount: input.collectionCount,
    questions: input.flow.questions.length,
    groundedQuestions: countGroundedQuestions(input.flow, input.answerCounts, input.groundingFloor),
    phases,
    headingFont,
    colors,
    paletteWord,
    template,
    degradedFrom: input.degradedFrom && input.degradedFrom !== template ? input.degradedFrom : null,
    imagesPlaced: placed,
    imagesTotal: total,
    storeType,
    steps: input.steps.filter((s) => GENERATION_STEP_KEYS.includes(s.key)),
  };
}

/** Defensive read of a stored report (jsonb) — null unless it is a v3
 * object with the fields the banner needs. */
export function parseGenerationReport(raw: unknown): GenerationReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 3 || !isTemplateId(r.template)) return null;
  return r as unknown as GenerationReport;
}

/** The template's merchant-facing name, for detail lines. */
export function templateName(id: TemplateId): string {
  return TEMPLATES[id].name;
}
