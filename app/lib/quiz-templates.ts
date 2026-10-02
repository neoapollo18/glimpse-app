/**
 * Template registry — v3 (docs/overhaul/V3-SPEC.md Parts 2–5,
 * frozen in docs/overhaul/V3-CONTRACTS.md §1–3).
 *
 * A TEMPLATE is the shape of the decision the quiz makes (Match, Consult,
 * Routine, Discover, Clean): five structurally distinct root components in
 * the widget (TplMatch..TplClean, root classes gq-t1..gq-t5). Each template
 * also owns its visual design (TEMPLATE_STYLES); the v3 Look switcher was
 * removed 2026-10-01 so every template reads as its own style.
 *
 * Storage keys are unchanged from v2 (quiz_template = t1..t5) but the
 * semantics are v3; migration 080 remaps pre-v3 values. Presets are
 * retired (quiz_preset is unread). This module is client-safe: no server
 * imports, importable by the studio, the generator, and the preview.
 */

export type TemplateId = "t1" | "t2" | "t3" | "t4" | "t5";
/** Intro types A..E (spec 5.1). */
export type IntroType = "split" | "hero" | "landing" | "founder" | "minimal";
export type EmailPlacement = "hook_start" | "gate_results" | "after_results" | "off";
export type SlotKind = "hero" | "lifestyle" | "product" | "variant" | "swatch" | "icon" | "logo" | "thumb";

export const TEMPLATE_IDS: TemplateId[] = ["t1", "t2", "t3", "t4", "t5"];
export const EMAIL_PLACEMENTS: EmailPlacement[] = ["hook_start", "gate_results", "after_results", "off"];

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && (TEMPLATE_IDS as string[]).includes(v);
}
export function isEmailPlacement(v: unknown): v is EmailPlacement {
  return typeof v === "string" && (EMAIL_PLACEMENTS as string[]).includes(v);
}

/** The 12-token contract (v1 Contract 1 — still binding). */
export interface BrandTokens {
  fontHeading: string;
  fontBody: string;
  colorBg: string;
  colorText: string;
  colorAccent: string;
  colorAccentText: string;
  colorSurface: string;
  colorBorder: string;
  radiusButton: number; // px
  radiusCard: number; // px
  spaceUnit: number; // px — scales the --gq-space ladder (base 4)
  maxWidth: number; // px
}

// ---------------------------------------------------------------------
// Template styles. Each template carries its OWN visual design (2026-10-01:
// the orthogonal Look switcher is gone, so the gallery shows five
// genuinely different designs and a merchant picks the one that looks
// like their store). Template = decision shape AND design. The tokens are
// the design's defaults; the widget stylesheet carries the rest of each
// design (shape language, answer treatment, type, detailing) under the
// gq-t{n} root class. Brand Profile only overlays the brand ACCENT and the
// body font (see resolveQuizTokens); Studio Style-panel overrides still win
// over everything.
// ---------------------------------------------------------------------

export interface TemplateStyle {
  name: string;
  tagline: string;
  tokens: BrandTokens;
  /** Radius range the design accepts; brand/merchant radii are clamped into it. */
  radiusMin: number;
  radiusCap: number;
}

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';
const GROTESK = '"Helvetica Neue", Helvetica, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const HUMANIST = '"Avenir Next", Avenir, "Segoe UI", "Gill Sans", "Trebuchet MS", -apple-system, sans-serif';
const ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Avenir Next Rounded", "Nunito", "Quicksand", -apple-system, BlinkMacSystemFont, sans-serif';

