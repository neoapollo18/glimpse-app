import { describe, it, expect, beforeEach, vi } from "vitest";

// The two cached storefront config routes, end to end through the real
// storefront cache. Server modules are mocked: one shop,
// brand.myshopify.com, also reachable through its custom domain
// www.brand.com (alternate_domains). Lookups are exact, like PostgREST.
const db = vi.hoisted(() => ({
  findShopByDomain: vi.fn(),
  shopHasValidAccess: vi.fn(),
  getChatAssistantConfig: vi.fn(),
  getRecommendationFlow: vi.fn(),
  verifyStorePreviewToken: vi.fn(),
}));

vi.mock("../supabase.server", () => ({
  findShopByDomain: db.findShopByDomain,
  shopHasValidAccess: db.shopHasValidAccess,
  getChatAssistantConfig: db.getChatAssistantConfig,
  getRecommendationFlow: db.getRecommendationFlow,
}));
vi.mock("../app-proxy.server", () => ({ verifyStorePreviewToken: db.verifyStorePreviewToken }));
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
// Template t1 is assigned but unpublished: only a verified store preview
// renders it.
vi.mock("../template-live.server", () => ({
  templateRenderable: () => true,
  templateServedLive: () => false,
}));
vi.mock("../shop-currency.server", () => ({ getShopCurrency: async () => "USD" }));
vi.mock("../quiz-offers.server", () => ({
  getQuizOffers: async () => ({}),
  publicOffersPayload: () => ({ crossSell: null, bundleDiscount: null }),
}));
vi.mock("../quiz-ui-text", () => ({ quizTextPayload: () => ({}), resultsCtaPayload: () => ({}) }));

import { loader as quizConfigLoader } from "../../routes/api.storefront.quiz-config";
import { loader as flowLoader } from "../../routes/api.storefront.recommendation-config";
import { clearStorefrontCache, invalidateStorefrontCache } from "../storefront-cache.server";

const SHOP = { id: "shop-1", shop_domain: "brand.myshopify.com" };

// Every string field reads as "" so the payload builder has copy to render.
const assistantConfig = () =>
  new Proxy(
    { enabled: true, assistant_mode: "quiz", assistant_name: "Gleame", quiz_template: "t1" } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : "") },
  );

const API = "https://glimpse-app-charles.onrender.com/api/storefront";
const call = (loader: typeof quizConfigLoader, path: string) =>
  loader({ request: new Request(`${API}/${path}`), params: {}, context: {} } as never) as Promise<Response>;
const quizConfig = (query: string) => call(quizConfigLoader, `quiz-config?${query}`);
const flow = (query: string) => call(flowLoader, `recommendation-config?${query}`);

beforeEach(() => {
  clearStorefrontCache();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  db.findShopByDomain.mockImplementation(async (domain: string) =>
    domain === "brand.myshopify.com" || domain === "www.brand.com" ? SHOP : null,
  );
  db.shopHasValidAccess.mockResolvedValue(true);
  db.getChatAssistantConfig.mockImplementation(async () => assistantConfig());
  db.getRecommendationFlow.mockResolvedValue({ questions: [{ axisKey: "vibe" }], configured: true });
  db.verifyStorePreviewToken.mockImplementation(
    (token: string, shop: string, id: string) =>
      token === "signed" && shop === "brand.myshopify.com" && id === "draft-1",
  );
});

