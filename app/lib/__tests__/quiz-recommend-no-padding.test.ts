import { describe, it, expect, vi, beforeEach } from "vitest";

// Shopify App Review, 2026-10-19: a shopper who answered "Skincare" on the
// reviewer's quiz got Wide-Leg Yoga Pants as step 3 of a skincare routine.
// The AI ranker picked the toner and the mask; the third card was padded
// from the candidates it had left out. LLM-ranked results now serve only
// the ranker's picks (plus store-wide always products), and fall back to
// the full ordering only if none of them can be served.

const h = vi.hoisted(() => ({
  pool: null as any,
  ranked: null as any,
  always: [] as Array<{ id: string }>,
}));

vi.mock("../supabase.server", () => ({
  getChatAssistantConfig: async () => ({}),
  getRecommendationFlow: async () => ({ questions: [], photoAxisDetails: [] }),
  matchRecommendationRules: async () => null,
  ANY_VALUE: "_any",
}));
vi.mock("../recommendation-engine.server", () => ({
  buildCandidatePool: async () => ({ pool: h.pool, emptyReason: null }),
  aiOrderCandidates: (c: unknown[]) => c,
  orderByMatrix: (_hits: unknown, _pool: unknown, ordered: unknown[]) => ({ ordered, matrixApplied: false, matrixCount: 0 }),
  fetchProductHandles: async () => new Map(),
  fetchAvailability: async () => null,
  slugifyHandle: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  extractNumericId: (gid: string | null | undefined) => (gid ? gid.split("/").pop() ?? null : null),
}));
vi.mock("../llm-recommender.server", () => ({
  llmOrderCandidates: async () => h.ranked,
  guardAndPrioritize: (ordered: unknown[]) => ordered,
  applyPriorityOrdering: (ordered: unknown[]) => ordered,
}));
vi.mock("../answer-rules-runtime.server", () => ({
  loadAnswerLayer: async () => (h.always.length ? { global: { always: h.always, never: [] } } : null),
  narrowPool: (candidates: unknown[]) => ({ candidates }),
  chosenSentences: async () => [],
  sentenceTags: () => ({}),
  applyAlways: (o: any) => {
    if (!h.always.length) return o;
    const front = o.ordered.filter((c: any) => h.always.some((a) => a.id === c.product.id));
    return { ...o, ordered: [...front, ...o.ordered.filter((c: any) => !front.includes(c))] };
  },
}));

import { computeQuizRecommendations } from "../quiz-recommend.server";

const product = (id: string, name: string) => ({ id, product_name: name, shopify_id: `gid://shopify/Product/${id}`, transformation_prompt: null });
const TONER = { product: product("1", "Hydrating green tea toner"), variant: null };
const MASK = { product: product("2", "Purifying Clay Mask"), variant: null };
const PANTS = { product: product("3", "Wide-Leg Yoga Pants"), variant: null };
const SHIRT = { product: product("4", "SHIRT TEST"), variant: null };

const config = {
  recommendation_mode: "hybrid",
  num_recommendations: 3,
  priority_product_ids: [],
  quiz_availability_filter: false,
  quiz_tryon_enabled: false,
  quiz_multi_set_prompt: null,
} as any;

const run = () =>
  computeQuizRecommendations({
    verifiedShop: { id: "shop-1" },
    verifiedDomain: "shop.myshopify.com",
    chatConfig: config,
    criteria: { shopping_for: "skincare" },
    clientIP: "203.0.113.10",
  });

beforeEach(() => {
  h.pool = { products: [], variants: [], candidates: [TONER, MASK, PANTS, SHIRT] };
  h.always = [];
});

describe("LLM-ranked results are not padded", () => {
  it("serves only the ranker's picks, even below num_recommendations", async () => {
    h.ranked = { ordered: [TONER, MASK, PANTS, SHIRT], reasons: new Map(), picked: new Set([TONER, MASK]) };
    const res = await run();
    expect(res.matches.map((m) => m.productName)).toEqual(["Hydrating green tea toner", "Purifying Clay Mask"]);
  });

  it("still leads with store-wide always products", async () => {
    h.always = [{ id: "4" }];
    h.ranked = { ordered: [TONER, MASK, PANTS, SHIRT], reasons: new Map(), picked: new Set([TONER]) };
    const res = await run();
    expect(res.matches.map((m) => m.productName)).toEqual(["SHIRT TEST", "Hydrating green tea toner"]);
  });

  it("without a ranker result, the shuffle fallback still fills the results", async () => {
    h.ranked = null;
    const res = await run();
    expect(res.matches).toHaveLength(3);
  });
});
