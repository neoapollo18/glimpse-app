import { describe, it, expect } from "vitest";
import { deriveProduct, splitPool, vibeMatches, type PoolProductInput } from "../columnar/attributes";
import { loadAttributeExport, loadGlamneticPool, MISSING_CORE_TAG } from "./fixtures/glamnetic-columnar";

// Attribute derivation from Glamnetic's Shopify tags (brief section 3),
// checked against Aaron's Oct 17 export of the same 424 products. The brief
// says to build from tags and use the export as the QA reference; the core
// columns must agree on every product.

const pool = loadGlamneticPool();
const derived = pool.map((p) => deriveProduct(p));
const byHandle = new Map(derived.map((p) => [p.handle, p]));
const exportRows = loadAttributeExport();
const sorted = (v: string) => (v ? v.split("|").map((x) => x.trim()).sort().join("|") : "");

const product = (tags: string[], extra: Partial<PoolProductInput> = {}): PoolProductInput => ({
  id: "p1",
  shopifyId: "gid://shopify/Product/1",
  handle: "test-set",
  title: "Test Set",
  productType: "Nails",
  status: "active",
  tags,
  price: 19.99,
  imageUrl: null,
  ...extra,
});

describe("derivation vs the Oct 17 export", () => {
  it("covers the same 424 handles", () => {
    expect(exportRows).toHaveLength(424);
    expect(exportRows.every((r) => byHandle.has(r.handle))).toBe(true);
  });

  it.each([
    ["length", (h: string) => byHandle.get(h)!.length ?? ""],
    ["shape", (h: string) => byHandle.get(h)!.shape ?? ""],
    ["color_families", (h: string) => byHandle.get(h)!.colors.join("|")],
    ["finish", (h: string) => byHandle.get(h)!.finish ?? ""],
    ["drama", (h: string) => byHandle.get(h)!.drama.join("|")],
    ["is_french", (h: string) => (byHandle.get(h)!.isFrench ? "True" : "False")],
    ["is_ombre", (h: string) => (byHandle.get(h)!.isOmbre ? "True" : "False")],
    ["is_3d", (h: string) => (byHandle.get(h)!.is3d ? "True" : "False")],
    ["has_glitter", (h: string) => (byHandle.get(h)!.hasGlitter ? "True" : "False")],
    ["has_pattern", (h: string) => (byHandle.get(h)!.hasPattern ? "True" : "False")],
    ["is_solid", (h: string) => (byHandle.get(h)!.isSolid ? "True" : "False")],
    ["is_chrome", (h: string) => (byHandle.get(h)!.isChrome ? "True" : "False")],
  ])("%s agrees on all 424 products", (column, get) => {
    const off = exportRows.filter((r) => sorted(get(r.handle)) !== sorted(r[column]));
    expect(off.map((r) => r.handle)).toEqual([]);
  });

  it("holiday differs only where the catalog's lowercase _Nail collection_ tag names a Snow collection", () => {
    const off = exportRows.filter((r) => (byHandle.get(r.handle)!.holiday ? "True" : "False") !== r.holiday);
    expect(off.map((r) => r.handle).sort()).toEqual([
      "mrs-claus-short-almond-press-on-nails",
      "polar-night-short-almond-press-on-nails",
      "winter-comet-short-almond-press-on-nails",
    ]);
    for (const r of off) expect(byHandle.get(r.handle)!.collections).toContain("Snow Place Like Home");
  });
});

