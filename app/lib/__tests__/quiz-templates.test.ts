import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  TEMPLATE_IDS,
  LOOKS,
  LOOK_IDS,
  declareSlots,
  isVisualQuestion,
  resolveQuizTokens,
  selectLook,
  selectTemplate,
  type BrandTokens,
  type SlotFlow,
  type TemplateSignals,
  type LookSignals,
} from "../quiz-templates";

// ---------------------------------------------------------------------
// Registry invariants (V3-CONTRACTS §1/§3)
// ---------------------------------------------------------------------

describe("template registry", () => {
  it("has five templates with distinct root components, classes and results markers", () => {
    expect(TEMPLATE_IDS).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    const uniq = (pick: (id: (typeof TEMPLATE_IDS)[number]) => string) =>
      new Set(TEMPLATE_IDS.map((id) => pick(id))).size;
    expect(uniq((id) => TEMPLATES[id].componentName)).toBe(5);
    expect(uniq((id) => TEMPLATES[id].rootClass)).toBe(5);
    expect(uniq((id) => TEMPLATES[id].resultsMarker)).toBe(5);
    expect(uniq((id) => TEMPLATES[id].name)).toBe(5);
  });

  it("maps the v3 names and shopper questions (spec 2.2)", () => {
    expect(TEMPLATES.t1.name).toBe("Match");
    expect(TEMPLATES.t2.name).toBe("Consult");
    expect(TEMPLATES.t3.name).toBe("Routine");
    expect(TEMPLATES.t4.name).toBe("Discover");
    expect(TEMPLATES.t5.name).toBe("Clean");
    expect(TEMPLATES.t1.shopperQuestion).toBe("Which one is right for me?");
    expect(TEMPLATES.t2.shopperQuestion).toBe("Help me decide.");
    expect(TEMPLATES.t3.shopperQuestion).toBe("What should I use together?");
    expect(TEMPLATES.t4.shopperQuestion).toBe("What's my type?");
  });

  it("carries gallery copy for every card and a reason chip only where a gate exists", () => {
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id];
      expect(t.questionRangeLabel).not.toBe("");
      expect(t.resultsShapeLabel).not.toBe("");
      expect(t.questionRange[0]).toBeLessThanOrEqual(t.questionRange[1]);
    }
    expect(TEMPLATES.t1.ineligibleReason).not.toBe("");
    expect(TEMPLATES.t2.ineligibleReason).not.toBe("");
    expect(TEMPLATES.t5.ineligibleReason).toBe("");
  });

  it("has three looks with the spec radius switches", () => {
    expect(LOOK_IDS).toEqual(["editorial", "minimal", "bold"]);
    expect(LOOKS.editorial.switches.radiusCap).toBe(4);
    expect(LOOKS.minimal.switches.radiusCap).toBe(10);
    expect(LOOKS.bold.switches.radiusMin).toBe(16);
  });
});

// ---------------------------------------------------------------------
// declareSlots (spec 4.3)
// ---------------------------------------------------------------------

const flow: SlotFlow = {
  questions: [
    {
      axisKey: "skin_type",
      prompt: "How does your skin feel?",
      options: [
        { label: "Dry", axisValueValue: "dry" },
        { label: "Oily", axisValueValue: "oily" },
      ],
    },
    {
      axisKey: "undertone",
      prompt: "Which tones do you see on your skin?",
      options: [
        { label: "Neutral", axisValueValue: "neutral", imageUrl: "https://cdn/neutral.jpg" },
        { label: "Pink", axisValueValue: "pink", imageUrl: "https://cdn/pink.jpg" },
        { label: "Yellow", axisValueValue: "yellow" },
      ],
    },
    {
      axisKey: "finish",
      prompt: "Pick a finish",
      options: [
        { label: "Dewy", axisValueValue: "dewy", displayMeta: { swatch: "#ffd" } },
        { label: "Matte", axisValueValue: "matte" },
        { label: "Any", axisValueValue: "any", selectAll: true },
      ],
    },
  ],
};

