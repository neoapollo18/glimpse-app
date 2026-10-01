import { describe, it, expect } from "vitest";
import {
  archetypeForCategory,
  stockConfigFromCatalog,
  universalFillerCandidates,
} from "../quiz-archetypes.server";
import {
  validateGeneratedConfig,
  computeAnswerProductMap,
  MIN_QUESTIONS_FLOOR,
  type CatalogProduct,
} from "../quiz-config-schema.server";

/** The M2 dead-end: a single-type, single-vendor, three-product store with
 * flat prices (no price-band facet) used to yield ONE bank question. */
function tinyCatalog(): CatalogProduct[] {
  return [
    { id: "a", name: "Rose Lacquer", productType: "Nail Polish", vendor: "One", tags: [], price: 12, imageUrl: "https://cdn/a.jpg", variants: [] },
    { id: "b", name: "Coral Lacquer", productType: "Nail Polish", vendor: "One", tags: [], price: 12, variants: [] },
    { id: "c", name: "Nude Lacquer", productType: "Nail Polish", vendor: "One", tags: [], price: 12, variants: [] },
  ];
}

describe("stockConfigFromCatalog - universal fillers (M2)", () => {
  it("reaches the 4-question floor on a 3-product single-type catalog", () => {
    const catalog = tinyCatalog();
    const config = stockConfigFromCatalog(archetypeForCategory("nail polish"), catalog, null);
    expect(config.questions.length).toBeGreaterThanOrEqual(MIN_QUESTIONS_FLOOR);
    // One axis per question, no duplicates.
    const keys = config.questions.map((q) => q.axisKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const q of config.questions) expect(config.axes.some((a) => a.key === q.axisKey)).toBe(true);
  });

  it("passes validateGeneratedConfig with generation floors (t5 and unassigned)", () => {
    const catalog = tinyCatalog();
    const config = stockConfigFromCatalog(archetypeForCategory("nail polish"), catalog, null);
    for (const templateId of ["t5", null]) {
      const result = validateGeneratedConfig(config, catalog, { floors: { templateId, imagery: null } });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.draft!.flow.questions.length).toBeGreaterThanOrEqual(MIN_QUESTIONS_FLOOR);
    }
  });

  it("filler answers are universal exactly like the vibe bank (map to the whole scope)", () => {
    const catalog = tinyCatalog();
    const config = stockConfigFromCatalog("shade_vibe_finder", catalog, null);
    const map = computeAnswerProductMap(config, catalog);
    for (const q of config.questions) {
      for (const o of q.options) {
        expect(map.get(`${q.axisKey}:${o.axisValueValue}`)?.size).toBe(3);
      }
    }
  });

  it("is deterministic and only fills up to the floor", () => {
    const catalog = tinyCatalog();
    const a = stockConfigFromCatalog("routine_builder", catalog, null);
    const b = stockConfigFromCatalog("routine_builder", catalog, null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.questions.length).toBe(MIN_QUESTIONS_FLOOR);
  });

  it("does not add fillers when the facets already meet the floor", () => {
    const catalog: CatalogProduct[] = [];
    const types = ["Polish", "Top Coat", "Base Coat", "Remover"];
    for (let i = 0; i < 16; i++) {
      catalog.push({
        id: `p${i}`,
        name: `Item ${i}`,
        productType: types[i % 4],
        vendor: "V",
        tags: [],
        price: 5 + i * 3,
        variants: [],
      });
    }
    const config = stockConfigFromCatalog("shade_vibe_finder", catalog, null);
    // vibe + product_kind + budget = 3, so exactly one filler is appended.
    expect(config.questions.map((q) => q.axisKey)).toEqual(["vibe", "product_kind", "budget", "occasion"]);
  });
});

describe("universalFillerCandidates", () => {
  it("prunes answers whose tokens hit fewer products than the floor", () => {
    // "travel" matches exactly one product by token - under the floor of 2
    // - so that answer is dropped while the universal ones survive.
    const catalog = tinyCatalog();
    catalog[0].tags = ["travel"];
    const fillers = universalFillerCandidates("shade_vibe_finder", catalog, null);
    const occasion = fillers.find((f) => f.axis.key === "occasion")!;
    expect(occasion).toBeTruthy();
    expect(occasion.question.options.map((o) => o.axisValueValue)).not.toContain("travel");
    expect(occasion.axis.values.map((v) => v.value)).not.toContain("travel");
    expect(occasion.question.options.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing for an empty scope", () => {
    expect(universalFillerCandidates("gift_finder", [], null)).toEqual([]);
  });
});
