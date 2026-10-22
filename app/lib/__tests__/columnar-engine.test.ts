import { describe, it, expect, vi, beforeEach } from "vitest";

// The columnar engine end to end on Glamnetic's fixture pool, with the
// database, the stock probe and the ranker stubbed: Step D picks are used
// only when valid, a timeout or a bad pick serves Step C's order, sold-out
// sets drop out, a resultKey re-serves the cached result, the storefront
// flow gets the branching block, and a spec write merges.

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  unavailable: new Set<string>(),
  availabilityCalls: 0,
  llm: null as null | ((req: any) => Promise<unknown>),
  llmCalls: 0,
}));

vi.mock("../supabase.server", () => {
  function from(table: string) {
    let rows = [...(state.tables[table] ?? [])];
    let patch: Record<string, unknown> | null = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        rows = rows.filter((r) => r[c] === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        rows = rows.filter((r) => vs.includes(r[c]));
        return q;
      },
      update: (p: Record<string, unknown>) => {
        patch = p;
        return q;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) for (const r of rows) Object.assign(r, patch);
        resolve({ data: rows, error: null });
      },
    };
    return q;
  }
  return {
    supabase: { from },
    getRecommendationFlow: async () => ({
      questions: [
        {
          axisKey: "color_family",
          options: [
            { label: "Nudes & neutrals", axisValue: "nudes_neutrals", selectAll: false },
            { label: "Reds & berries", axisValue: "reds_berries", selectAll: false },
          ],
        },
      ],
      photoAxes: [],
      photoAxisDetails: [],
      configured: true,
    }),
  };
});
vi.mock("../recommendation-engine.server", () => ({
  extractNumericId: (gid: string | null | undefined) => (gid ? gid.split("/").pop() ?? null : null),
  fetchAvailability: async (_shop: string, gids: string[]) => {
    state.availabilityCalls++;
    return new Map(gids.map((g) => [g, !state.unavailable.has(g)]));
  },
}));
vi.mock("../llm-recommender.server", () => ({
  RANKER_MODELS: { lite: "lite", flash: "flash", pro: "pro" },
  NO_THINKING: { lite: { thinkingBudget: 0 }, flash: { thinkingBudget: 0 }, pro: undefined },
}));
vi.mock("../gemini.server", () => ({
  geminiClient: () => ({
    models: {
      generateContent: (req: any) => {
        state.llmCalls++;
        return state.llm ? state.llm(req) : Promise.reject(new Error("no llm"));
      },
    },
  }),
  extractGeminiText: (r: any) => r.text,
  stripJsonFences: (s: string) => s,
}));

import {
  computeColumnarRecommendations,
  decorateFlowForColumnar,
  invalidateColumnarCaches,
  syncColumnarPool,
  updateColumnarSpec,
} from "../columnar/engine.server";
import { computeQuizRecommendations } from "../quiz-recommend.server";
import { decodeResultKey, passesHardFilters } from "../columnar/pipeline";
import { deriveProduct } from "../columnar/attributes";
import { glamneticSpec, loadGlamneticPool } from "./fixtures/glamnetic-columnar";

const SHOP = { id: "shop-glam" };
const DOMAIN = "glamrco.myshopify.com";
const fixture = loadGlamneticPool();
const byId = new Map(fixture.map((p) => [p.id, deriveProduct(p)]));

const criteria = {
  vibe: "french_girl",
  length: ["short"],
  shape: ["almond"],
  color_family: ["nudes_neutrals"],
  question_6: ["option_1"],
  style_tier: ["clean"],
};

