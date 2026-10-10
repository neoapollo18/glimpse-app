import { describe, expect, it } from "vitest";
import {
  deriveMode,
  appliesToLine,
  overviewCount,
  normalizeGlobalRules,
  findEmptyCombination,
  ruleKey,
  NO_PREFERENCE_SENTENCE,
  matchNamedProducts,
} from "../answer-rules-shared";
import { applyAlways, narrowPool, prependAlways, sentenceTags, type AnswerLayer } from "../answer-rules-layer";

const cand = (id: string, extra: Record<string, unknown> = {}) =>
  ({ product: { id, product_name: id, ...extra }, variant: null }) as any;

const layer = (rules: Record<string, { mode: "lean" | "only" | "none"; ids: string[] }>, global = {}): AnswerLayer => ({
  rules: new Map(
    Object.entries(rules).map(([k, v]) => [k, { sentence: `s ${k}`, mode: v.mode, productIds: new Set(v.ids) }]),
  ),
  global: normalizeGlobalRules(global),
});

describe("deriveMode", () => {
  it("weights by default, narrows only on an explicit only, none when neutral/empty", () => {
    expect(deriveMode("Lean toward warm reds and corals.")).toBe("lean");
    expect(deriveMode("Only recommend Pasión and Noche.")).toBe("only");
    expect(deriveMode(NO_PREFERENCE_SENTENCE)).toBe("none");
    expect(deriveMode("   ")).toBe("none");
  });
});

describe("applies-to line", () => {
  it("covers every spec state", () => {
    expect(appliesToLine({ sentence: "", mode: "none", resolved: null, status: "empty" }).amber).toBe(true);
    expect(appliesToLine({ sentence: NO_PREFERENCE_SENTENCE, mode: "none", resolved: null, status: "resolved" }).text).toBe(
      "Applies to all products",
    );
    expect(
      appliesToLine({ sentence: "Lean toward reds", mode: "lean", resolved: { product_ids: ["a"], labels: ["Reds", "Corals"], count: 9 }, status: "resolved" }).text,
    ).toBe("Applies to 9 of your products · Reds, Corals");
    expect(
      appliesToLine({ sentence: "Only Pasión", mode: "only", resolved: { product_ids: ["a"], labels: ["Pasión"], count: 1 }, status: "resolved" }).text,
    ).toBe("Only this 1 product · Pasión");
    const bad = appliesToLine({ sentence: "Lean toward unicorns", mode: "lean", resolved: { product_ids: [], labels: [], count: 0 }, status: "unresolved" });
    expect(bad.amber).toBe(true);
    expect(overviewCount({ sentence: "x", mode: "lean", resolved: { product_ids: [], labels: [], count: 0 }, status: "unresolved" }).amber).toBe(true);
  });
});

describe("findEmptyCombination", () => {
  const questions = [
    { axisKey: "vibe", prompt: "Vibe?", options: [{ axisValue: "classic", label: "Classic" }, { axisValue: "dramatic", label: "Dramatic" }] },
    { axisKey: "tone", prompt: "Tone?", options: [{ axisValue: "warm", label: "Warm" }, { axisValue: "cool", label: "Cool" }] },
  ];
  it("is silent when every example path has products", () => {
    const rules = new Map([[ruleKey("tone", "cool"), { mode: "only" as const, resolved: { product_ids: ["a"], labels: [], count: 1 }, active: true, sentence: "Only a" }]]);
    expect(findEmptyCombination({ questions, rules, allProductIds: ["a", "b"], neverProductIds: new Set() })).toBeNull();
  });
  it("names the path and the question whose only-sentence emptied it", () => {
    const rules = new Map([
      [ruleKey("vibe", "dramatic"), { mode: "only" as const, resolved: { product_ids: ["a"], labels: [], count: 1 }, active: true, sentence: "Only a" }],
      [ruleKey("tone", "cool"), { mode: "only" as const, resolved: { product_ids: ["b"], labels: [], count: 1 }, active: true, sentence: "Only b" }],
    ]);
    const r = findEmptyCombination({ questions, rules, allProductIds: ["a", "b"], neverProductIds: new Set() });
    expect(r).toEqual({ labels: ["Dramatic", "Cool"], culpritIndex: 2, culpritAxisKey: "tone" });
  });
});

