import { describe, expect, it } from "vitest";
import { dedupeRuleRanks } from "../rule-ranks";

describe("dedupeRuleRanks", () => {
  it("bumps same-rank targets on one path, keeping order and every target", () => {
    const out = dedupeRuleRanks([
      { criteria: { tone: "warm", finish: "matte" }, productId: "a", rank: 1 },
      { criteria: { finish: "matte", tone: "warm" }, productId: "b", rank: 1 }, // same path, keys reordered
      { criteria: { tone: "warm", finish: "matte" }, productId: "c", rank: 2 },
      { criteria: { tone: "cool" }, productId: "a", rank: 1 },
    ]);
    expect(out.map((r) => [r.productId, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["a", 1],
    ]);
  });

  it("never drops a rule, even the same target twice on one path", () => {
    const out = dedupeRuleRanks([
      { criteria: { tone: "warm" }, variantId: "v1", rank: 1 },
      { criteria: { tone: "warm" }, variantId: "v1", rank: 1 },
    ]);
    expect(out.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("makes ranks whole numbers >= 1 and unique per path", () => {
    const out = dedupeRuleRanks([
      { criteria: {}, productId: "a", rank: 0.4 },
      { criteria: {}, productId: "b", rank: 1.2 },
    ]);
    expect(out.map((r) => r.rank)).toEqual([1, 2]);
  });
});