describe("exclusions", () => {
  it("excludes exactly the brief's eight products missing a core tag, with the missing field as the reason", () => {
    const { eligible, excluded } = splitPool(derived);
    expect(eligible).toHaveLength(416);
    expect(Object.fromEntries(excluded.map((e) => [e.handle, e.reasons]))).toEqual({
      "queen-of-hearts-medium-coffin-press-on-nails": ["No length tag"],
      "red-legacy-super-short-press-on-nails": ["No shape tag"],
      "platinum-metallic-chrome-short-almond-nails": ["No color tag"],
      "gunmetal-metallic-chrome-medium-coffin-nails": ["No color tag"],
      "pure-gray-short-oval-press-on-nails": ["No color tag"],
      "ash-gray-short-almond-press-on-nails": ["No color tag"],
      "paris-short-almond-press-on-nails": ["No finish tag"],
      "angel-short-almond-press-on-nails": ["No finish tag"],
    });
    for (const [handle, field] of Object.entries(MISSING_CORE_TAG)) {
      expect(byHandle.get(handle)!.missing).toEqual([field]);
    }
  });

  it("never guesses a core field from the primary tags or the title", () => {
    // paris has _Primary Finish_Glossy but no Finish_ tag: still missing.
    const paris = deriveProduct(
      product(["_Primary Finish_Glossy", "Nail Length_Short", "Nail Shape_Almond", "Color_Nude"], { title: "Glossy Paris" }),
    );
    expect(paris.finish).toBeNull();
    expect(paris.missing).toEqual(["finish"]);
  });

  it("drops unpublished sets and non-nail products (glue, tabs, bundles, duplicates)", () => {
    const tagged = ["Nail Length_Short", "Nail Shape_Almond", "Color_Nude", "Finish_Glossy"];
    const rows = [
      deriveProduct(product(tagged, { handle: "draft", status: "draft" })),
      deriveProduct(product(tagged, { handle: "legacy-null-status", status: null })),
      deriveProduct(product(["Product Type_Nail Accessories"], { handle: "glue", productType: "Nail_Accessories" })),
      deriveProduct(product([...tagged, "Product Type_Nail Bundles"], { handle: "bundle", productType: "Nails" })),
      deriveProduct(product(tagged, { handle: "dupe", productType: "Duplicate_Nails" })),
    ];
    const { eligible, excluded } = splitPool(rows);
    expect(eligible.map((p) => p.handle)).toEqual(["legacy-null-status"]);
    expect(Object.fromEntries(excluded.map((e) => [e.handle, e.reasons[0]]))).toEqual({
      draft: "Not active in Shopify",
      glue: "Not a nail set",
      bundle: "Not a nail set",
      dupe: "Not a nail set",
    });
  });

  it("treats conflicting length or shape tags as missing", () => {
    const p = deriveProduct(product(["Nail Length_Short", "Nail Length_Medium", "Nail Shape_Almond", "Color_Red", "Finish_Glossy"]));
    expect(p.length).toBeNull();
    expect(p.missing).toEqual(["length"]);
  });
});

describe("tag rules", () => {
  const base = ["Nail Length_Short", "Nail Shape_Almond", "Color_Pink"];

  it("maps Extra Short / Super Short to super_short, and Super Short is a shape too", () => {
    expect(deriveProduct(product(["Nail Length_Extra Short"])).length).toBe("super_short");
    expect(deriveProduct(product(["Nail Length_Super Short", "Nail Shape_Super Short"])).shape).toBe("super_short");
  });

  it("finish: the chrome flag wins, then velvet / cat eye, matte, glazed, glossy", () => {
    expect(deriveProduct(product([...base, "Finish_Glossy", "_Is Chrome_TRUE"])).finish).toBe("chrome");
    expect(deriveProduct(product([...base, "Finish_Glossy", "Finish_Velvet"])).finish).toBe("velvet_cateye");
    expect(deriveProduct(product([...base, "Finish_Glossy", "_Is Velvet_TRUE"])).finish).toBe("velvet_cateye");
    expect(deriveProduct(product([...base, "Finish_Glossy", "Finish_Matte"])).finish).toBe("matte");
    expect(deriveProduct(product([...base, "Finish_Glossy", "Finish_Glazed"])).finish).toBe("glazed_pearl");
    expect(deriveProduct(product([...base, "Finish_Glossy", "Finish_Foil"])).finish).toBe("glossy");
    // Aura and jelly sets are tagged glossy but read as glazed.
    expect(deriveProduct(product([...base, "Finish_Glossy", "Nail Style_Aura"])).finish).toBe("glazed_pearl");
  });

  it("labels the finish the way the card meta shows it", () => {
    expect(deriveProduct(product([...base, "Finish_Magnetic Cat Eye", "Finish_Velvet"])).finishLabel).toBe("Cat eye");
    expect(deriveProduct(product([...base, "Finish_Velvet"])).finishLabel).toBe("Velvet");
    expect(deriveProduct(product([...base, "Finish_Pearl"])).finishLabel).toBe("Pearl");
    expect(deriveProduct(product([...base, "Finish_Metallic Chrome"])).finishLabel).toBe("Chrome");
  });

  it("maps every Color_ value through the lookup table (several families allowed)", () => {
    const p = deriveProduct(product(["Color_Brown", "Color_Gray", "Color_Multicolor", "Color_Gold", "Color_Yellow"]));
    expect(p.colors.sort()).toEqual(["bold_bright", "dark_moody", "metallics", "nudes", "oranges_yellows"]);
  });

  it("holiday collections are configurable substrings", () => {
    const tags = [...base, "Finish_Glossy", "_Nail Collection_Sleigh All Day"];
    expect(deriveProduct(product(tags)).holiday).toBe(true);
    expect(deriveProduct(product(tags), { holidayCollections: ["Holiday"] }).holiday).toBe(false);
  });

  it("vibe rules: French Girl Chic is french or ombre; the inferred vibes stay narrow", () => {
    const fr = deriveProduct(product([...base, "Finish_Glossy", "_Is French Tip_TRUE"]));
    const om = deriveProduct(product([...base, "Finish_Glossy", "_Is Ombre_TRUE"]));
    const solid = deriveProduct(product([...base, "Finish_Glossy", "_Is Solid_TRUE"]));
    expect(vibeMatches(fr, "french_girl")).toBe(true);
    expect(vibeMatches(om, "french_girl")).toBe(true);
    expect(vibeMatches(solid, "french_girl")).toBe(false);
    // The store-wide "Summer Shop 2026" collection alone isn't Vacay Mode.
    const summerNude = deriveProduct(product(["Color_Nude", "Finish_Glossy", "_Nail Collection_Summer Shop 2026"]));
    expect(vibeMatches(summerNude, "vacay")).toBe(false);
    expect(vibeMatches(deriveProduct(product(["Color_Nude", "_Nail Collection_Euro Summer 2026"])), "vacay")).toBe(true);
  });
});