export const TEMPLATE_STYLES: Record<TemplateId, TemplateStyle> = {
  // Match: a modern beauty counter. Blush-neutral ground, pill controls,
  // soft elevated cards, photography-forward.
  t1: {
    name: "Counter",
    tagline: "Soft modern beauty counter: pill buttons, elevated cards, blush neutrals",
    tokens: {
      fontHeading: SANS,
      fontBody: SANS,
      colorBg: "#fbf6f3",
      colorText: "#231b1b",
      colorAccent: "#a8476b",
      colorAccentText: "#ffffff",
      colorSurface: "#ffffff",
      colorBorder: "#eddfd8",
      radiusButton: 999,
      radiusCard: 18,
      spaceUnit: 8,
      maxWidth: 1040,
    },
    radiusMin: 12,
    radiusCap: 999,
  },
  // Consult: a magazine feature. Serif display, ivory paper, hairline
  // rules instead of boxes, square corners, numbered answers.
  t2: {
    name: "Editorial",
    tagline: "Magazine feature: serif display, ivory paper, hairline rules, square corners",
    tokens: {
      fontHeading: SERIF,
      fontBody: SANS,
      colorBg: "#f6f2ea",
      colorText: "#1d1a16",
      colorAccent: "#2f3b31",
      colorAccentText: "#ffffff",
      colorSurface: "#fbf8f2",
      colorBorder: "rgba(29, 26, 22, 0.18)",
      radiusButton: 0,
      radiusCard: 2,
      spaceUnit: 12,
      maxWidth: 1200,
    },
    radiusMin: 0,
    radiusCap: 3,
  },
  // Routine: an apothecary ritual. Stone and sage, numbered steps, soft
  // capsule bars, calm humanist type.
  t3: {
    name: "Ritual",
    tagline: "Calm apothecary: stone and sage, capsule answers, numbered steps",
    tokens: {
      fontHeading: HUMANIST,
      fontBody: HUMANIST,
      colorBg: "#f1efe8",
      colorText: "#2a2b25",
      colorAccent: "#56664a",
      colorAccentText: "#ffffff",
      colorSurface: "#faf9f4",
      colorBorder: "#d9d6ca",
      radiusButton: 999,
      radiusCard: 24,
      spaceUnit: 10,
      maxWidth: 760,
    },
    radiusMin: 16,
    radiusCap: 999,
  },
  // Discover: pop. Heavy rounded type, ink outlines with hard offset
  // shadows, saturated accent, emoji allowed.
  t4: {
    name: "Pop",
    tagline: "Playful pop: heavy rounded type, ink outlines, hard offset shadows",
    tokens: {
      fontHeading: ROUNDED,
      fontBody: SANS,
      colorBg: "#fff1e2",
      colorText: "#1c1410",
      colorAccent: "#ff4f87",
      colorAccentText: "#ffffff",
      colorSurface: "#ffffff",
      colorBorder: "#1c1410",
      radiusButton: 14,
      radiusCard: 18,
      spaceUnit: 10,
      maxWidth: 760,
    },
    radiusMin: 10,
    radiusCap: 22,
  },
  // Clean: Swiss minimal. Pure white, monochrome ink, grotesk type, mono
  // numerals, inverted (ink-filled) selection.
  t5: {
    name: "Swiss",
    tagline: "Swiss minimal: monochrome grotesk, mono numerals, inverted selection",
    tokens: {
      fontHeading: GROTESK,
      fontBody: GROTESK,
      colorBg: "#ffffff",
      colorText: "#111111",
      colorAccent: "#111111",
      colorAccentText: "#ffffff",
      colorSurface: "#ffffff",
      colorBorder: "#d6d6d6",
      radiusButton: 6,
      radiusCard: 6,
      spaceUnit: 8,
      maxWidth: 880,
    },
    radiusMin: 0,
    radiusCap: 8,
  },
};

// ---------------------------------------------------------------------
// Templates (spec 2.2 / Part 3)
// ---------------------------------------------------------------------

