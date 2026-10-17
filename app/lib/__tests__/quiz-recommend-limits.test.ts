import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// quiz-recommend's LLM ranking path: a per-shop minute window plus a daily
// ceiling, counted only for calls the per-IP cap let through. Over any of
// them the shopper still gets results (guarded shuffle), never a 429. The
// data layer is stubbed to an empty pool so each call is cheap.

vi.mock("../supabase.server", () => ({
  getChatAssistantConfig: async () => ({}),
  getRecommendationFlow: async () => ({ questions: [], photoAxisDetails: [] }),
  matchRecommendationRules: async () => null,
  ANY_VALUE: "_any",
}));
vi.mock("../recommendation-engine.server", () => ({
  buildCandidatePool: async () => ({ pool: { products: [], variants: [], candidates: [] } }),
  aiOrderCandidates: (c: unknown[]) => c,
  orderByMatrix: (_hits: unknown, _pool: unknown, ordered: unknown[]) => ({ ordered, matrixApplied: false, matrixCount: 0 }),
  fetchProductHandles: async () => new Map(),
  fetchAvailability: async () => null,
  slugifyHandle: (s: string) => s,
  extractNumericId: () => null,
}));
const llmOrderCandidates = vi.fn(async () => ({ ordered: [], reasons: new Map() }));
const guardAndPrioritize = vi.fn((ordered: unknown[]) => ordered);
vi.mock("../llm-recommender.server", () => ({
  llmOrderCandidates: () => llmOrderCandidates(),
  guardAndPrioritize: (ordered: unknown[]) => guardAndPrioritize(ordered),
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

const MINUTE = 60 * 1000;
const T0 = Date.parse("2026-10-16T00:00:00Z");
let ipSeq = 0;
const nextIP = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;

const chatConfig = {
  recommendation_mode: "hybrid",
  num_recommendations: 3,
  priority_product_ids: [],
  quiz_availability_filter: false,
} as any;

const recommend = (shopId: string, clientIP = nextIP()) =>
  computeQuizRecommendations({
    verifiedShop: { id: shopId },
    verifiedDomain: `${shopId}.myshopify.com`,
    chatConfig,
    criteria: { vibe: "bold" },
    clientIP,
  });

beforeEach(() => {
  llmOrderCandidates.mockClear();
  guardAndPrioritize.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quiz-recommend LLM ranking limits", () => {
  it("keeps 60/minute per shop and adds a 5000/day ceiling, degrading instead of failing", async () => {
    for (let i = 0; i < 60; i++) await recommend("busy");
    expect(llmOrderCandidates).toHaveBeenCalledTimes(60);
    const overMinute = await recommend("busy");
    expect(overMinute.matches).toEqual([]);
    expect(overMinute.error).toBeUndefined();
    expect(llmOrderCandidates).toHaveBeenCalledTimes(60);

    // 5000 across fresh minutes, then a fresh minute is still refused.
    let minute = 0;
    while (llmOrderCandidates.mock.calls.length < 5000) {
      minute++;
      vi.setSystemTime(new Date(T0 + minute * (MINUTE + 1000)));
      const n = Math.min(60, 5000 - llmOrderCandidates.mock.calls.length);
      for (let i = 0; i < n; i++) await recommend("busy");
    }
    vi.setSystemTime(new Date(T0 + (minute + 1) * (MINUTE + 1000)));
    guardAndPrioritize.mockClear();
    await recommend("busy");
    expect(llmOrderCandidates).toHaveBeenCalledTimes(5000);
    expect(guardAndPrioritize).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("requests the per-IP cap stopped don't spend the shop's budget", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 6; i++) await recommend("shared", ip);
    for (let i = 0; i < 20; i++) await recommend("shared", ip);
    expect(llmOrderCandidates).toHaveBeenCalledTimes(6);
    // The other 54 of the shop's minute are still there for other shoppers.
    for (let i = 0; i < 54; i++) await recommend("shared");
    expect(llmOrderCandidates).toHaveBeenCalledTimes(60);
    await recommend("shared");
    expect(llmOrderCandidates).toHaveBeenCalledTimes(60);
  });
});