describe("runtime narrowing", () => {
  it("never removes products and facets before anything else", () => {
    const l = layer({}, { never: [{ id: "gift", label: "Gift card" }, { id: "Sets", label: "Sets", kind: "type" }] });
    const out = narrowPool([cand("gift"), cand("kit", { product_type: "sets" }), cand("red")], l, {}, "t");
    expect(out.candidates.map((c) => c.product.id)).toEqual(["red"]);
  });
  it("only intersects; an empty intersection is relaxed, not applied", () => {
    const l = layer({ [ruleKey("tone", "cool")]: { mode: "only", ids: ["b"] }, [ruleKey("vibe", "x")]: { mode: "only", ids: ["zzz"] } });
    const out = narrowPool([cand("a"), cand("b")], l, { tone: "cool", vibe: "x" }, "t");
    expect(out.candidates.map((c) => c.product.id)).toEqual(["b"]);
    expect(out.relaxed).toEqual(["vibe"]);
  });
  it("lean never narrows", () => {
    const l = layer({ [ruleKey("tone", "warm")]: { mode: "lean", ids: ["a"] } });
    expect(narrowPool([cand("a"), cand("b")], l, { tone: "warm" }, "t").candidates).toHaveLength(2);
  });
  it("always products lead, deduped, keeping the rest in order", () => {
    const ordered = [cand("a"), cand("b"), cand("c")];
    expect(prependAlways(ordered, [{ id: "c", label: "C" }, { id: "missing", label: "M" }]).map((c) => c.product.id)).toEqual(["c", "a", "b"]);
  });
  it("always products pulled into a matrix outcome widen the matrix segment", () => {
    const [a, b, c] = [cand("a"), cand("b"), cand("c")];
    const out = applyAlways({ ordered: [a, b, c], matrixApplied: true, matrixCount: 2 }, [{ id: "c", label: "C" }]);
    expect(out.ordered.map((x) => x.product.id)).toEqual(["c", "a", "b"]);
    expect(out.matrixCount).toBe(3);
    const inside = applyAlways({ ordered: [a, b, c], matrixApplied: true, matrixCount: 2 }, [{ id: "b", label: "B" }]);
    expect(inside.matrixCount).toBe(2);
  });
  it("tags candidates with the questions whose chosen sentence matched them", () => {
    const l = layer({ [ruleKey("tone", "warm")]: { mode: "lean", ids: ["a"] } });
    const tags = sentenceTags(l, [{ questionIndex: 2, axisKey: "tone", label: "Warm", sentence: "s", mode: "lean" }], { tone: "warm" });
    expect(tags.get("a")).toEqual([2]);
  });
});

describe("matchNamedProducts", () => {
  const products = [
    { id: "1", name: "Aurora Bible Digitale" },
    { id: "2", name: "Aurora Bible Digitale – Édition Femme" },
    { id: "3", name: "Aurora Bible Papier" },
    { id: "4", name: "Cœur à Cœur" },
    { id: "5", name: "Parcours Aurora (12 semaines)" },
    { id: "6", name: "Joy" },
  ];

  it("matches names verbatim, by base name, and ignoring accents/ligatures", () => {
    expect(
      matchNamedProducts("Strongly favor Aurora Bible Digitale in the edition chosen in Q1; outweighs Q2 and Q3.", products),
    ).toEqual(["1", "2"]);
    expect(matchNamedProducts("Strongly favor Coeur a coeur in the edition chosen in Q1.", products)).toEqual(["4"]);
    expect(matchNamedProducts("Strongly favor Parcours Aurora in the edition chosen in Q1.", products)).toEqual(["5"]);
  });

  it("needs whole words and skips very short names", () => {
    expect(matchNamedProducts("Lean toward Aurora Bibles.", products)).toEqual([]);
    expect(matchNamedProducts("Lean toward joy and calm.", products)).toEqual([]);
  });
});