let ipSeq = 0;
const run = (over: Partial<Parameters<typeof computeColumnarRecommendations>[0]> = {}) =>
  computeColumnarRecommendations({
    verifiedShop: SHOP,
    verifiedDomain: DOMAIN,
    chatConfig: { recommendation_tuning: { rankerModel: "flash", llmReasons: true } as any, quiz_product_why: null },
    spec: glamneticSpec(),
    criteria,
    clientIP: `10.0.0.${ipSeq++ % 250}`,
    ...over,
  });

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.tables = {
    products: fixture.map((p) => ({
      id: p.id,
      shop_id: SHOP.id,
      shopify_id: p.shopifyId,
      handle: p.handle,
      product_name: p.title,
      status: p.status,
      product_type: p.productType,
      tags: p.tags,
      price: p.price,
      image_url: null,
    })),
    product_variants: fixture.map((p) => ({
      product_id: p.id,
      shopify_variant_id: p.variantId,
      variant_title: "Default Title",
      status: "active",
    })),
    chat_assistant_config: [
      {
        shop_domain: DOMAIN,
        recommendation_tuning: { rankerModel: "lite", maxLlmCandidates: 120, futureKnob: "kept", columnar: glamneticSpec() },
      },
    ],
  };
  state.unavailable = new Set();
  state.availabilityCalls = 0;
  state.llm = null;
  state.llmCalls = 0;
  invalidateColumnarCaches(SHOP.id);
});

