import { describe, it, expect, beforeEach, vi } from "vitest";

// Studio canvas try-on, same rule as the storefront (App Review
// 2026-10-19 follow-up). quiz-config already ANDs the merchant's try-on
// toggle with "at least one product the quiz can recommend is set up for
// try-on", and quiz-recommend flags each match; the Studio preview still
// served the raw toggle, so a store with no try-on-ready product saw the
// photo step and "Try them on me" on the canvas that shoppers never get.

const SHOP = { id: "1454909e-6995-4a5b-a49d-15a0d6c11349", shop_domain: "pqkzt0-gb.myshopify.com" };
const PANTS = "11111111-1111-4111-8111-111111111111";
const LIPSTICK = "22222222-2222-4222-8222-222222222222";
const LIPSTICK_RED = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  getChatAssistantConfig: vi.fn(),
  findShopByDomain: vi.fn(),
  shopHasTryonProducts: vi.fn(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

// supabase-js query builder over in-memory rows: select / eq / in / order /
// limit, awaited as { data, error }.
function query(table: string) {
  let rows = [...(m.tables[table] ?? [])];
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return builder; },
    in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return builder; },
    order: () => builder,
    limit: (n: number) => { rows = rows.slice(0, n); return builder; },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return builder;
}

vi.mock("../supabase.server", () => ({
  supabase: { from: (t: string) => query(t) },
  getChatAssistantConfig: m.getChatAssistantConfig,
  findShopByDomain: m.findShopByDomain,
  textureOrUndefined: () => undefined,
}));
vi.mock("../tryon-availability.server", () => ({ shopHasTryonProducts: m.shopHasTryonProducts }));
vi.mock("../recommendation-engine.server", () => ({ buildCandidatePool: async () => ({ pool: null }) }));
vi.mock("../shop-currency.server", () => ({ getShopCurrency: async () => "USD" }));
vi.mock("../brand-profile.server", () => ({
  getBrandProfile: async () => null,
  servedTemplateFor: (template: string | null) => template,
}));
vi.mock("../quiz-offers.server", () => ({
  getQuizOffers: async () => ({ crossSellEnabled: false, crossSellItems: [] }),
  numericShopifyId: (gid: string) => gid.split("/").pop(),
  publicOffersPayload: () => ({ crossSell: null, bundleDiscount: null }),
  OFFERS_DEFAULTS: {},
}));

import { buildPreviewQuizConfig, buildPreviewSampleRecommend } from "../quiz-preview.server";

const liveConfig = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  assistant_mode: "both",
  assistant_name: "Laura",
  quiz_template: "t3",
  quiz_tryon_enabled: true,
  quiz_gate_enabled: true,
  quiz_multi_set_prompt: null,
  product_scope: "all_configured",
  selected_product_ids: [],
  quiz_trust_items: [],
  quiz_product_why: {},
  ...over,
});

const draft = (rules: Array<Record<string, unknown>>) =>
  ({ flow: { axes: [], questions: [], rules }, settings: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.findShopByDomain.mockResolvedValue(SHOP);
  m.tables = {
    products: [
      { id: PANTS, shop_id: SHOP.id, handle: "wide-leg-yoga-pants", product_name: "Wide-Leg Yoga Pants", status: "active", transformation_prompt: "", image_url: null, price: 100 },
      { id: LIPSTICK, shop_id: SHOP.id, handle: "velvet-lipstick", product_name: "Velvet Lipstick", status: "active", transformation_prompt: null, image_url: null, price: 24 },
    ],
    product_variants: [
      { id: LIPSTICK_RED, product_id: LIPSTICK, variant_title: "Red", status: null, transformation_prompt: "Apply a velvet red lipstick" },
    ],
  };
});

describe("buildPreviewQuizConfig tryonEnabled", () => {
  it("toggle on, no product set up for try-on: off on the canvas too", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig());
    m.shopHasTryonProducts.mockResolvedValue(false);
    const config = await buildPreviewQuizConfig(SHOP.shop_domain, draft([]));
    expect(config.tryonEnabled).toBe(false);
    expect(m.shopHasTryonProducts).toHaveBeenCalledWith(SHOP.id, expect.objectContaining({ product_scope: "all_configured" }));
  });

  it("toggle on and a product set up: on", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig());
    m.shopHasTryonProducts.mockResolvedValue(true);
    expect((await buildPreviewQuizConfig(SHOP.shop_domain, draft([]))).tryonEnabled).toBe(true);
  });

  it("toggle off: off, without reading the catalog", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig({ quiz_tryon_enabled: false }));
    expect((await buildPreviewQuizConfig(SHOP.shop_domain, draft([]))).tryonEnabled).toBe(false);
    expect(m.shopHasTryonProducts).not.toHaveBeenCalled();
  });

  it("a failed check keeps the merchant's toggle, as the storefront does", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig());
    m.shopHasTryonProducts.mockRejectedValue(new Error("db down"));
    expect((await buildPreviewQuizConfig(SHOP.shop_domain, draft([]))).tryonEnabled).toBe(true);
  });
});

describe("buildPreviewSampleRecommend per-match try-on flag", () => {
  it("flags each sample match the way quiz-recommend does", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig());
    const sample = await buildPreviewSampleRecommend(
      SHOP.id,
      draft([
        { criteria: {}, productId: PANTS, variantId: null, rank: 1, quantity: 1 },
        { criteria: {}, productId: null, variantId: LIPSTICK_RED, rank: 2, quantity: 1 },
      ]),
      6,
      SHOP.shop_domain,
    );
    const byHandle = Object.fromEntries((sample.matches as Array<{ productHandle: string; tryon?: boolean }>).map((x) => [x.productHandle, x.tryon]));
    expect(byHandle).toEqual({ "wide-leg-yoga-pants": false, "velvet-lipstick": true });
  });

  it("the shop-wide multi-set prompt makes a 2-set pick renderable", async () => {
    m.getChatAssistantConfig.mockResolvedValue(liveConfig({ quiz_multi_set_prompt: "Show {count} sets" }));
    const sample = await buildPreviewSampleRecommend(
      SHOP.id,
      draft([{ criteria: {}, productId: PANTS, variantId: null, rank: 1, quantity: 2 }]),
      6,
      SHOP.shop_domain,
    );
    expect((sample.matches as Array<{ tryon?: boolean }>)[0].tryon).toBe(true);
  });
});
