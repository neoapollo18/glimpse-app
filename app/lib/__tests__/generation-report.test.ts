import { describe, expect, it } from "vitest";
import {
  buildGenerationReport,
  countGroundedQuestions,
  countImageSlots,
  extractedColorsFromProfile,
  fontFamilyName,
  headingFontFromProfile,
  paletteWordFor,
  parseGenerationReport,
  resolvePhases,
  stepDetail,
  type GenerationReportInput,
  type ReportProfile,
} from "../generation-report.server";

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const themedProfile: ReportProfile = {
  tokens: { fontHeading: '"Fraunces", Georgia, serif', colorBg: "#faf6f1", colorText: "#1a1a1e", colorAccent: "#8a6d4b" },
  sources: {
    fontHeading: { source: "theme", confidence: "high" },
    colorBg: { source: "theme", confidence: "high" },
    colorText: { source: "theme", confidence: "high" },
    colorAccent: { source: "theme", confidence: "high" },
  },
  homepage: { palette: ["#efe6da", "#d9c7b2"] },
  category: "color-cosmetics",
  templateAssignment: { template: "t1", scores: { t1: 4, t2: 0, t3: 0, t4: 0, t5: 0 }, signals: ["variant-density"], eligible: ["t1", "t5"] },
};

const presetProfile: ReportProfile = {
  tokens: { fontHeading: "-apple-system, BlinkMacSystemFont, sans-serif", colorBg: "#ffffff", colorText: "#16161a", colorAccent: "#16161a" },
  sources: {
    fontHeading: { source: "preset", confidence: "low" },
    colorBg: { source: "preset", confidence: "low" },
    colorText: { source: "preset", confidence: "low" },
    colorAccent: { source: "preset", confidence: "low" },
  },
  homepage: { palette: [] },
  category: null,
  templateAssignment: { template: "t5", scores: { t1: 0, t2: 0, t3: 0, t4: 0, t5: 1 }, signals: [], eligible: ["t5"] },
};

const flow = {
  questions: [
    {
      axisKey: "shade",
      prompt: "Which shade family?",
      options: [
        { label: "Nude", axisValueValue: "nude", imageUrl: "https://cdn/nude.jpg" },
        { label: "Red", axisValueValue: "red", imageUrl: "https://cdn/red.jpg" },
        { label: "Surprise me", axisValueValue: "any", selectAll: true },
      ],
    },
    {
      axisKey: "finish",
      prompt: "Finish?",
      options: [
        { label: "Matte", axisValueValue: "matte", imageUrl: "https://cdn/matte.jpg" },
        { label: "Gloss", axisValueValue: "gloss", imageUrl: null },
      ],
    },
    {
      axisKey: "budget",
      prompt: "Budget?",
      options: [
        { label: "Under $20", axisValueValue: "low" },
        { label: "Over $20", axisValueValue: "high" },
      ],
    },
    {
      axisKey: "vibe",
      prompt: "Vibe?",
      options: [
        { label: "Soft", axisValueValue: "soft" },
        { label: "Bold", axisValueValue: "bold" },
      ],
    },
  ],
};

const answerCounts = {
  "shade:nude": 6,
  "shade:red": 5,
  "finish:matte": 4,
  "finish:gloss": 3,
  "budget:low": 2, // below floor 3
  "budget:high": 9,
  "vibe:soft": 12,
  "vibe:bold": 12,
};

const baseInput: GenerationReportInput = {
  productCount: 75,
  collectionCount: 6,
  flow,
  answerCounts,
  groundingFloor: 3,
  phases: [
    { label: "About you", axisKeys: ["shade", "finish"] },
    { label: "Preferences", axisKeys: ["budget", "vibe"] },
  ],
  profile: themedProfile,
  template: "t1",
  degradedFrom: null,
  imageSlots: null,
  steps: [
    { key: "catalog", detail: "75 products · 6 collections", ms: 120 },
    { key: "theme", detail: "Fraunces · 6 colors", ms: 40 },
    { key: "questions", detail: "4 questions across 2 phases", ms: 30000 },
    { key: "paths", detail: "75 / 75", ms: 20 },
    { key: "images", detail: "3 / 5", ms: 10 },
  ],
  generatedAt: "2026-09-28T00:00:00.000Z",
};

// ---------------------------------------------------------------------
// Heading font
// ---------------------------------------------------------------------