export interface TemplateDef {
  id: TemplateId;
  name: string;
  componentName: "TplMatch" | "TplConsult" | "TplRoutine" | "TplDiscover" | "TplClean";
  rootClass: string;
  shopperQuestion: string;
  outputShape: string;
  questionRange: [number, number];
  questionRangeLabel: string;
  resultsShapeLabel: string;
  introType: IntroType;
  emailPlacementDefault: EmailPlacement;
  loading: "required" | "optional" | "absent";
  visualQuestions: "required" | "optional" | "absent";
  /** Imagery model consumed by the generation validator's imagery floor. */
  imageryModel: "per-answer" | "per-question" | "hero" | "cutout" | "none";
  resultsMarker: string;
  gates: string;
  ineligibleReason: string;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  t1: {
    id: "t1",
    name: "Match",
    componentName: "TplMatch",
    rootClass: "gq-t1",
    shopperQuestion: "Which one is right for me?",
    outputShape: "One hero match with your answers echoed back, plus alternates",
    questionRange: [5, 8],
    questionRangeLabel: "5–8 questions in phases",
    resultsShapeLabel: "visual answers · one hero match with your answers echoed back",
    introType: "hero",
    emailPlacementDefault: "after_results",
    loading: "required",
    visualQuestions: "required",
    imageryModel: "per-answer",
    resultsMarker: "gq-t1r",
    gates: "≥ 80% of visual-question answers resolve to a variant or swatch image",
    ineligibleReason: "Needs an image for most answers",
  },
  t2: {
    id: "t2",
    name: "Consult",
    componentName: "TplConsult",
    rootClass: "gq-t2",
    shopperQuestion: "Help me decide.",
    outputShape: "A top pick with reasons and a comparison of 2–3",
    questionRange: [6, 8],
    questionRangeLabel: "6–8 questions",
    resultsShapeLabel: "lifestyle cards · a top pick with reasons and a comparison table",
    introType: "landing",
    emailPlacementDefault: "hook_start",
    loading: "optional",
    visualQuestions: "required",
    imageryModel: "per-question",
    resultsMarker: "gq-t2r",
    gates: "≥ 1 lifestyle or banner image ≥ 1600 px for ≥ 80% of visual questions",
    ineligibleReason: "Needs lifestyle photos",
  },
  t3: {
    id: "t3",
    name: "Routine",
    componentName: "TplRoutine",
    rootClass: "gq-t3",
    shopperQuestion: "What should I use together?",
    outputShape: "A sequenced regimen with a bundle total and one add-all",
    questionRange: [4, 6],
    questionRangeLabel: "4–6 questions",
    resultsShapeLabel: "results are a sequenced set with one add-all",
    introType: "founder",
    emailPlacementDefault: "gate_results",
    loading: "optional",
    visualQuestions: "optional",
    imageryModel: "none",
    resultsMarker: "gq-t3r",
    gates: "none — icons and the founder portrait are optional",
    ineligibleReason: "",
  },
  t4: {
    id: "t4",
    name: "Discover",
    componentName: "TplDiscover",
    rootClass: "gq-t4",
    shopperQuestion: "What's my type?",
    outputShape: "An archetype reveal and a kit of three",
    questionRange: [4, 5],
    questionRangeLabel: "4–5 questions",
    resultsShapeLabel: "archetype reveal + a kit",
    introType: "hero",
    emailPlacementDefault: "after_results",
    loading: "absent",
    visualQuestions: "optional",
    imageryModel: "cutout",
    resultsMarker: "gq-t4r",
    gates: "assigned only on playful signals — never a fallback",
    ineligibleReason: "Fits playful brands",
  },
  t5: {
    id: "t5",
    name: "Clean",
    componentName: "TplClean",
    rootClass: "gq-t5",
    shopperQuestion: "Any of the above, with no imagery.",
    outputShape: "A simple grid",
    questionRange: [4, 6],
    questionRangeLabel: "4–6 questions",
    resultsShapeLabel: "The fallback. Every other template degrades here.",
    introType: "minimal",
    emailPlacementDefault: "after_results",
    loading: "absent",
    visualQuestions: "absent",
    imageryModel: "none",
    resultsMarker: "gq-t5r",
    gates: "always eligible — the universal default and every degradation's destination",
    ineligibleReason: "",
  },
};

export function defaultIntroType(template: TemplateId): IntroType {
  return TEMPLATES[template].introType;
}

export function defaultEmailPlacement(template: TemplateId): EmailPlacement {
  return TEMPLATES[template].emailPlacementDefault;
}

// ---------------------------------------------------------------------
// Image slots (spec 4.3)
// ---------------------------------------------------------------------

export interface SlotDecl {
  key: string;
  kind: SlotKind;
  ratio: string;
  screen: "intro" | "question" | "results";
  screenLabel: string;
  label: string;
  optional: boolean;
  sizePx?: number;
  autoSource?: string;
}

export interface SlotFlowOption {
  label: string;
  axisValueValue: string;
  imageUrl?: string | null;
  selectAll?: boolean;
  displayMeta?: Record<string, unknown> | null;
}
export interface SlotFlowQuestion {
  axisKey: string;
  prompt: string;
  options: SlotFlowOption[];
}
export interface SlotFlow {
  questions: SlotFlowQuestion[];
}

