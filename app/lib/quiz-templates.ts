/**
 * Overhaul template registry — v2 (docs/overhaul/V2-SPEC.md Part 3).
 * Supersedes the v1 registry (Contract 3): templates are STORE TYPES with
 * structural layouts, not token swaps. The widget renders each template as
 * a distinct root layout (TplSalon..TplClean render paths keyed off
 * rootClass gq-t1..gq-t5); this module remains the single source of truth
 * for ids, presets, eligibility gates, and the deterministic selector.
 *
 * v2 mapping (spec 3): elegant/luxury/fragrance → T1 Salon · visual-
 * attribute beauty → T2 Studio · considered purchases → T3 Guide ·
 * playful (earned, never fallback) → T4 Pop · everything else and every
 * degradation → T5 Clean. Ties break toward T5.
 */

export type TemplateId = "t1" | "t2" | "t3" | "t4" | "t5";

export const TEMPLATE_IDS: TemplateId[] = ["t1", "t2", "t3", "t4", "t5"];

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

export interface TemplatePreset {
  id: string;
  label: string;
  tokens: BrandTokens;
}

export interface TemplateDef {
  id: TemplateId;
  name: string;
  /** One-line who-it's-for, shown on overlay cards (spec 2.4). */
  whoFor: string;
  rootClass: string;
  /** Structural contract consumed by generator + studio UI. */
  questionRange: [number, number];
  /** Results layout marker for snapshot tests (spec 3.6). */
  resultsLayout: "prose" | "shade-reveal" | "comparison" | "archetype" | "grid";
  /** Imagery model (spec Part 4.2) — drives eligibility + Images rail slots. */
  imageryModel: "hero" | "per-answer" | "per-question" | "cutout" | "none";
  eligibility: string;
  ineligibleReason: string;
  presets: TemplatePreset[];
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const ROUNDED =
  '"Avenir Next Rounded", "Nunito", "Quicksand", -apple-system, BlinkMacSystemFont, sans-serif';

function preset(
  id: string,
  label: string,
  t: Partial<BrandTokens> & Pick<BrandTokens, "colorBg" | "colorText" | "colorAccent">
): TemplatePreset {
  return {
    id,
    label,
    tokens: {
      fontHeading: t.fontHeading ?? SERIF,
      fontBody: t.fontBody ?? SANS,
      colorBg: t.colorBg,
      colorText: t.colorText,
      colorAccent: t.colorAccent,
      colorAccentText: t.colorAccentText ?? "#ffffff",
      colorSurface: t.colorSurface ?? "#ffffff",
      colorBorder: t.colorBorder ?? "rgba(22, 22, 26, 0.18)",
      radiusButton: t.radiusButton ?? 12,
      radiusCard: t.radiusCard ?? 18,
      spaceUnit: t.spaceUnit ?? 4,
      maxWidth: t.maxWidth ?? 1080,
    },
  };
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  t1: {
    id: "t1",
    name: "Salon",
    whoFor: "For elegant, editorial brands · 4–5 questions · consultation results",
    rootClass: "gq-t1",
    questionRange: [4, 5],
    resultsLayout: "prose",
    imageryModel: "hero",
    eligibility: "≥1 brand hero image (portrait or landscape ≥1200px)",
    ineligibleReason: "Needs a brand hero image",
    presets: [
      // Wireframe demo (Maison Véla): warm ivory + deep moss accent.
      preset("t1-ivory", "Ivory", {
        colorBg: "#f5f2eb",
        colorText: "#211e19",
        colorAccent: "#3e4a3d",
        colorSurface: "#fbf9f4",
        colorBorder: "rgba(33, 30, 25, 0.16)",
        radiusButton: 2,
        radiusCard: 4,
        spaceUnit: 12,
        maxWidth: 1200,
      }),
      preset("t1-noir", "Noir", {
        colorBg: "#17150f",
        colorText: "#f2efe6",
        colorAccent: "#cfc4ad",
        colorAccentText: "#17150f",
        colorSurface: "rgba(255, 255, 255, 0.06)",
        colorBorder: "rgba(242, 239, 230, 0.22)",
        radiusButton: 2,
        radiusCard: 4,
        spaceUnit: 12,
        maxWidth: 1200,
      }),
    ],
  },
  t2: {
    id: "t2",
    name: "Studio",
    whoFor: "Shade & visual-attribute finders · answers are the visuals",
    rootClass: "gq-t2",
    questionRange: [4, 6],
    resultsLayout: "shade-reveal",
    imageryModel: "per-answer",
    eligibility: "≥80% of generated answers have a resolvable image",
    ineligibleReason: "Needs an image for most answers",
    presets: [
      // Wireframe demo (Tint Beauty): white + berry accent.
      preset("t2-blanc", "Blanc", {
        fontHeading: SANS,
        colorBg: "#ffffff",
        colorText: "#191517",
        colorAccent: "#b04a5a",
        colorSurface: "#faf6f7",
        colorBorder: "#f0e6e8",
        radiusButton: 10,
        radiusCard: 12,
        maxWidth: 880,
      }),
      preset("t2-rose", "Rose", {
        fontHeading: SANS,
        colorBg: "#fdf7f5",
        colorText: "#231a1c",
        colorAccent: "#8e3742",
        colorSurface: "#ffffff",
        colorBorder: "#eeddda",
        radiusButton: 10,
        radiusCard: 12,
        maxWidth: 880,
      }),
    ],
  },
  t3: {
    id: "t3",
    name: "Guide",
    whoFor: "Considered purchases · 6–8 questions · comparison results",
    rootClass: "gq-t3",
    questionRange: [6, 8],
    resultsLayout: "comparison",
    imageryModel: "per-question",
    eligibility:
      "≥1 lifestyle/landscape image ≥1600px per question, or collection banners for ≥80% of questions",
    ineligibleReason: "Needs lifestyle photos",
    presets: [
      // Wireframe demo (Fernwood Sleep): warm paper + fern accent.
      preset("t3-fern", "Fern", {
        colorBg: "#fafaf7",
        colorText: "#23262b",
        colorAccent: "#2e5e4e",
        colorSurface: "#ffffff",
        colorBorder: "#e2e4e0",
        radiusButton: 10,
        radiusCard: 12,
        maxWidth: 960,
      }),
      preset("t3-slate", "Slate", {
        colorBg: "#f4f5f7",
        colorText: "#1f2329",
        colorAccent: "#33526e",
        colorSurface: "#ffffff",
        colorBorder: "#dfe2e7",
        radiusButton: 10,
        radiusCard: 12,
        maxWidth: 960,
      }),
    ],
  },
  t4: {
    id: "t4",
    name: "Pop",
    whoFor: "Playful brands · personality reveal + bundle results",
    rootClass: "gq-t4",
    questionRange: [4, 5],
    resultsLayout: "archetype",
    imageryModel: "cutout",
    eligibility: "≥5 points of playful brand signals — never the fallback",
    ineligibleReason: "Fits playful brands",
    presets: [
      // Wireframe demo (GlowPop): cream + hot pink, rounded stack.
      preset("t4-sorbet", "Sorbet", {
        fontHeading: ROUNDED,
        fontBody: SANS,
        colorBg: "#fff6ea",
        colorText: "#2a2118",
        colorAccent: "#ff5c8a",
        colorSurface: "#ffffff",
        colorBorder: "#f0dcc4",
        radiusButton: 14,
        radiusCard: 18,
        maxWidth: 720,
      }),
      preset("t4-pop", "Pop", {
        fontHeading: ROUNDED,
        fontBody: SANS,
        colorBg: "#ffffff",
        colorText: "#1d1a26",
        colorAccent: "#7c5cff",
        colorSurface: "#f7f5ff",
        colorBorder: "#e6e1ff",
        radiusButton: 14,
        radiusCard: 18,
        maxWidth: 720,
      }),
    ],
  },
  t5: {
    id: "t5",
    name: "Clean",
    whoFor: "Universal default · works with zero imagery",
    rootClass: "gq-t5",
    questionRange: [4, 6],
    resultsLayout: "grid",
    imageryModel: "none",
    eligibility: "always — the universal default and every degradation's destination",
    ineligibleReason: "",
    presets: [
      // Wireframe demo (Aria Skincare): white + steel blue.
      preset("t5-paper", "Paper", {
        fontHeading: SANS,
        colorBg: "#ffffff",
        colorText: "#16181b",
        colorAccent: "#2f5aa8",
        colorSurface: "#f6f8fc",
        colorBorder: "#e4e6ea",
        radiusButton: 8,
        radiusCard: 10,
        spaceUnit: 10,
        maxWidth: 640,
      }),
      preset("t5-ivory", "Ivory", {
        colorBg: "#faf8f3",
        colorText: "#221f1b",
        colorAccent: "#6b5d43",
        colorSurface: "#ffffff",
        colorBorder: "#e7e3d8",
        radiusButton: 8,
        radiusCard: 10,
        spaceUnit: 10,
        maxWidth: 640,
      }),
    ],
  },
};

/**
 * Resolve the token bundle a render should consume. Precedence at render
 * time (v1 Contract 2 — still binding): merchant Studio overrides (applied
 * client-side after these) > preset (an explicit merchant pick) > extracted
 * brand tokens > the template's first preset. Returns null when no template
 * is assigned — legacy shops render exactly as before.
 */
export function resolveQuizTokens(
  template: string | null,
  presetId: string | null,
  brandTokens: BrandTokens | null
): BrandTokens | null {
  if (!template || !TEMPLATE_IDS.includes(template as TemplateId)) return null;
  if (presetId) {
    const p = findPreset(presetId);
    if (p) return p.tokens; // explicit pick wins whole — predictable look
  }
  if (brandTokens) return brandTokens;
  return TEMPLATES[template as TemplateId].presets[0].tokens;
}

export function findPreset(presetId: string): TemplatePreset | null {
  for (const t of TEMPLATE_IDS) {
    const hit = TEMPLATES[t].presets.find((p) => p.id === presetId);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------
// Deterministic template selection — v2 mapping (spec Part 3). Same
// inputs → same template; persisted on the Brand Profile and in the
// template_assigned event so every assignment is explainable.
// ---------------------------------------------------------------------

export interface TemplateSignals {
  serifHeading: boolean;
  roundedHeading: boolean;
  /** 0-1 average saturation of the homepage palette. */
  avgSaturation: number | null;
  /** 0-1 area share of imagery above the homepage fold. */
  imageryDensity: number | null;
  /** Count of landscape images ≥1600px wide (homepage / Brand API cover). */
  lifestyleImageCount: number;
  /** 0-1 share of answers (pre-generation: variants) with a resolvable image. */
  imagePerAnswerCoverage: number | null;
  /** Extracted button radius in px, when known. */
  buttonRadius: number | null;
  /** P1 category guess, e.g. "color-cosmetics". */
  category: string | null;
  // --- v2 additions (all optional so v1 extraction keeps compiling; the
  // brand library backfills them as it lands) ---
  /** Count of brand hero candidates ≥1200px (homepage hero / Brand API cover). */
  heroImageCount?: number;
  /** 0-1 share of questions coverable by collection banners. */
  bannerCoverage?: number | null;
  /** Average catalog price in cents — considered-purchase signal. */
  avgPriceCents?: number | null;
  /** Average variant option (spec facet) count per product. */
  avgOptionCount?: number | null;
}

export interface TemplateAssignment {
  template: TemplateId;
  scores: Record<TemplateId, number>;
  signals: string[];
  eligible: TemplateId[];
  /** Set when an eligibility gate pushed the winner down to T5 (spec 4.3). */
  degradedFrom?: TemplateId;
}

const ELEGANT_CATEGORY = /fragrance|perfume|luxur|jewel|candle|skincare-premium/i;
const VISUAL_ATTR_CATEGORY = /color|shade|nail|lash|hair|beauty|cosmetic|makeup|lip/i;
const CONSIDERED_CATEGORY =
  /furniture|mattress|bed|appliance|electronic|bike|stroller|luggage|outdoor/i;
const PLAYFUL_CATEGORY = /candy|snack|toy|sticker|party|drink/i;

export function isTemplateEligible(id: TemplateId, s: TemplateSignals): boolean {
  // Hard gates checked before scoring (spec Part 3). The validator re-checks
  // the per-question/per-answer versions post-generation; these are the
  // store-level approximations available at selection time.
  if (id === "t1") return (s.heroImageCount ?? s.lifestyleImageCount) >= 1;
  if (id === "t2") return (s.imagePerAnswerCoverage ?? 0) >= 0.8;
  if (id === "t3")
    return s.lifestyleImageCount >= 1 || (s.bannerCoverage ?? 0) >= 0.8;
  return true; // t4 has no imagery gate (earned by signals); t5 always
}

export function selectTemplate(s: TemplateSignals): TemplateAssignment {
  const scores: Record<TemplateId, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
  const fired: string[] = [];
  // T4's ≥5-own-points rule (v2: Pop is earned, never a fallback): track
  // its own signal points so shared bumps can't smuggle it past the bar.
  let t4Own = 0;

  // --- T1 Salon: elegant / luxury / fragrance ---
  if (s.serifHeading) {
    scores.t1 += 3;
    fired.push("serif-heading");
  }
  if (s.avgSaturation !== null && s.avgSaturation < 0.25) {
    scores.t1 += 2;
    fired.push("muted-palette");
  }
  if (s.category && ELEGANT_CATEGORY.test(s.category)) {
    scores.t1 += 3;
    fired.push("elegant-category");
  }

  // --- T2 Studio: visual-attribute beauty (shade/color/shape catalogs) ---
  if (s.category && VISUAL_ATTR_CATEGORY.test(s.category)) {
    scores.t2 += 3;
    fired.push("visual-attribute-category");
  }
  if ((s.imagePerAnswerCoverage ?? 0) >= 0.8) {
    scores.t2 += 2;
    fired.push("answer-image-coverage");
  }

  // --- T3 Guide: considered purchases (spec-heavy, high AOV) ---
  if (s.category && CONSIDERED_CATEGORY.test(s.category)) {
    scores.t3 += 3;
    fired.push("considered-category");
  }
  if ((s.avgPriceCents ?? 0) >= 15000) {
    scores.t3 += 2;
    fired.push("high-aov");
  }
  if ((s.avgOptionCount ?? 0) >= 3) {
    scores.t3 += 1;
    fired.push("spec-heavy");
  }

  // --- T4 Pop: playful, earned only ---
  if (
    (s.avgSaturation !== null && s.avgSaturation > 0.55) ||
    (s.buttonRadius !== null && s.buttonRadius >= 16)
  ) {
    scores.t4 += 3;
    t4Own += 3;
    fired.push("bright-or-round");
  }
  if (s.roundedHeading) {
    scores.t4 += 2;
    t4Own += 2;
    fired.push("rounded-heading");
  }
  if (s.category && PLAYFUL_CATEGORY.test(s.category)) {
    scores.t4 += 2;
    t4Own += 2;
    fired.push("playful-category");
  }

  const eligible = TEMPLATE_IDS.filter((id) => isTemplateEligible(id, s));
  // Track what the gates cost us so degradations are explainable (4.3).
  let degradedFrom: TemplateId | undefined;
  for (const id of TEMPLATE_IDS) {
    if (!eligible.includes(id)) {
      if (scores[id] > 0 && (!degradedFrom || scores[id] > scores[degradedFrom])) {
        degradedFrom = id;
      }
      scores[id] = 0;
    }
  }
  if (t4Own < 5) scores.t4 = 0; // Pop never wins by default or shared bumps

  // Highest score wins; ties and no-signal profiles break toward T5 Clean.
  // Threshold: a top score under 2 means nothing meaningful fired.
  let winner: TemplateId = "t5";
  let best = 1; // must strictly beat this to displace t5
  for (const id of TEMPLATE_IDS) {
    if (id === "t5" || !eligible.includes(id)) continue;
    if (scores[id] > best) {
      best = scores[id];
      winner = id;
    }
  }

  const out: TemplateAssignment = { template: winner, scores, signals: fired, eligible };
  if (winner === "t5" && degradedFrom) out.degradedFrom = degradedFrom;
  return out;
}