describe("isVisualQuestion", () => {
  it("is true when any answer carries an image or swatch, ignoring select-all rows", () => {
    expect(isVisualQuestion(flow.questions[0])).toBe(false);
    expect(isVisualQuestion(flow.questions[1])).toBe(true);
    expect(isVisualQuestion(flow.questions[2])).toBe(true);
  });
});

describe("declareSlots", () => {
  const answerKeys = ["answer:undertone:neutral", "answer:undertone:pink", "answer:undertone:yellow", "answer:finish:dewy", "answer:finish:matte"];

  it("Match: required hero + required variant tile per visual answer + results", () => {
    const slots = declareSlots("t1", flow, { look: "minimal" });
    expect(slots.map((s) => s.key)).toEqual(["hero", ...answerKeys, "results"]);
    expect(slots[0]).toMatchObject({ kind: "hero", ratio: "16:9", screen: "intro", optional: false });
    for (const s of slots.filter((x) => x.screen === "question")) {
      expect(s).toMatchObject({ kind: "variant", ratio: "1:1", optional: false });
      expect(s.screenLabel).toMatch(/^Q[23] · /);
      expect(s.label).toMatch(/^Answer · /);
    }
    expect(slots[slots.length - 1]).toMatchObject({ key: "results", kind: "product", autoSource: "Product images (auto)", optional: true });
  });

  it("Match hero ratio follows the Look (4:5 under Editorial)", () => {
    expect(declareSlots("t1", flow, { look: "editorial" })[0].ratio).toBe("4:5");
  });

  it("Consult: preview product card + required lifestyle card per visual answer + results", () => {
    const slots = declareSlots("t2", flow);
    expect(slots.map((s) => s.key)).toEqual(["preview", ...answerKeys, "results"]);
    expect(slots[0]).toMatchObject({ kind: "product", ratio: "16:10", screen: "intro" });
    for (const s of slots.filter((x) => x.screen === "question")) {
      expect(s).toMatchObject({ kind: "lifestyle", ratio: "3:2", optional: false });
    }
  });

  it("Routine: optional founder portrait + optional 96px icons + 72px regimen steps", () => {
    const slots = declareSlots("t3", flow, { hasFounder: true });
    expect(slots.map((s) => s.key)).toEqual(["founder", ...answerKeys, "results"]);
    expect(slots[0]).toMatchObject({ kind: "hero", ratio: "1:1", optional: true, sizePx: 160 });
    for (const s of slots.filter((x) => x.screen === "question")) {
      expect(s).toMatchObject({ kind: "icon", optional: true, sizePx: 96 });
    }
    expect(slots[slots.length - 1]).toMatchObject({ key: "results", sizePx: 72 });
    // No required slot anywhere: Routine never gates on imagery.
    expect(slots.every((s) => s.optional)).toBe(true);
  });

  it("Discover: optional hero + optional 64px thumbs + results", () => {
    const slots = declareSlots("t4", flow);
    expect(slots.map((s) => s.key)).toEqual(["hero", ...answerKeys, "results"]);
    expect(slots[0]).toMatchObject({ kind: "hero", ratio: "16:9", optional: true });
    for (const s of slots.filter((x) => x.screen === "question")) {
      expect(s).toMatchObject({ kind: "thumb", optional: true, sizePx: 64 });
    }
  });

  it("Clean: results only", () => {
    const slots = declareSlots("t5", flow);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ key: "results", screen: "results", optional: true });
  });

  it("emits no answer slots when no question is visual", () => {
    const textOnly: SlotFlow = { questions: [flow.questions[0]] };
    expect(declareSlots("t1", textOnly).map((s) => s.key)).toEqual(["hero", "results"]);
  });
});

// ---------------------------------------------------------------------
// Deterministic selection (spec 2.4 / 2.5 coverage table)
// ---------------------------------------------------------------------