/** A question is "visual" (S2) when at least one answer carries artwork. */
export function isVisualQuestion(q: SlotFlowQuestion): boolean {
  return q.options.some((o) => {
    if (o.selectAll) return false;
    if ((o.imageUrl ?? "").trim()) return true;
    const meta = o.displayMeta ?? {};
    return typeof meta.swatch === "string" || typeof meta.swatch2 === "string";
  });
}

/** The slot key for an answer tile: `answer:{axisKey}:{axisValue}`. */
export function answerSlotKey(axisKey: string, axisValue: string): string {
  return `answer:${axisKey}:${axisValue}`;
}

export const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  hero: "Hero photo",
  lifestyle: "Lifestyle",
  product: "Product",
  variant: "Variant photo",
  swatch: "Swatch",
  icon: "Icon",
  logo: "Logo",
  thumb: "Thumbnail",
};

function questionLabel(q: SlotFlowQuestion, index: number): string {
  const prompt = q.prompt.trim();
  return `Q${index + 1} · ${prompt.length > 28 ? prompt.slice(0, 27).trimEnd() + "…" : prompt || "Untitled"}`;
}

/**
 * Every image position the template declares for THIS quiz, in rail order
 * (intro → questions → results). The Images rail, the widget and the
 * generation report all read this one function.
 */
export function declareSlots(
  template: TemplateId,
  flow: SlotFlow,
  opts: { hasFounder?: boolean } = {}
): SlotDecl[] {
  const out: SlotDecl[] = [];
  const answerSlots = (kind: SlotKind, ratio: string, optional: boolean, sizePx?: number) => {
    flow.questions.forEach((q, i) => {
      if (!isVisualQuestion(q)) return;
      for (const o of q.options) {
        if (o.selectAll || !o.axisValueValue) continue;
        out.push({
          key: answerSlotKey(q.axisKey, o.axisValueValue),
          kind,
          ratio,
          screen: "question",
          screenLabel: questionLabel(q, i),
          label: `Answer · ${o.label || o.axisValueValue}`,
          optional,
          ...(sizePx ? { sizePx } : {}),
        });
      }
    });
  };
  const results = (label: string, sizePx?: number) =>
    out.push({
      key: "results",
      kind: "product",
      ratio: "1:1",
      screen: "results",
      screenLabel: "Results",
      label,
      optional: true,
      autoSource: "Product images (auto)",
      ...(sizePx ? { sizePx } : {}),
    });

  switch (template) {
    case "t1":
      out.push({
        key: "hero",
        kind: "hero",
        ratio: "16:9",
        screen: "intro",
        screenLabel: "Intro",
        label: "Hero photo",
        optional: false,
      });
      answerSlots("variant", "1:1", false);
      results("Match cards");
      break;
    case "t2":
      out.push({
        key: "preview",
        kind: "product",
        ratio: "16:10",
        screen: "intro",
        screenLabel: "Intro",
        label: "Preview card product",
        optional: true,
      });
      answerSlots("lifestyle", "3:2", false);
      results("Top pick + alternates");
      break;
    case "t3":
      out.push({
        key: "founder",
        kind: "hero",
        ratio: "1:1",
        screen: "intro",
        screenLabel: "Intro",
        label: "Founder portrait",
        optional: true,
        sizePx: 160,
      });
      answerSlots("icon", "1:1", true, 96);
      results("Regimen steps", 72);
      break;
    case "t4":
      out.push({
        key: "hero",
        kind: "hero",
        ratio: "16:9",
        screen: "intro",
        screenLabel: "Intro",
        label: "Hero photo",
        optional: true,
      });
      answerSlots("thumb", "1:1", true, 64);
      results("Hero product + kit");
      break;
    case "t5":
    default:
      results("Match cards");
      break;
  }
  return out;
}

// ---------------------------------------------------------------------
// Match phases (spec T1): [{label, axisKeys}] must be a contiguous,
// exhaustive partition of the question order. Anything else (a question
// removed/added/reordered in the Studio since generation) is stale and
// callers fall back to the plain segmented header.
// ---------------------------------------------------------------------

export interface QuizPhase {
  label: string;
  axisKeys: string[];
}

