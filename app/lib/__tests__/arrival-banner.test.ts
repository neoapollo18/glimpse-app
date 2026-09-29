import { describe, it, expect } from "vitest";
import { arrivalBannerChips, FALLBACK_LEAD, type GenerationReport } from "../arrival-banner";

// A fully-qualifying report: every chip has a real value.
const full: GenerationReport = {
  version: 3,
  generatedAt: "2026-09-28T00:00:00Z",
  productCount: 75,
  collectionCount: 6,
  questions: 6,
  groundedQuestions: 6,
  phases: 2,
  headingFont: { name: "Fraunces", confidence: "high" },
  colors: ["#B04A5A", "#191517", "#FFFFFF"],
  paletteWord: "warm neutral",
  template: "t1",
  look: "minimal",
  degradedFrom: null,
  imagesPlaced: 8,
  imagesTotal: 9,
  storeType: "shade-based beauty store",
  steps: [],
};

describe("arrivalBannerChips (spec 6.5 truth rules)", () => {
  it("claims everything when every value is real", () => {
    const b = arrivalBannerChips(full, "t1", "minimal");
    expect(b.fallback).toBe(false);
    expect(b.lead).toBe("Built from your 75 products.");
    expect(b.chips).toEqual(["Fraunces headings", "warm neutral palette", "Match template", "Minimal look"]);
  });

  it("falls back completely with no report", () => {
    const b = arrivalBannerChips(null, "t1", "minimal");
    expect(b).toEqual({ lead: FALLBACK_LEAD, chips: [], fallback: true });
  });

  it("drops the product-count lead when fewer than 4 questions are grounded", () => {
    const b = arrivalBannerChips({ ...full, groundedQuestions: 3 }, "t1", "minimal");
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.fallback).toBe(false); // other chips still qualify
    expect(b.chips).toContain("Fraunces headings");
  });

  it("drops the product-count lead when the product count is below the grounded count", () => {
    const b = arrivalBannerChips({ ...full, productCount: 3, groundedQuestions: 4 }, "t1", "minimal");
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.lead).not.toMatch(/products/);
  });

  it("drops the font chip when no heading font was detected", () => {
    const b = arrivalBannerChips({ ...full, headingFont: { name: null, confidence: null } }, "t1", "minimal");
    expect(b.chips.some((c) => /headings$/.test(c))).toBe(false);
    expect(b.chips).toContain("warm neutral palette");
  });

  it("drops the font chip when the detection confidence is low", () => {
    const b = arrivalBannerChips({ ...full, headingFont: { name: "Fraunces", confidence: "low" } }, "t1", "minimal");
    expect(b.chips.some((c) => /headings$/.test(c))).toBe(false);
  });

  it("keeps the font chip at medium confidence", () => {
    const b = arrivalBannerChips({ ...full, headingFont: { name: "Fraunces", confidence: "medium" } }, "t1", "minimal");
    expect(b.chips).toContain("Fraunces headings");
  });

  it("drops the palette chip with fewer than 2 extracted colors", () => {
    const b = arrivalBannerChips({ ...full, colors: ["#B04A5A"] }, "t1", "minimal");
    expect(b.chips.some((c) => /palette$/.test(c))).toBe(false);
  });

  it("drops the palette chip when no palette word was derived", () => {
    const b = arrivalBannerChips({ ...full, paletteWord: null }, "t1", "minimal");
    expect(b.chips.some((c) => /palette$/.test(c))).toBe(false);
  });

  it("drops the template and look chips when no template is assigned", () => {
    const b = arrivalBannerChips(full, null, "minimal");
    expect(b.chips.some((c) => /template$/.test(c))).toBe(false);
    expect(b.chips.some((c) => /look$/.test(c))).toBe(false);
  });

  it("names the assigned template and look, not the report's", () => {
    const b = arrivalBannerChips(full, "t3", "bold");
    expect(b.chips).toContain("Routine template");
    expect(b.chips).toContain("Bold look");
    expect(b.chips).not.toContain("Match template");
  });

  it("drops the look chip when the look is unknown", () => {
    const b = arrivalBannerChips(full, "t1", "neon");
    expect(b.chips).toContain("Match template");
    expect(b.chips.some((c) => /look$/.test(c))).toBe(false);
  });

  it("falls back when nothing qualifies", () => {
    const empty: GenerationReport = {
      ...full,
      productCount: 0,
      groundedQuestions: 0,
      headingFont: { name: null, confidence: null },
      colors: [],
      paletteWord: null,
    };
    const b = arrivalBannerChips(empty, null, null);
    expect(b).toEqual({ lead: FALLBACK_LEAD, chips: [], fallback: true });
  });

  it("never produces the 9/26 phantom chips over an empty report", () => {
    const empty: GenerationReport = {
      ...full,
      productCount: 0,
      groundedQuestions: 0,
      headingFont: { name: null, confidence: null },
      colors: [],
      paletteWord: null,
    };
    const b = arrivalBannerChips(empty, "t1", "editorial");
    const text = [b.lead, ...b.chips].join(" ");
    expect(text).not.toMatch(/Serif headings|ivory palette|in your store's style/);
  });
});

describe("arrivalBannerChips over a partial (older) report", () => {
  it("tolerates missing optional fields without claiming anything", () => {
    const partial = { template: "t1", look: "minimal", version: 3 } as unknown as GenerationReport;
    const b = arrivalBannerChips(partial, "t1", "minimal");
    expect(b.fallback).toBe(false);
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.chips).toEqual(["Match template", "Minimal look"]);
  });
});
