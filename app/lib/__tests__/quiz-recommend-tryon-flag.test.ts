import { describe, it, expect, vi, beforeEach } from "vitest";

// quiz-recommend's per-match `tryon` flag (2026-10-19): the widget offers
// try-on ("Try them on me", "See on me", the hero transform) only for
// matches the server marks true, so the flag must say exactly whether
// quiz-tryon could render that match: try-on on for the shop AND a prompt
// resolvable the way quiz-tryon resolves it (variant prompt, else the
// product's; a partial match goes out at product level).

const h = vi.hoisted(() => ({
  pool: null as any,
  orderByMatrix: null as any,
  matchRules: null as any,
}));

vi.mock("../supabase.server", () => ({
  getChatAssistantConfig: async () => ({}),
  getRecommendationFlow: async () => ({ questions: [], photoAxisDetails: [] }),
  matchRecommendationRules: (...args: unknown[]) => h.matchRules(...args),
  ANY_VALUE: "_any",
}));
vi.mock("../recommendation-engine.server", () => ({
  buildCandidatePool: async () => ({ pool: h.pool, emptyReason: null }),
  aiOrderCandidates: (c: unknown[]) => c,
  orderByMatrix: (...args: unknown[]) => h.orderByMatrix(...args),
  fetchProductHandles: async () => new Map(),
  fetchAvailability: async () => null,
  slugifyHandle: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  extractNumericId: (gid: string | null | undefined) => (gid ? gid.split("/").pop() ?? null : null),
}));
vi.mock("../llm-recommender.server", () => ({
  llmOrderCandidates: async () => null,
  guardAndPrioritize: (ordered: unknown[]) => ordered,
  applyPriorityOrdering: (ordered: unknown[]) => ordered,
}));
vi.mock("../answer-rules-runtime.server", () => ({
  loadAnswerLayer: async () => null,
  narrowPool: () => ({ candidates: [] }),
  chosenSentences: async () => [],
  sentenceTags: () => ({}),
  applyAlways: (o: unknown) => o,
}));

import { computeQuizRecommendations } from "../quiz-recommend.server";

const product = (id: string, name: string, prompt: string | null) => ({
  id,
  product_name: name,
  shopify_id: `gid://shopify/Product/${id}`,
  transformation_prompt: prompt,
});
const variant = (id: string, productId: string, prompt: string | null) => ({
  id,
  product_id: productId,
  shopify_variant_id: `gid://shopify/ProductVariant/${id}`,
  variant_title: `Shade ${id}`,
  transformation_prompt: prompt,
});

// P1: product prompt (its variant has none, so it inherits).
// P2: only its variant has a prompt.
// P3: nothing set up (the reviewer's toner / mask / pants).
// P4: a whitespace-only prompt (nothing for the model to do).
const P1 = product("1", "Polish", "Apply the polish shade to the nails");
const P2 = product("2", "Lipstick", null);
const P3 = product("3", "Toner", null);
const P4 = product("4", "Mask", "   ");
const V1 = variant("11", "1", null);
const V2 = variant("21", "2", "Apply this lipstick shade");
const CANDIDATES = [
  { product: P1, variant: V1 },
  { product: P2, variant: V2 },
  { product: P3, variant: null },
  { product: P4, variant: null },
];

const config = (over: Record<string, unknown> = {}) =>
  ({
    recommendation_mode: "matrix",
    num_recommendations: 4,
    priority_product_ids: [],
    quiz_availability_filter: false,
    quiz_tryon_enabled: true,
    quiz_multi_set_prompt: null,
    ...over,
  }) as any;

const run = (chatConfig: any, criteria: Record<string, string> = {}) =>
  computeQuizRecommendations({
    verifiedShop: { id: "shop-1" },
    verifiedDomain: "shop.myshopify.com",
    chatConfig,
    criteria,
    clientIP: "203.0.113.9",
  });

beforeEach(() => {
  h.pool = {
    products: [P1, P2, P3, P4],
    variants: [V1, V2],
    candidates: CANDIDATES,
  };
  h.matchRules = vi.fn(async () => null);
  h.orderByMatrix = vi.fn((_hits: unknown, _pool: unknown, ordered: unknown[]) => ({
    ordered,
    matrixApplied: false,
    matrixCount: 0,
  }));
});

describe("quiz-recommend tryon flag", () => {
  it("marks exactly the matches quiz-tryon could render", async () => {
    const res = await run(config());
    expect(res.matches.map((m) => [m.productName, m.tryon])).toEqual([
      ["Polish", true],
      ["Lipstick", true],
      ["Toner", false],
      ["Mask", false],
    ]);
  });

  it("is false everywhere while the shop has try-on switched off", async () => {
    const res = await run(config({ quiz_tryon_enabled: false }));
    expect(res.matches.map((m) => m.tryon)).toEqual([false, false, false, false]);
  });

  it("a partial match is judged at product level, like quiz-tryon renders it", async () => {
    h.matchRules = vi.fn(async () => ({ hits: [{}], partial: true }));
    h.orderByMatrix = vi.fn(() => ({
      ordered: CANDIDATES.map((c, i) => ({ ...c, matrixRank: i + 1 })),
      matrixApplied: true,
      matrixCount: CANDIDATES.length,
    }));
    const res = await run(config(), { vibe: "bold" });
    expect(res.partial).toBe(true);
    expect(res.matches.map((m) => [m.productName, m.variantId, m.tryon])).toEqual([
      ["Polish", null, true],
      // Its only prompt is on the variant, which a partial card doesn't carry.
      ["Lipstick", null, false],
      ["Toner", null, false],
      ["Mask", null, false],
    ]);
  });

  it("a 2-set pick counts the shop-wide multi-set prompt", async () => {
    h.orderByMatrix = vi.fn((_h: unknown, _p: unknown, ordered: any[]) => ({
      ordered: ordered.map((c) => ({ ...c, quantity: 2 })),
      matrixApplied: false,
      matrixCount: 0,
    }));
    const res = await run(config({ quiz_multi_set_prompt: "Render {count} sets" }));
    expect(res.matches.map((m) => m.tryon)).toEqual([true, true, true, true]);
  });
});