describe("computeColumnarRecommendations", () => {
  it("uses a valid ranking, keeps valid reasons and templates the rest", async () => {
    state.llm = async (req) => {
      const cands = JSON.parse(req.contents[0].parts[0].text.split("Candidates:\n")[1].split("\n\nReturn")[0]);
      expect(cands.length).toBeLessThanOrEqual(40);
      const picks = [5, 4, 3, 2, 1, 0].map((id) => ({ id, reason: id === 0 ? "The closest match to your coffin pick." : "French tips in the nudes you love." }));
      return { text: JSON.stringify({ picks }) };
    };
    const r = await run();
    expect(r.matches).toHaveLength(6);
    expect(r.columnar.rung).toBe(1);
    expect(r.columnar.bestMatchBadge).toBe(true);
    expect(r.columnar.header).toEqual({ kind: "normal", text: null });
    // The Also matched row is retired: the field stays, always empty.
    expect(r.columnar.alsoMatched).toEqual([]);
    const answers = decodeResultKey(r.columnar.resultKey)!;
    for (const m of [...r.matches, ...r.columnar.alsoMatched]) {
      const p = [...byId.values()].find((x) => x.handle === m.productHandle)!;
      expect(passesHardFilters(p, answers)).toBe(true);
      expect(m.meta).toEqual({ length: "Short", shape: "Almond", finish: "Glossy" });
      expect(m.variantNumericId).toMatch(/^\d+$/);
      expect(m.variantTitle).toBeNull();
    }
    // Five valid LLM reasons; the hedging one is replaced by the template.
    expect(r.matches.slice(0, 5).every((m) => m.reasons[0] === "French tips in the nudes you love.")).toBe(true);
    expect(r.matches[5].reasons[0]).not.toMatch(/closest|coffin/i);
    expect(r.columnar.answers).toEqual({
      vibe: ["french_girl"],
      length: ["short"],
      shape: ["almond"],
      color_family: ["nudes_neutrals"],
      question_6: ["option_1"],
      style_tier: ["clean"],
    });
  });

  it("serves Step C's order with templated reasons when the ranker picks outside the set", async () => {
    state.llm = async () => ({ text: JSON.stringify({ picks: [0, 1, 2, 3, 4, 99].map((id) => ({ id, reason: "x" })) }) });
    const ranked = await run();
    invalidateColumnarCaches(SHOP.id);
    state.llm = null; // the "no ranker" order is Step C's
    const fallback = await run();
    expect(ranked.matches.map((m) => m.productHandle)).toEqual(fallback.matches.map((m) => m.productHandle));
    expect(ranked.matches.every((m) => m.reasons[0] && m.reasons[0] !== "x")).toBe(true);
  });

  it("times out after spec.llm.timeoutMs and still answers", async () => {
    state.llm = () => new Promise(() => {});
    const started = Date.now();
    const r = await run({ spec: glamneticSpec({ llm: { enabled: true, timeoutMs: 500 } }) });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.matches).toHaveLength(6);
  });

  it("drops sold-out sets before ranking", async () => {
    const first = (await run()).matches[0];
    invalidateColumnarCaches(SHOP.id);
    const variant = state.tables.product_variants.find((v) => v.product_id === [...byId.values()].find((p) => p.handle === first.productHandle)!.id)!;
    state.unavailable.add(String(variant.shopify_variant_id));
    const r = await run();
    expect(r.matches).toHaveLength(6);
    expect(r.matches.map((m) => m.productHandle)).not.toContain(first.productHandle);
    expect(r.columnar.alsoMatched.map((m) => m.productHandle)).not.toContain(first.productHandle);
  });

  it("re-serves the cached result for a resultKey, and recomputes it once the cache is gone", async () => {
    state.llm = async () => ({ text: JSON.stringify({ picks: [1, 0, 2, 3, 4, 5].map((id) => ({ id, reason: "French tips for you." })) }) });
    const first = await run();
    const calls = state.llmCalls;
    const again = await run({ criteria: {}, resultKey: first.columnar.resultKey });
    expect(again).toBe(first);
    expect(state.llmCalls).toBe(calls);
    invalidateColumnarCaches(SHOP.id);
    const recomputed = await run({ criteria: {}, resultKey: first.columnar.resultKey });
    expect(recomputed.columnar.resultKey).toBe(first.columnar.resultKey);
    expect(recomputed.matches.map((m) => m.productHandle)).toEqual(first.matches.map((m) => m.productHandle));
  });

  it("a cached result is re-checked for stock: a set that sold out since is replaced", async () => {
    const first = await run();
    const gone = first.matches[2].productHandle;
    const variant = state.tables.product_variants.find((v) => v.product_id === [...byId.values()].find((p) => p.handle === gone)!.id)!;
    state.unavailable.add(String(variant.shopify_variant_id));
    const again = await run({ criteria: {}, resultKey: first.columnar.resultKey });
    expect(again).not.toBe(first);
    expect(again.matches).toHaveLength(6);
    expect(again.matches.map((m) => m.productHandle)).not.toContain(gone);
    // Still in stock: the cache is served as is.
    expect(await run({ criteria: {}, resultKey: first.columnar.resultKey })).toBe(again);
  });

  it("a permalink that doesn't decode is an error, not a result over the whole pool", async () => {
    for (const resultKey of ["c1.x.x", "c9.x.x.x.x.x.x", "c1.ff.x.x.x.x.x"]) {
      const r = await run({ criteria: {}, resultKey });
      expect(r.matches).toEqual([]);
      expect(r.error).toBeTruthy();
      expect(r.columnar.alsoMatched).toEqual([]);
    }
  });

  it("a ranker setting change is a new result, not the cached one", async () => {
    state.llm = async () => ({ text: JSON.stringify({ picks: [0, 1, 2, 3, 4, 5].map((id) => ({ id, reason: "French tips for you." })) }) });
    const flash = await run();
    const calls = state.llmCalls;
    const lite = await run({ chatConfig: { recommendation_tuning: { rankerModel: "lite", llmReasons: true } as any, quiz_product_why: null } });
    expect(lite).not.toBe(flash);
    expect(state.llmCalls).toBe(calls + 1);
  });

  it("a starved path shows what exists and nothing wider", async () => {
    const r = await run({
      criteria: { vibe: "french_girl", length: ["medium"], shape: ["coffin"], question_6: ["option_5"], color_family: ["dark_moody"], style_tier: ["art"] },
    });
    expect(r.columnar.rung).toBe(5);
    expect(r.matches.map((m) => m.meta)).toEqual([{ length: "Medium", shape: "Coffin", finish: "Matte" }]);
    expect(r.columnar.header.kind).toBe("fewer");
    expect(r.columnar.bestMatchBadge).toBe(false);
  });

  it("offers one tap to loosen the finish when nothing matches", async () => {
    const r = await run({ criteria: { length: ["super_short"], question_6: ["option_5"] } });
    expect(r.matches).toEqual([]);
    expect(r.columnar.header).toEqual({ kind: "none", text: "We don't have that combination yet." });
    expect(r.columnar.loosen).toEqual({ axisKey: "question_6", label: "Try any finish" });
  });
});

