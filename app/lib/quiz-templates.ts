/**
 * Overhaul template registry — Contract 3 in docs/overhaul/CONTRACTS.md.
 *
 * Single source of truth for the five hand-designed quiz templates, their
 * presets (complete token bundles), and the deterministic template
 * selector. Pure module (no server deps) so the studio UI, the config
 * serializers, and the extraction pipeline all import the same registry.
 *
 * A template is a layout composition the widget applies as a root class
 * (gq-t1..gq-t5) + a default token bundle + answer-format defaults. There
 * are no template-specific components and no free-form AI CSS — AI only
 * selects a template and pours tokens/content into it.
 */

export type TemplateId = "t1" | "t2" | "t3" | "t4" | "t5";

export const TEMPLATE_IDS: TemplateId[] = ["t1", "t2", "t3", "t4", "t5"];

/** The 12-token contract (Contract 1). Values are CSS-ready. */
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
  rootClass: string;
  /** One-line eligibility rule; enforced by isTemplateEligible below. */
  eligibility: string;
  /** Shown in switchers when the template is disabled. */
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
    name: "Editorial Split",
    rootClass: "gq-t1",
    eligibility: "always",
    ineligibleReason: "",
    presets: [
      preset("t1-gallery", "Gallery", {
        colorBg: "#faf7f2",
        colorText: "#1c1a17",
        colorAccent: "#8a6d4b",
        colorSurface: "#ffffff",
        radiusButton: 4,
        radiusCard: 8,
      }),
      preset("t1-ink", "Ink", {
        colorBg: "#ffffff",
        colorText: "#111114",
        colorAccent: "#111114",
        colorSurface: "#f7f7f7",
        radiusButton: 2,
        radiusCard: 6,
      }),
    ],
  },
  t2: {
    id: "t2",
    name: "Centered Minimal",
    rootClass: "gq-t2",
    eligibility: "always — the safe default",
    ineligibleReason: "",
    presets: [
      preset("t2-ivory", "Ivory", {
        colorBg: "#f6f2ea",
        colorText: "#26231e",
        colorAccent: "#4a4437",
        colorSurface: "#fbf9f4",
        radiusButton: 8,
        radiusCard: 12,
        maxWidth: 680,
      }),
      preset("t2-ink", "Ink", {
        fontHeading: SANS,
        colorBg: "#ffffff",
        colorText: "#17171a",
        colorAccent: "#17171a",
        colorSurface: "#fafafa",
        radiusButton: 6,
        radiusCard: 10,
        maxWidth: 680,
      }),
    ],
  },
  t3: {
    id: "t3",
    name: "Full-Bleed Immersive",
    rootClass: "gq-t3",
    eligibility: "one suitable landscape lifestyle image (≥1600px) available",
    ineligibleReason: "Needs lifestyle imagery",
    presets: [
      preset("t3-noir", "Noir", {
        colorBg: "#141414",
        colorText: "#ffffff",
        colorAccent: "#e8ddca",
        colorAccentText: "#141414",
        colorSurface: "rgba(255, 255, 255, 0.14)",
        colorBorder: "rgba(255, 255, 255, 0.3)",
        radiusButton: 10,
        radiusCard: 14,
      }),
      preset("t3-dawn", "Dawn", {
        colorBg: "#f3ede4",
        colorText: "#241f1a",
        colorAccent: "#a3552e",
        colorSurface: "rgba(255, 255, 255, 0.55)",
        colorBorder: "rgba(36, 31, 26, 0.25)",
        radiusButton: 10,
        radiusCard: 14,
      }),
    ],
  },
  t4: {
    id: "t4",
    name: "Gallery",
    rootClass: "gq-t4",
    eligibility: "an image per answer for most questions",
    ineligibleReason: "Needs product images per answer",
    presets: [
      preset("t4-air", "Air", {
        fontHeading: SANS,
        colorBg: "#ffffff",
        colorText: "#1a1a1e",
        colorAccent: "#2b6e5f",
        colorSurface: "#f6f6f7",
        radiusButton: 10,
        radiusCard: 12,
      }),
      preset("t4-studio", "Studio", {
        colorBg: "#f8f5f1",
        colorText: "#201d19",
        colorAccent: "#b05e3c",
        colorSurface: "#ffffff",
        radiusButton: 10,
        radiusCard: 12,
      }),
    ],
  },
  t5: {
    id: "t5",
    name: "Playful Cards",
    rootClass: "gq-t5",
    eligibility: "≥5 points of playful brand signals — never the fallback",
    ineligibleReason: "Fits playful brands",
    presets: [
      preset("t5-sorbet", "Sorbet", {
        fontHeading: ROUNDED,
        fontBody: SANS,
        colorBg: "#fff8ef",
        colorText: "#2b2320",
        colorAccent: "#f2695c",
        colorSurface: "#ffffff",
        radiusButton: 18,
        radiusCard: 22,
      }),
      preset("t5-pop", "Pop", {
        fontHeading: ROUNDED,
        fontBody: SANS,
        colorBg: "#ffffff",
        colorText: "#1d1a26",
        colorAccent: "#7c5cff",
        colorSurface: "#f7f5ff",
        radiusButton: 18,
        radiusCard: 22,
      }),
    ],
  },
};