const base: TemplateSignals = {
  variantOptionDensity: 0,
  avgPriceCents: 4000,
  avgOptionCount: 1,
  productCount: 60,
  routineSignals: 0,
  giftSignals: 0,
  playfulCopy: false,
  lowAov: false,
  category: null,
  imagePerAnswerCoverage: 0,
  lifestyleImageCount: 0,
  bannerCoverage: null,
};

const looks = {
  sans: { serifHeading: false, roundedHeading: false, heavyHeading: false, avgSaturation: 0.3, emojiInCopy: false } as LookSignals,
  serif: { serifHeading: true, roundedHeading: false, heavyHeading: false, avgSaturation: 0.2, emojiInCopy: false } as LookSignals,
  playful: { serifHeading: false, roundedHeading: true, heavyHeading: true, avgSaturation: 0.7, emojiInCopy: true } as LookSignals,
  saturated: { serifHeading: false, roundedHeading: false, heavyHeading: false, avgSaturation: 0.7, emojiInCopy: false } as LookSignals,
};

describe("selectTemplate / selectLook coverage table (spec 2.5)", () => {
  it("colour cosmetics with shade variants → Match, Minimal or Bold", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 0.9, imagePerAnswerCoverage: 0.95, category: "cosmetics" };
    expect(selectTemplate(s).template).toBe("t1");
    expect(selectLook(looks.sans)).toBe("minimal");
    expect(selectLook(looks.saturated)).toBe("bold");
  });

  it("fragrance, 12 SKUs, serif theme → Consult, Editorial", () => {
    const s: TemplateSignals = { ...base, avgPriceCents: 18000, productCount: 12, category: "fragrance", lifestyleImageCount: 3, variantOptionDensity: 0.2, imagePerAnswerCoverage: 0.4 };
    expect(selectTemplate(s).template).toBe("t2");
    expect(selectLook(looks.serif)).toBe("editorial");
  });

  it("skincare with cleanser/serum/moisturiser collections → Routine, Minimal", () => {
    const s: TemplateSignals = { ...base, routineSignals: 4, category: "skincare", productCount: 30 };
    expect(selectTemplate(s).template).toBe("t3");
    expect(selectLook(looks.sans)).toBe("minimal");
  });

  it("mattress / furniture, spec-heavy → Consult, Minimal (size options don't make it Match)", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 1, imagePerAnswerCoverage: 0.3, avgPriceCents: 90000, avgOptionCount: 4, productCount: 8, category: "mattress", lifestyleImageCount: 2 };
    const a = selectTemplate(s);
    expect(a.template).toBe("t2");
    expect(a.eligible).not.toContain("t1");
    expect(selectLook(looks.sans)).toBe("minimal");
  });

  it("tile / interiors, filters by color + material → Match, Editorial", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 0.7, imagePerAnswerCoverage: 0.9, category: "tile-interiors", avgPriceCents: 6000, avgOptionCount: 2, productCount: 120 };
    expect(selectTemplate(s).template).toBe("t1");
    expect(selectLook(looks.serif)).toBe("editorial");
  });

  it("supplements → Routine, Minimal or Bold", () => {
    const s: TemplateSignals = { ...base, routineSignals: 3, category: "supplements" };
    expect(selectTemplate(s).template).toBe("t3");
    expect(["minimal", "bold"]).toContain(selectLook(looks.sans));
    expect(["minimal", "bold"]).toContain(selectLook(looks.playful));
  });

  it("press-on nails, playful copy → Match, Bold", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 0.8, imagePerAnswerCoverage: 0.9, category: "press-on nails", playfulCopy: true, giftSignals: 1, lowAov: true, avgPriceCents: 1500 };
    const a = selectTemplate(s);
    expect(a.template).toBe("t1");
    expect(a.scores.t4).toBeGreaterThan(0); // playful signals fired, Match still wins
    expect(selectLook(looks.playful)).toBe("bold");
  });

  it("generic 40-SKU apparel with no variant imagery → Clean (degraded from Match)", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 0.8, imagePerAnswerCoverage: 0.2, productCount: 40, category: "apparel" };
    const a = selectTemplate(s);
    expect(a.template).toBe("t5");
    expect(a.degradedFrom).toBe("t1");
    expect(a.eligible).not.toContain("t1");
  });
});