describe("quiz-config cache", () => {
  it("a case variant of the domain can't blank the real storefront's quiz", async () => {
    expect((await quizConfig("shopDomain=BRAND.MYSHOPIFY.COM&tpl=3")).status).toBe(403);
    const res = await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
  });

  it("doesn't cache a 403", async () => {
    db.findShopByDomain.mockResolvedValueOnce(null);
    expect((await quizConfig("shopDomain=brand.myshopify.com&tpl=3")).status).toBe(403);
    expect((await quizConfig("shopDomain=brand.myshopify.com&tpl=3")).status).toBe(200);
  });

  it("drops a failed assistant config read instead of caching the 'quiz off' defaults", async () => {
    db.getChatAssistantConfig.mockRejectedValueOnce(new Error("supabase down"));
    await expect(quizConfig("shopDomain=brand.myshopify.com&tpl=3")).rejects.toThrow("supabase down");
    expect(db.getChatAssistantConfig).toHaveBeenCalledWith("brand.myshopify.com", { throwOnError: true });
    const res = await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    expect((await res.json()).enabled).toBe(true);
  });

  it("keys on the template protocol, not the raw tpl value", async () => {
    await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    await quizConfig("shopDomain=brand.myshopify.com");
    await quizConfig("shopDomain=brand.myshopify.com&tpl=2");
    await quizConfig("shopDomain=brand.myshopify.com&tpl=x1");
    expect(db.getChatAssistantConfig).toHaveBeenCalledTimes(2);
  });

  it("an unverified preview token gets the cached public payload", async () => {
    await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    const res = await quizConfig("shopDomain=brand.myshopify.com&tpl=3&previewToken=forged&previewId=draft-1");
    expect(db.getChatAssistantConfig).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect((await res.json()).template).toBeNull();
  });

  it("a verified store preview skips the cache and is never stored", async () => {
    const preview = "shopDomain=brand.myshopify.com&tpl=3&previewToken=signed&previewId=draft-1";
    const res = await quizConfig(preview);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).template).toBe("t1");
    await quizConfig(preview);
    expect(db.getChatAssistantConfig).toHaveBeenCalledTimes(2);

    const pub = await quizConfig("shopDomain=brand.myshopify.com&tpl=3");
    expect((await pub.json()).template).toBeNull();
  });

  it("a token sent under another domain never puts a preview in the shared cache", async () => {
    // Valid for brand.myshopify.com, but claimed as www.brand.com: it isn't
    // verified for the claimed domain, so it takes the cached public path.
    const res = await quizConfig("shopDomain=www.brand.com&tpl=3&previewToken=signed&previewId=draft-1");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect((await res.json()).template).toBeNull();
    const pub = await quizConfig("shopDomain=www.brand.com&tpl=3");
    expect((await pub.json()).template).toBeNull();
  });

  it("invalidating the shop drops the entry keyed by its custom domain", async () => {
    await quizConfig("shopDomain=www.brand.com&tpl=3");
    invalidateStorefrontCache("brand.myshopify.com");
    await quizConfig("shopDomain=www.brand.com&tpl=3");
    expect(db.getChatAssistantConfig).toHaveBeenCalledTimes(2);
  });
});

describe("recommendation-config cache", () => {
  it("a case variant of the domain can't blank the real storefront's flow", async () => {
    expect((await flow("shopDomain=Brand.myshopify.com")).status).toBe(403);
    const res = await flow("shopDomain=brand.myshopify.com");
    expect(res.status).toBe(200);
    expect((await res.json()).configured).toBe(true);
  });

  it("caches a configured flow", async () => {
    await flow("shopDomain=brand.myshopify.com");
    await flow("shopDomain=brand.myshopify.com");
    expect(db.getRecommendationFlow).toHaveBeenCalledTimes(1);
  });

  it("doesn't cache a 403 or an unconfigured flow (what a failed read returns)", async () => {
    db.findShopByDomain.mockResolvedValueOnce(null);
    expect((await flow("shopDomain=brand.myshopify.com")).status).toBe(403);
    db.getRecommendationFlow.mockResolvedValueOnce({ questions: [], configured: false });
    expect((await (await flow("shopDomain=brand.myshopify.com")).json()).configured).toBe(false);
    expect((await (await flow("shopDomain=brand.myshopify.com")).json()).configured).toBe(true);
  });

  it("invalidating the shop drops the entry keyed by its custom domain", async () => {
    await flow("shopDomain=www.brand.com");
    invalidateStorefrontCache("brand.myshopify.com");
    await flow("shopDomain=www.brand.com");
    expect(db.getRecommendationFlow).toHaveBeenCalledTimes(2);
  });
});