/**
 * Resolve the token bundle a render should consume. Precedence at render
 * time (Contract 2): merchant Studio overrides (applied client-side after
 * these) > preset (an explicit merchant pick) > extracted brand tokens >
 * the template's first preset. Returns null when no template is assigned —
 * legacy shops render exactly as before.
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
// Deterministic template selection (spec Part 2). Same inputs → same
// template. The full payload is persisted on the Brand Profile and in the
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
  /** 0-1 share of catalog products that have an image. */
  imagePerAnswerCoverage: number | null;
  /** Extracted button radius in px, when known. */
  buttonRadius: number | null;
  /** P1 category guess, e.g. "color-cosmetics". */
  category: string | null;
}

export interface TemplateAssignment {
  template: TemplateId;
  scores: Record<TemplateId, number>;
  signals: string[];
  eligible: TemplateId[];
}

export function isTemplateEligible(id: TemplateId, s: TemplateSignals): boolean {
  if (id === "t3") return s.lifestyleImageCount >= 1 && (s.imageryDensity ?? 0) >= 0.2;
  if (id === "t4") return (s.imagePerAnswerCoverage ?? 0) >= 0.6;
  return true;
}

export function selectTemplate(s: TemplateSignals): TemplateAssignment {
  const scores: Record<TemplateId, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
  const fired: string[] = [];
  // T5's ≥5-own-points rule: track its signal points separately so shared
  // bumps (t4+1 from bright palette) can't smuggle it past the bar.
  let t5Own = 0;

  if (s.serifHeading) {
    scores.t1 += 3;
    scores.t2 += 2;
    fired.push("serif-heading");
  }
  if (s.avgSaturation !== null && s.avgSaturation < 0.25) {
    scores.t2 += 3;
    scores.t1 += 2;
    fired.push("muted-palette");
  }
  if ((s.imageryDensity ?? 0) >= 0.35 && s.lifestyleImageCount >= 1) {
    scores.t3 += 3;
    scores.t1 += 1;
    fired.push("high-imagery");
  }
  if ((s.imagePerAnswerCoverage ?? 0) >= 0.6) {
    scores.t4 += 3;
    fired.push("image-per-answer");
  }
  if (
    (s.avgSaturation !== null && s.avgSaturation > 0.55) ||
    (s.buttonRadius !== null && s.buttonRadius >= 16)
  ) {
    scores.t5 += 3;
    t5Own += 3;
    scores.t4 += 1;
    fired.push("bright-or-round");
  }
  if (s.roundedHeading) {
    scores.t5 += 2;
    t5Own += 2;
    fired.push("rounded-heading");
  }
  if (s.category && /color|nail|beauty|cosmetic|makeup/i.test(s.category)) {
    scores.t4 += 2;
    scores.t1 += 1;
    fired.push("beauty-color-category");
  }

  const eligible = TEMPLATE_IDS.filter((id) => isTemplateEligible(id, s));
  for (const id of TEMPLATE_IDS) if (!eligible.includes(id)) scores[id] = 0;
  if (t5Own < 5) scores.t5 = 0; // never wins by default or via shared bumps

  // Highest score wins; ties (and no-signal profiles) break toward t2.
  // Threshold: a top score under 2 means nothing meaningful fired.
  let winner: TemplateId = "t2";
  let best = 1; // must strictly beat this to displace t2
  for (const id of TEMPLATE_IDS) {
    if (!eligible.includes(id)) continue;
    if (scores[id] > best) {
      best = scores[id];
      winner = id;
    }
  }
  // Ties break toward t2: if t2 matches the winner's score, t2 takes it.
  if (winner !== "t2" && eligible.includes("t2") && scores.t2 === scores[winner]) {
    winner = "t2";
  }

  return { template: winner, scores, signals: fired, eligible };
}