describe("headingFont", () => {
  it("parses the family name out of a theme font stack", () => {
    expect(fontFamilyName('"Fraunces", Georgia, serif')).toBe("Fraunces");
    expect(fontFamilyName("Playfair Display, serif")).toBe("Playfair Display");
  });

  it("is null for generic/system-only stacks", () => {
    expect(fontFamilyName("Georgia, serif")).toBeNull();
    expect(fontFamilyName("-apple-system, BlinkMacSystemFont, sans-serif")).toBeNull();
    expect(fontFamilyName(null)).toBeNull();
  });

  it("carries the source confidence when the token came from the theme", () => {
    expect(headingFontFromProfile(themedProfile)).toEqual({ name: "Fraunces", confidence: "high" });
  });

  it("is { null, null } when no theme font was detected (preset)", () => {
    expect(headingFontFromProfile(presetProfile)).toEqual({ name: null, confidence: null });
    expect(headingFontFromProfile(null)).toEqual({ name: null, confidence: null });
  });

  it("is null when the source is real but the stack is generic", () => {
    const p: ReportProfile = {
      ...themedProfile,
      tokens: { ...themedProfile.tokens, fontHeading: "Georgia, serif" },
    };
    expect(headingFontFromProfile(p).name).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Colors + palette word
// ---------------------------------------------------------------------

describe("colors / paletteWord", () => {
  it("collects theme-sourced tokens plus the homepage palette, deduped", () => {
    const colors = extractedColorsFromProfile(themedProfile);
    expect(colors).toEqual(["#faf6f1", "#1a1a1e", "#8a6d4b", "#efe6da", "#d9c7b2"]);
  });

  it("is [] when every token is a preset and the homepage yielded nothing", () => {
    expect(extractedColorsFromProfile(presetProfile)).toEqual([]);
    expect(extractedColorsFromProfile(null)).toEqual([]);
  });

  it("paletteWord is null with fewer than two colors", () => {
    expect(paletteWordFor([], null)).toBeNull();
    expect(paletteWordFor(["#faf6f1"], { bg: "#faf6f1", accent: "#8a6d4b" })).toBeNull();
  });

  it("derives a warm neutral word for a light, low-saturation, warm set", () => {
    expect(paletteWordFor(["#faf6f1", "#efe6da", "#d9c7b2"], { bg: "#faf6f1", accent: "#8a6d4b" })).toBe("warm neutral");
  });

  it("derives cool neutral, deep and vivid", () => {
    expect(paletteWordFor(["#f2f5f8", "#dfe6ee", "#5b6b7c"], { bg: "#f2f5f8", accent: "#5b6b7c" })).toBe("cool neutral");
    expect(paletteWordFor(["#111111", "#222222", "#c9a96e"], { bg: "#111111", accent: "#c9a96e" })).toBe("deep");
    expect(paletteWordFor(["#ffffff", "#ff2d55", "#00c2ff"], { bg: "#ffffff", accent: "#ff2d55" })).toBe("vivid");
  });
});

// ---------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------

describe("resolvePhases", () => {
  const questions = flow.questions;
  const labels = { shade: "Shade", finish: "Finish", budget: "Budget", vibe: "Vibe" };

  it("accepts a contiguous, exhaustive 2-3 phase partition from the model", () => {
    const proposed = [
      { label: "Your shade", axisKeys: ["shade", "finish"] },
      { label: "Preferences", axisKeys: ["budget", "vibe"] },
    ];
    expect(resolvePhases(questions, proposed, labels)).toEqual(proposed);
  });

  it("falls back to deterministic chunks when the proposal is missing", () => {
    expect(resolvePhases(questions, null, labels)).toEqual([
      { label: "Shade", axisKeys: ["shade", "finish"] },
      { label: "Budget", axisKeys: ["budget", "vibe"] },
    ]);
  });

  it("falls back when the proposal is non-contiguous, incomplete, or too many", () => {
    const fallback = resolvePhases(questions, null, labels);
    expect(resolvePhases(questions, [{ label: "A", axisKeys: ["shade", "budget"] }, { label: "B", axisKeys: ["finish", "vibe"] }], labels)).toEqual(fallback);
    expect(resolvePhases(questions, [{ label: "A", axisKeys: ["shade"] }, { label: "B", axisKeys: ["finish"] }], labels)).toEqual(fallback);
    expect(resolvePhases(questions, [{ label: "A", axisKeys: ["shade"] }, { label: "B", axisKeys: ["finish"] }, { label: "C", axisKeys: ["budget"] }, { label: "D", axisKeys: ["vibe"] }], labels)).toEqual(fallback);
    expect(resolvePhases(questions, [{ label: "", axisKeys: ["shade", "finish"] }, { label: "B", axisKeys: ["budget", "vibe"] }], labels)).toEqual(fallback);
  });

  it("chunks six+ questions into three phases", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((axisKey) => ({ axisKey }));
    const phases = resolvePhases(six, null, { a: "A", c: "C", e: "E" });
    expect(phases.map((p) => p.label)).toEqual(["A", "C", "E"]);
    expect(phases.flatMap((p) => p.axisKeys)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

// ---------------------------------------------------------------------
// Image slots + grounding
// ---------------------------------------------------------------------

describe("countImageSlots", () => {
  it("counts Match answer tiles + hero as the non-optional total, placed by answer imageUrl or a merchant slot", () => {
    // Visual questions: shade (2 answers with images) and finish (matte has
    // an image, gloss none). budget/vibe are text-only → no slots. + hero.
    expect(countImageSlots("t1", flow, null)).toEqual({ placed: 3, total: 5 });
    expect(countImageSlots("t1", flow, { hero: "https://cdn/hero.jpg" })).toEqual({ placed: 4, total: 5 });
    expect(countImageSlots("t1", flow, { "answer:finish:gloss": "https://cdn/gloss.jpg" })).toEqual({ placed: 4, total: 5 });
  });

  it("Clean declares no required slots", () => {
    expect(countImageSlots("t5", flow, null)).toEqual({ placed: 0, total: 0 });
  });

  it("Routine's slots are all optional", () => {
    expect(countImageSlots("t3", flow, null)).toEqual({ placed: 0, total: 0 });
  });
});

describe("countGroundedQuestions", () => {
  it("counts only questions whose every non-selectAll answer meets the floor", () => {
    // budget:low = 2 < 3 → budget is not grounded; selectAll ignored.
    expect(countGroundedQuestions(flow, answerCounts, 3)).toBe(3);
    expect(countGroundedQuestions(flow, answerCounts, 2)).toBe(4);
    expect(countGroundedQuestions(flow, {}, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

describe("buildGenerationReport", () => {
  it("assembles real numbers for a themed Match store", () => {
    const r = buildGenerationReport(baseInput);
    expect(r.version).toBe(3);
    expect(r.productCount).toBe(75);
    expect(r.collectionCount).toBe(6);
    expect(r.questions).toBe(4);
    expect(r.groundedQuestions).toBe(3);
    expect(r.phases).toBe(2);
    expect(r.headingFont).toEqual({ name: "Fraunces", confidence: "high" });
    expect(r.colors.length).toBe(5);
    expect(r.paletteWord).toBe("warm neutral");
    expect(r.template).toBe("t1");
    expect(r.degradedFrom).toBeNull();
    expect(r.imagesPlaced).toBe(3);
    expect(r.imagesTotal).toBe(5);
    expect(r.storeType).toBe("shade- or size-based color cosmetics");
    expect(r.steps.map((s) => s.key)).toEqual(["catalog", "theme", "questions", "paths", "images"]);
    expect(r.generatedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("no theme font → headingFont.name null; no colors → paletteWord null", () => {
    const r = buildGenerationReport({ ...baseInput, profile: presetProfile, template: "t5", phases: null });
    expect(r.headingFont).toEqual({ name: null, confidence: null });
    expect(r.colors).toEqual([]);
    expect(r.paletteWord).toBeNull();
  });

  it("one color → paletteWord null", () => {
    const oneColor: ReportProfile = {
      ...presetProfile,
      sources: { ...presetProfile.sources, colorAccent: { source: "theme", confidence: "high" } },
      tokens: { ...presetProfile.tokens, colorAccent: "#8a6d4b" },
    };
    const r = buildGenerationReport({ ...baseInput, profile: oneColor });
    expect(r.colors).toEqual(["#8a6d4b"]);
    expect(r.paletteWord).toBeNull();
  });

  it("phases only for Match (t1)", () => {
    for (const template of ["t2", "t3", "t4", "t5"] as const) {
      expect(buildGenerationReport({ ...baseInput, template }).phases).toBe(0);
    }
    expect(buildGenerationReport({ ...baseInput, template: "t1", phases: null }).phases).toBe(0);
    expect(buildGenerationReport({ ...baseInput, template: "t1" }).phases).toBe(2);
  });

  it("imagesPlaced / imagesTotal follow the final template", () => {
    const degraded = buildGenerationReport({ ...baseInput, template: "t5", degradedFrom: "t1" });
    expect(degraded.imagesPlaced).toBe(0);
    expect(degraded.imagesTotal).toBe(0);
    expect(degraded.degradedFrom).toBe("t1");
    // degradedFrom equal to the template is not a degrade.
    expect(buildGenerationReport({ ...baseInput, degradedFrom: "t1" }).degradedFrom).toBeNull();
  });

  it("storeType is null without a profile", () => {
    expect(buildGenerationReport({ ...baseInput, profile: null }).storeType).toBeNull();
  });

  it("round-trips through the defensive parser", () => {
    const r = buildGenerationReport(baseInput);
    expect(parseGenerationReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(parseGenerationReport({ version: 2 })).toBeNull();
    expect(parseGenerationReport(null)).toBeNull();
  });
});

describe("stepDetail", () => {
  it("formats each step with real numbers and omits what is not real", () => {
    expect(stepDetail.catalog(75, 6)).toBe("75 products · 6 collections");
    expect(stepDetail.catalog(1, 0)).toBe("1 product");
    expect(stepDetail.theme("Fraunces", 3)).toBe("Fraunces · 3 colors");
    expect(stepDetail.theme(null, 3)).toBe("3 colors");
    expect(stepDetail.theme(null, 0)).toBe("Neutral preset");
    expect(stepDetail.questions(6, 2)).toBe("6 questions across 2 phases");
    expect(stepDetail.questions(5, 0)).toBe("5 questions");
    expect(stepDetail.paths(68, 75)).toBe("68 / 75");
    expect(stepDetail.images(3, 5)).toBe("3 / 5");
  });
});
