import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Quiz bundles (2026-10-20, after Shopify App Review hit failing bundle
// adds): the Add all button, Bundle & save and its discount are served only
// to the allowlisted stores (lib/bundles.server). Every other store's
// storefront config says bundles are off, whatever the merchant set.

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
  // A live 15% bundle discount whenever the bundle is on.
  publicOffersPayload: (_offers: unknown, opts: { bundleEnabled: boolean }) => ({
    crossSell: null,
    bundleDiscount: opts.bundleEnabled ? { type: "percentage", value: 15, minQty: 2, note: null } : null,
  }),
}));
vi.mock("../quiz-ui-text", () => ({ quizTextPayload: () => ({}), resultsCtaPayload: () => ({}) }));

import { loader } from "../../routes/api.storefront.quiz-config";
import { clearStorefrontCache } from "../storefront-cache.server";
import { bundlesAllowed } from "../bundles.server";

const assistantConfig = (over: Record<string, unknown>) =>
  new Proxy(
    {
      enabled: true,
      assistant_mode: "quiz",
      assistant_name: "Laura",
      quiz_template: "t3",
      quiz_tryon_enabled: false,
      quiz_bundle_enabled: true,
      product_scope: "all_configured",
      selected_product_ids: [],
      quiz_multi_set_prompt: null,
      ...over,
    } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : "") },
  );

const fetchConfig = async (shopDomain: string) => {
  m.findShopByDomain.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", shop_domain: shopDomain });
  const res = (await loader({
    request: new Request(`https://glimpse-app-charles.onrender.com/api/storefront/quiz-config?shopDomain=${shopDomain}&tpl=3`),
    params: {},
    context: {},
  } as never)) as Response;
  expect(res.status).toBe(200);
  return res.json();
};

const savedEnv = process.env.BUNDLE_SHOPS;
beforeEach(() => {
  clearStorefrontCache();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  delete process.env.BUNDLE_SHOPS;
  m.shopHasValidAccess.mockResolvedValue(true);
  m.getChatAssistantConfig.mockResolvedValue(assistantConfig({}));
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.BUNDLE_SHOPS;
  else process.env.BUNDLE_SHOPS = savedEnv;
});

describe("bundles only for the allowlisted stores", () => {
  it("Glamnetic keeps its bundle and the bundle discount", async () => {
    const body = await fetchConfig("glamrco.myshopify.com");
    expect(body.results.bundleEnabled).toBe(true);
    expect(body.results.bundleDiscount).toEqual({ type: "percentage", value: 15, minQty: 2, note: null });
  });

  it("any other store gets no bundle and no discount, even with both switched on", async () => {
    const body = await fetchConfig("pqkzt0-gb.myshopify.com");
    expect(body.results.bundleEnabled).toBe(false);
    expect(body.results.bundleDiscount).toBeNull();
  });

  it("BUNDLE_SHOPS replaces the list", () => {
    process.env.BUNDLE_SHOPS = "orlybeauty.myshopify.com, Locks-Mane.myshopify.com";
    expect(bundlesAllowed("orlybeauty.myshopify.com")).toBe(true);
    expect(bundlesAllowed("locks-mane.myshopify.com")).toBe(true);
    expect(bundlesAllowed("glamrco.myshopify.com")).toBe(false);
    delete process.env.BUNDLE_SHOPS;
    expect(bundlesAllowed("glamrco.myshopify.com")).toBe(true);
    expect(bundlesAllowed(null)).toBe(false);
  });
});