export function phasesPartitionFlow(phases: unknown, axisKeysInOrder: string[]): phases is QuizPhase[] {
  if (!Array.isArray(phases) || phases.length < 1 || phases.length > 4) return false;
  const flat: string[] = [];
  for (const p of phases) {
    if (!p || typeof p !== "object") return false;
    const { label, axisKeys } = p as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) return false;
    if (!Array.isArray(axisKeys) || axisKeys.length === 0) return false;
    for (const k of axisKeys) {
      if (typeof k !== "string") return false;
      flat.push(k);
    }
  }
  if (flat.length !== axisKeysInOrder.length) return false;
  return flat.every((k, i) => k === axisKeysInOrder[i]);
}

// ---------------------------------------------------------------------
// Token resolution: the template's own style → Brand Profile accent + body
// font → the style's radius clamp. Only the accent pair and the body font
// come from the brand so the five designs stay visibly distinct (the
// merchant's Style-panel overrides are applied on top by the widget).
// Null when no template is assigned (legacy shops).
// ---------------------------------------------------------------------

const BRAND_OVERLAY_KEYS: Array<keyof BrandTokens> = ["colorAccent", "colorAccentText", "fontBody"];

export function resolveQuizTokens(template: string | null, brandTokens: BrandTokens | null): BrandTokens | null {
  if (!isTemplateId(template)) return null;
  const style = TEMPLATE_STYLES[template];
  const base: BrandTokens = { ...style.tokens };
  if (brandTokens) {
    for (const key of BRAND_OVERLAY_KEYS) {
      const v = brandTokens[key];
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && !v.trim()) continue;
      (base as unknown as Record<string, unknown>)[key] = v;
    }
  }
  const clamp = (n: number) => Math.max(style.radiusMin, Math.min(style.radiusCap, Math.round(n)));
  base.radiusButton = clamp(base.radiusButton);
  base.radiusCard = clamp(base.radiusCard);
  return base;
}

// ---------------------------------------------------------------------
// Deterministic selection — v3 (spec 2.4). Template from CATALOG STRUCTURE.
// Same inputs → same output; every assignment explainable via `signals`.
// ---------------------------------------------------------------------

export interface TemplateSignals {
  /** Share (0-1) of products carrying shade/size/finish-type options. */
  variantOptionDensity: number | null;
  avgPriceCents: number | null;
  /** Average spec facets (variant option dimensions) per product. */
  avgOptionCount: number | null;
  productCount: number;
  /** Products tagged/collected as steps, AM/PM, kits, "routine", "set". */
  routineSignals: number;
  /** Gift collections + playful copy hits. */
  giftSignals: number;
  playfulCopy: boolean;
  lowAov: boolean;
  category: string | null;
  // Image gates (store-level approximations; the validator re-checks).
  imagePerAnswerCoverage: number | null;
  lifestyleImageCount: number;
  bannerCoverage: number | null;
}

export interface TemplateAssignment {
  template: TemplateId;
  scores: Record<TemplateId, number>;
  signals: string[];
  eligible: TemplateId[];
  /** Set when an image gate pushed the winner down to T5 (spec 2.4). */
  degradedFrom?: TemplateId;
}

const VISUAL_ATTR_CATEGORY = /color|colour|shade|nail|lash|hair-?colou?r|cosmetic|makeup|lip|tile|paint|interior/i;
const CONSIDERED_CATEGORY =
  /fragrance|perfume|furniture|mattress|bed|appliance|electronic|bike|stroller|luggage|outdoor|jewel/i;
const ROUTINE_CATEGORY = /skincare|skin-?care|supplement|vitamin|wellness|haircare|hair-?care|oral/i;
const PLAYFUL_CATEGORY = /candy|snack|toy|sticker|party|drink|nail|press-?on/i;

export function isTemplateEligible(id: TemplateId, s: TemplateSignals): boolean {
  if (id === "t1") return (s.imagePerAnswerCoverage ?? 0) >= 0.8;
  if (id === "t2") return s.lifestyleImageCount >= 1 || (s.bannerCoverage ?? 0) >= 0.8;
  return true; // t3/t4 have no image gate; t5 always
}