describe("Alternative & Edgy rule (logic v6.1, item 18)", () => {
  it("a colorway collection named for its shade is not a theme: Berry Baby is not Alternative & Edgy", () => {
    const berry = byHandle.get("berry-baby-super-short-press-on-nails")!;
    expect(berry.collections).toContain("Glossy Dark Maroon");
    expect(berry.vibeSource).toBe("rules");
    expect(vibeMatches(berry, "alt_edgy")).toBe(false);
    // The rest of the Glossy Dark Maroon colorway moves with it.
    const maroon = derived.filter((p) => p.collections.includes("Glossy Dark Maroon"));
    expect(maroon).toHaveLength(8);
    expect(maroon.filter((p) => vibeMatches(p, "alt_edgy"))).toEqual([]);
  });

  it("dark colors and the Halloween drops still read as Alternative & Edgy", () => {
    const tags = ["Nail Length_Short", "Nail Shape_Almond", "Finish_Glossy", "_Is Solid_TRUE"];
    expect(vibeMatches(deriveProduct(product([...tags, "Color_Black"])), "alt_edgy")).toBe(true);
    expect(vibeMatches(deriveProduct(product([...tags, "Color_Red", "_Nail Collection_Fright Night"])), "alt_edgy")).toBe(true);
    expect(vibeMatches(deriveProduct(product([...tags, "Color_Red", "_Nail Collection_Spells & Sparkles 2026"])), "alt_edgy")).toBe(true);
    expect(vibeMatches(deriveProduct(product([...tags, "Color_Red", "_Nail Collection_Glossy Dark Maroon"])), "alt_edgy")).toBe(false);
  });

  it("keeps the set's color words for the why-line", () => {
    const p = deriveProduct(product(["Nail Length_Short", "Nail Shape_Almond", "Finish_Glossy", "Color_Nude", "Color_Grey", "Color_Sparkly"]));
    expect(p.colorNames).toEqual(["nude", "gray"]);
  });
});

describe("approved vibe labels (fix spec v4, item 3)", () => {
  const base = ["Nail Length_Short", "Nail Shape_Almond", "Color_Red", "Finish_Glossy", "_Is Solid_TRUE"];

  it("a labeled set takes exactly its labels; an unlabeled one keeps the tag rules", () => {
    const tags = [...base, "_Nail Collection_Fright Night"];
    const ruled = deriveProduct(product(tags));
    // A Halloween drop reads as Alternative & Edgy by rule.
    expect(ruled.vibeSource).toBe("rules");
    expect(ruled.vibes).toContain("alt_edgy");
    const labeled = deriveProduct(product(tags), { vibeLabels: { "test-set": ["holiday", "soft_sweet"] } });
    expect(labeled.vibeSource).toBe("labels");
    expect(labeled.vibes).toEqual(["soft_sweet", "holiday"]);
    expect(vibeMatches(labeled, "alt_edgy")).toBe(false);
    expect(vibeMatches(labeled, "holiday")).toBe(true);
    // Another handle's labels don't apply.
    expect(deriveProduct(product(tags), { vibeLabels: { "other-set": ["vacay"] } }).vibeSource).toBe("rules");
  });

  it("[] means the set fits none of the six labeled vibes", () => {
    const p = deriveProduct(product([...base, "Color_Black"]), { vibeLabels: { "test-set": [] } });
    expect(p.vibes).toEqual([]);
  });

  it("French Girl Chic always follows the French tip / ombre tags", () => {
    const french = deriveProduct(product([...base, "_Is French Tip_TRUE"]), { vibeLabels: { "test-set": ["clean_girl"] } });
    expect(french.vibes).toEqual(["clean_girl", "french_girl"]);
    const solid = deriveProduct(product(base), { vibeLabels: { "test-set": ["french_girl", "clean_girl"] } });
    expect(solid.vibes).toEqual(["clean_girl"]);
  });
});