describe("computeQuizRecommendations", () => {
  it("routes a shop with an enabled spec to the columnar engine", async () => {
    const r = await computeQuizRecommendations({
      verifiedShop: SHOP,
      verifiedDomain: DOMAIN,
      chatConfig: { recommendation_tuning: { columnar: glamneticSpec() }, quiz_product_why: null } as any,
      criteria,
      clientIP: "10.9.9.9",
    });
    expect(r.columnar?.rung).toBe(1);
    expect(r.matches[0].meta?.length).toBe("Short");
  });
});

describe("decorateFlowForColumnar", () => {
  const flow = {
    questions: [
      {
        axisKey: "vibe",
        options: [
          { axisValue: "model_off_duty", label: "Clean Girl" },
          { axisValue: "option_8", label: "Holiday-ready" },
          { axisValue: "model_off_duty", label: "Surprise me", selectAll: true },
        ],
      },
      { axisKey: "length", options: [{ axisValue: "short", label: "Short" }] },
    ],
    photoAxes: [],
    configured: true,
  };

  it("removes retired vibe tiles (never select-all) and adds one branching row per eligible set", async () => {
    const out = await decorateFlowForColumnar(SHOP.id, flow, {
      recommendation_tuning: { columnar: glamneticSpec({ vibes: { holiday: { enabled: false } } }) },
    });
    expect(out.questions[0].options.map((o) => o.label)).toEqual(["Clean Girl", "Surprise me"]);
    expect(out.questions[1]).toBe(flow.questions[1]);
    expect(out.branching?.pool.rows).toHaveLength(416);
    expect(out.branching?.threshold).toBe(6);
  });

  it("serves no branching block when nothing in the pool can be matched", async () => {
    // Under contract 3 an empty row list would skip every length, shape and
    // finish question for every shopper.
    const out = await decorateFlowForColumnar(SHOP.id, flow, {
      recommendation_tuning: {
        columnar: glamneticSpec({ pool: { handles: ["queen-of-hearts-medium-coffin-press-on-nails"], source: "csv" } }),
      },
    });
    expect(out.branching).toBeUndefined();
    expect(out.questions[1]).toBe(flow.questions[1]);
  });

  it("leaves every other shop's flow untouched", async () => {
    expect(await decorateFlowForColumnar(SHOP.id, flow, { recommendation_tuning: { rankerModel: "flash" } })).toBe(flow);
    expect(
      await decorateFlowForColumnar(SHOP.id, flow, { recommendation_tuning: { columnar: glamneticSpec({ enabled: false }) } }),
    ).toBe(flow);
    expect(await decorateFlowForColumnar(SHOP.id, flow, null)).toBe(flow);
  });
});

