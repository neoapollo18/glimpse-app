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
  degradedFrom: null,
  imagesPlaced: 8,
  imagesTotal: 9,
  storeType: "shade-based beauty store",
  steps: [],
};

describe("arrivalBannerChips (spec 6.5 truth rules)", () => {
  it("claims the product count and the assigned template", () => {
    const b = arrivalBannerChips(full, "t1");
    expect(b.fallback).toBe(false);
    expect(b.lead).toBe("Built from your 75 products.");
    expect(b.chips).toEqual(["Match template"]);
  });

  it("never claims font or palette styling (templates own their design)", () => {
    const b = arrivalBannerChips(full, "t2");
    expect(b.chips.some((c) => /headings$|palette$|look$/.test(c))).toBe(false);
  });

  it("falls back completely with no report", () => {
    const b = arrivalBannerChips(null, "t1");
    expect(b).toEqual({ lead: FALLBACK_LEAD, chips: [], fallback: true });
  });

  it("drops the product-count lead when fewer than 4 questions are grounded", () => {
    const b = arrivalBannerChips({ ...full, groundedQuestions: 3 }, "t1");
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.fallback).toBe(false); // the template chip still qualifies
    expect(b.chips).toContain("Match template");
  });

  it("drops the product-count lead when the product count is below the grounded count", () => {
    const b = arrivalBannerChips({ ...full, productCount: 3, groundedQuestions: 4 }, "t1");
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.lead).not.toMatch(/products/);
  });

  it("drops the template chip when no template is assigned", () => {
    const b = arrivalBannerChips(full, null);
    expect(b.chips.some((c) => /template$/.test(c))).toBe(false);
    expect(b.lead).toBe("Built from your 75 products.");
  });

  it("names the assigned template, not the report's", () => {
    const b = arrivalBannerChips(full, "t3");
    expect(b.chips).toContain("Routine template");
    expect(b.chips).not.toContain("Match template");
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
    const b = arrivalBannerChips(empty, null);
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
    const b = arrivalBannerChips(empty, "t1");
    const text = [b.lead, ...b.chips].join(" ");
    expect(text).not.toMatch(/Serif headings|ivory palette|in your store's style/);
  });
});

describe("arrivalBannerChips over a partial (older) report", () => {
  it("tolerates missing optional fields (and a stale look) without claiming anything", () => {
    const partial = { template: "t1", look: "minimal", version: 3 } as unknown as GenerationReport;
    const b = arrivalBannerChips(partial, "t1");
    expect(b.fallback).toBe(false);
    expect(b.lead).toBe(FALLBACK_LEAD);
    expect(b.chips).toEqual(["Match template"]);
  });
});