describe("selectTemplate guard rails", () => {
  it("Discover never wins without ≥ 5 of its own points", () => {
    const four: TemplateSignals = { ...base, playfulCopy: true, giftSignals: 1 };
    const a = selectTemplate(four);
    expect(a.scores.t4).toBe(0);
    expect(a.template).toBe("t5");
    const five: TemplateSignals = { ...four, lowAov: true };
    const b = selectTemplate(five);
    expect(b.scores.t4).toBe(5);
    expect(b.template).toBe("t4");
  });

  it("is never a fallback: nothing firing → Clean", () => {
    expect(selectTemplate(base).template).toBe("t5");
  });

  it("a tie between two eligible templates falls to Clean", () => {
    const s: TemplateSignals = {
      ...base,
      variantOptionDensity: 0.65,
      imagePerAnswerCoverage: 0.85, // t1 = 5
      avgPriceCents: 20000,
      avgOptionCount: 3,
      productCount: 20, // t2 = 5
      lifestyleImageCount: 1,
    };
    const a = selectTemplate(s);
    expect(a.scores.t1).toBe(5);
    expect(a.scores.t2).toBe(5);
    expect(a.template).toBe("t5");
    expect(a.degradedFrom).toBeUndefined();
  });

  it("an image-gate failure records degradedFrom and keeps the Look decision separate", () => {
    const s: TemplateSignals = { ...base, avgPriceCents: 30000, avgOptionCount: 3, productCount: 10, category: "furniture", lifestyleImageCount: 0, bannerCoverage: 0.2 };
    const a = selectTemplate(s);
    expect(a.template).toBe("t5");
    expect(a.degradedFrom).toBe("t2");
    expect(selectLook(looks.serif)).toBe("editorial");
  });

  it("is deterministic", () => {
    const s: TemplateSignals = { ...base, variantOptionDensity: 0.9, imagePerAnswerCoverage: 0.9, category: "cosmetics" };
    expect(selectTemplate(s)).toEqual(selectTemplate({ ...s }));
  });
});

// ---------------------------------------------------------------------
// Token resolution (contract §2)
// ---------------------------------------------------------------------

describe("resolveQuizTokens", () => {
  const brand: BrandTokens = {
    ...LOOKS.minimal.tokens,
    colorAccent: "#123456",
    radiusButton: 12,
    radiusCard: 24,
  };

  it("returns null for legacy shops (no template)", () => {
    expect(resolveQuizTokens(null, "minimal", brand)).toBeNull();
    expect(resolveQuizTokens("salon", "minimal", brand)).toBeNull();
  });

  it("overlays brand tokens on the Look preset", () => {
    const t = resolveQuizTokens("t1", "editorial", brand)!;
    expect(t.colorAccent).toBe("#123456");
    expect(t.fontHeading).toBe(brand.fontHeading);
  });

  it("clamps radii into the Look's [radiusMin, radiusCap]", () => {
    const editorial = resolveQuizTokens("t1", "editorial", brand)!;
    expect(editorial.radiusButton).toBe(4);
    expect(editorial.radiusCard).toBe(4);
    const bold = resolveQuizTokens("t1", "bold", { ...brand, radiusButton: 4, radiusCard: 6 })!;
    expect(bold.radiusButton).toBe(16);
    expect(bold.radiusCard).toBeGreaterThanOrEqual(16);
    const minimal = resolveQuizTokens("t1", "minimal", brand)!;
    expect(minimal.radiusButton).toBe(10);
  });

  it("falls back to the Look preset when a brand token is empty", () => {
    const t = resolveQuizTokens("t2", "minimal", { ...brand, colorAccent: "  " })!;
    expect(t.colorAccent).toBe(LOOKS.minimal.tokens.colorAccent);
  });

  it("uses Minimal when the look is null", () => {
    const t = resolveQuizTokens("t5", null, null)!;
    expect(t).toEqual(LOOKS.minimal.tokens);
  });
});