describe("updateColumnarSpec", () => {
  it("merges into recommendation_tuning: other keys, including unknown ones, are kept as stored", async () => {
    await updateColumnarSpec(SHOP.id, DOMAIN, (s) => ({ ...s, threshold: 4, vibes: { holiday: { enabled: false } } }));
    const stored = state.tables.chat_assistant_config[0].recommendation_tuning as Record<string, any>;
    expect(stored.rankerModel).toBe("lite");
    expect(stored.maxLlmCandidates).toBe(120);
    expect(stored.futureKnob).toBe("kept");
    expect(stored.columnar.threshold).toBe(4);
    expect(stored.columnar.vibes).toEqual({ holiday: { enabled: false } });
    expect(stored.columnar.pool.handles).toHaveLength(424);
  });

  it("a refused change (the Studio's enable check) writes nothing", async () => {
    const before = JSON.stringify(state.tables.chat_assistant_config[0].recommendation_tuning);
    await expect(
      updateColumnarSpec(SHOP.id, DOMAIN, async () => {
        throw new Error("No product in the pool can be matched yet, so this stays off.");
      }),
    ).rejects.toThrow(/stays off/);
    expect(JSON.stringify(state.tables.chat_assistant_config[0].recommendation_tuning)).toBe(before);
  });

  it("refuses to create a spec for a shop without one", async () => {
    state.tables.chat_assistant_config[0].recommendation_tuning = { rankerModel: "flash" };
    await expect(updateColumnarSpec(SHOP.id, DOMAIN, (s) => s)).rejects.toThrow(/isn't set up/);
    expect(state.tables.chat_assistant_config[0].recommendation_tuning).toEqual({ rankerModel: "flash" });
  });
});

describe("syncColumnarPool", () => {
  // Admin GraphQL stub: the collection's handles in pages of 250.
  const collection = (handles: string[] | null) => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const graphql = async (_q: string, vars?: Record<string, unknown>) => {
      calls.push(vars);
      if (!handles) return { collectionByHandle: null };
      const start = vars?.after ? Number(vars.after) : 0;
      const next = start + 250;
      return {
        collectionByHandle: {
          products: {
            pageInfo: { hasNextPage: next < handles.length, endCursor: String(next) },
            nodes: handles.slice(start, next).map((handle) => ({ handle })),
          },
        },
      };
    };
    return { graphql, calls };
  };
  const stored = () => state.tables.chat_assistant_config[0].recommendation_tuning as Record<string, any>;

  it("pages through the collection and merges the handles into spec.pool only", async () => {
    const handles = fixture.slice(0, 414).map((p) => p.handle);
    const { graphql, calls } = collection(handles);
    const r = await syncColumnarPool(SHOP.id, DOMAIN, graphql, { collectionHandle: "shop-all-nails-gleame-quiz-flow" });
    expect(r).toEqual({ ok: true, count: 414, collectionHandle: "shop-all-nails-gleame-quiz-flow" });
    expect(calls.map((c) => c?.after ?? null)).toEqual([null, "250"]);
    expect(stored().columnar.pool).toMatchObject({
      handles,
      source: "collection",
      collectionHandle: "shop-all-nails-gleame-quiz-flow",
    });
    expect(stored().columnar.axes).toEqual(glamneticSpec().axes);
    expect(stored().futureKnob).toBe("kept");
  });

  it("never overwrites the pool with a missing or empty collection", async () => {
    const before = JSON.stringify(stored());
    expect((await syncColumnarPool(SHOP.id, DOMAIN, collection(null).graphql, { collectionHandle: "gone" })).ok).toBe(false);
    expect((await syncColumnarPool(SHOP.id, DOMAIN, collection([]).graphql, { collectionHandle: "empty" })).ok).toBe(false);
    expect(JSON.stringify(stored())).toBe(before);
  });

  it("a background refresh refuses to shrink the pool by more than half; the Studio button can", async () => {
    const few = fixture.slice(0, 100).map((p) => p.handle);
    const bg = await syncColumnarPool(SHOP.id, DOMAIN, collection(few).graphql, { collectionHandle: "c", background: true });
    expect(bg.ok).toBe(false);
    expect(stored().columnar.pool.handles).toHaveLength(424);
    const manual = await syncColumnarPool(SHOP.id, DOMAIN, collection(few).graphql, { collectionHandle: "c" });
    expect(manual.ok).toBe(true);
    expect(stored().columnar.pool.handles).toHaveLength(100);
  });
});
