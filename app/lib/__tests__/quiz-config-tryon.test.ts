import { describe, it, expect, beforeEach, vi } from "vitest";

// quiz-config's tryonEnabled (2026-10-19 App Review): the merchant toggle
// (quiz_tryon_enabled, default on) AND at least one product set up for
// try-on. The App Review store had the toggle on by default and no product
// configured, so the quiz offered a photo step and "Try them on me" that
// could never render anything. The deployed widget already hides every
// try-on surface on tryonEnabled=false, so this alone fixes that store.

const m = vi.hoisted(() => ({
  findShopByDomain: vi.fn(),
  shopHasValidAccess: vi.fn(),
  getChatAssistantConfig: vi.fn(),
  shopHasTryonProducts: vi.fn(),
}));

vi.mock("../supabase.server", () => ({
  findShopByDomain: m.findShopByDomain,
  shopHasValidAccess: m.shopHasValidAccess,
  getChatAssistantConfig: m.getChatAssistantConfig,
}));
vi.mock("../tryon-availability.server", () => ({ shopHasTryonProducts: m.shopHasTryonProducts }));
vi.mock("../app-proxy.server", () => ({ verifyStorePreviewToken: () => false }));
vi.mock("../quiz-preview.server", () => ({ readTemplateContentFields: () => ({ heroImage: null, imageSlots: {} }) }));
vi.mock("../brand-profile.server", () => ({
  getBrandProfile: async () => null,
  servedTemplateFor: (template: string | null) => template,
}));
vi.mock("../quiz-templates", () => ({
  defaultEmailPlacement: () => null,
  isTemplateId: () => false,
  resolveQuizTokens: () => null,
}));
vi.mock("../template-live.server", () => ({ templateRenderable: () => true, templateServedLive: () => true }));
vi.mock("../shop-currency.server", () => ({ getShopCurrency: async () => "USD" }));
vi.mock("../quiz-offers.server", () => ({
  getQuizOffers: async () => ({}),
  publicOffersPayload: () => ({ crossSell: null, bundleDiscount: null }),
}));
vi.mock("../quiz-ui-text", () => ({ quizTextPayload: () => ({}), resultsCtaPayload: () => ({}) }));

import { loader } from "../../routes/api.storefront.quiz-config";
import { clearStorefrontCache } from "../storefront-cache.server";

const SHOP = { id: "1454909e-6995-4a5b-a49d-15a0d6c11349", shop_domain: "pqkzt0-gb.myshopify.com" };

const assistantConfig = (over: Record<string, unknown>) =>
  new Proxy(
    {
      enabled: true,
      assistant_mode: "both",
      assistant_name: "Laura",
      quiz_template: "t3",
      product_scope: "all_configured",
      selected_product_ids: [],
      quiz_multi_set_prompt: null,
      ...over,
    } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : "") },
  );

const fetchConfig = async () => {
  const res = (await loader({
    request: new Request(
      "https://glimpse-app-charles.onrender.com/api/storefront/quiz-config?shopDomain=pqkzt0-gb.myshopify.com&tpl=3",
    ),
    params: {},
    context: {},
  } as never)) as Response;
  expect(res.status).toBe(200);
  return res.json();
};

beforeEach(() => {
  clearStorefrontCache();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.findShopByDomain.mockResolvedValue(SHOP);
  m.shopHasValidAccess.mockResolvedValue(true);
});

describe("quiz-config tryonEnabled", () => {
  it("is false for a store with try-on on but no product set up for it (the App Review store)", async () => {
    m.getChatAssistantConfig.mockResolvedValue(assistantConfig({ quiz_tryon_enabled: true }));
    m.shopHasTryonProducts.mockResolvedValue(false);
    const body = await fetchConfig();
    expect(body.tryonEnabled).toBe(false);
    expect(m.shopHasTryonProducts).toHaveBeenCalledWith(SHOP.id, expect.objectContaining({ product_scope: "all_configured" }));
  });

  it("stays true when a product is set up (ORLY, Glamnetic and the rest: unchanged)", async () => {
    m.getChatAssistantConfig.mockResolvedValue(assistantConfig({ quiz_tryon_enabled: true }));
    m.shopHasTryonProducts.mockResolvedValue(true);
    expect((await fetchConfig()).tryonEnabled).toBe(true);
  });

  it("the merchant's off switch wins and skips the check", async () => {
    m.getChatAssistantConfig.mockResolvedValue(assistantConfig({ quiz_tryon_enabled: false }));
    expect((await fetchConfig()).tryonEnabled).toBe(false);
    expect(m.shopHasTryonProducts).not.toHaveBeenCalled();
  });

  it("a failed availability read keeps the merchant's toggle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getChatAssistantConfig.mockResolvedValue(assistantConfig({ quiz_tryon_enabled: true }));
    m.shopHasTryonProducts.mockRejectedValue(new Error("supabase down"));
    expect((await fetchConfig()).tryonEnabled).toBe(true);
  });
});