export function selectTemplate(s: TemplateSignals): TemplateAssignment {
  const scores: Record<TemplateId, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
  const fired: string[] = [];
  let t4Own = 0;

  // --- T1 Match: one correct answer exists (variant option density) ---
  if ((s.variantOptionDensity ?? 0) >= 0.6) {
    scores.t1 += 4;
    fired.push("variant-density");
  }
  if ((s.imagePerAnswerCoverage ?? 0) >= 0.8) {
    scores.t1 += 1;
    fired.push("answer-image-coverage");
  }
  if (s.category && VISUAL_ATTR_CATEGORY.test(s.category)) {
    scores.t1 += 2;
    fired.push("visual-attribute-category");
  }

  // --- T2 Consult: price band + spec facets + low SKU count ---
  if ((s.avgPriceCents ?? 0) >= 15000) {
    scores.t2 += 2;
    fired.push("high-aov");
  }
  if ((s.avgOptionCount ?? 0) >= 3) {
    scores.t2 += 2;
    fired.push("spec-heavy");
  }
  if (s.productCount > 0 && s.productCount <= 25) {
    scores.t2 += 1;
    fired.push("low-sku");
  }
  if (s.category && CONSIDERED_CATEGORY.test(s.category)) {
    scores.t2 += 2;
    fired.push("considered-category");
  }

  // --- T3 Routine: the answer is a set ---
  if (s.routineSignals >= 3) {
    scores.t3 += 4;
    fired.push("routine-signals");
  } else if (s.routineSignals >= 1) {
    scores.t3 += 2;
    fired.push("routine-hints");
  }
  if (s.category && ROUTINE_CATEGORY.test(s.category)) {
    scores.t3 += 2;
    fired.push("routine-category");
  }

  // --- T4 Discover: earned only (own points ≥ 5), never a fallback ---
  if (s.playfulCopy) {
    scores.t4 += 2;
    t4Own += 2;
    fired.push("playful-copy");
  }
  if (s.giftSignals >= 1) {
    scores.t4 += 2;
    t4Own += 2;
    fired.push("gift-signals");
  }
  if (s.lowAov) {
    scores.t4 += 1;
    t4Own += 1;
    fired.push("low-aov");
  }
  if (s.category && PLAYFUL_CATEGORY.test(s.category)) {
    scores.t4 += 1;
    t4Own += 1;
    fired.push("playful-category");
  }
  if (t4Own < 5) scores.t4 = 0;

  const eligible = TEMPLATE_IDS.filter((id) => isTemplateEligible(id, s));
  let degradedFrom: TemplateId | undefined;
  for (const id of TEMPLATE_IDS) {
    if (!eligible.includes(id)) {
      if (scores[id] > 0 && (!degradedFrom || scores[id] > scores[degradedFrom])) degradedFrom = id;
      scores[id] = 0;
    }
  }

  // Highest score wins; ties (and nothing meaningful firing) → T5 Clean.
  let winner: TemplateId = "t5";
  let best = 1;
  let tie = false;
  for (const id of TEMPLATE_IDS) {
    if (id === "t5" || !eligible.includes(id)) continue;
    if (scores[id] > best) {
      best = scores[id];
      winner = id;
      tie = false;
    } else if (scores[id] === best && best > 1) {
      tie = true;
    }
  }
  if (tie) winner = "t5";

  const out: TemplateAssignment = { template: winner, scores, signals: fired, eligible };
  if (winner === "t5" && degradedFrom) out.degradedFrom = degradedFrom;
  return out;
}

/** Human line for the scope screen: "shade-based beauty store". */
export function describeStoreType(assignment: TemplateAssignment, category: string | null): string | null {
  const cat = (category ?? "").replace(/[-_]/g, " ").trim();
  const base = cat || "store";
  // Stored pre-v3 profiles can lack `signals`; this runs after the paid
  // model call, so it must never throw on a partial assignment.
  const signals = Array.isArray(assignment?.signals) ? assignment.signals : [];
  switch (assignment?.template) {
    case "t1":
      return signals.includes("variant-density") ? `shade- or size-based ${base}` : `${base} with variant choices`;
    case "t2":
      return `considered-purchase ${base}`;
    case "t3":
      return `${base} with step-based routines`;
    case "t4":
      return `playful ${base}`;
    default:
      return cat ? `${base}` : null;
  }
}
