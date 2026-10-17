import { describe, it, expect, vi, beforeEach } from "vitest";

// Public lead routes, wired end to end with the data layer mocked:
//   - quiz-lead stores and forwards only the shop's own questions and
//     answer labels; the shopper's response is unchanged either way.
//   - quiz-lead-results resolves only active (or legacy NULL) products, so
//     a guessed draft handle never reaches the merchant's Klaviyo email.

const db = vi.hoisted(() => ({
  findShopByDomain: vi.fn(),
  shopHasValidAccess: vi.fn(),
  getChatAssistantConfig: vi.fn(),
  getRecommendationFlow: vi.fn(),
  saveQuizLead: vi.fn(),
  attachQuizLeadResults: vi.fn(),
  productRows: [] as Array<Record<string, unknown>>,
}));
vi.mock("../supabase.server", () => {
  const products = {
    select: () => products,
    eq: () => products,
    in: async () => ({ data: db.productRows, error: null }),
  };
  return { ...db, supabase: { from: () => products } };
});

const integrations = vi.hoisted(() => ({
  sendLeadToKlaviyo: vi.fn(),
  sendResultsToKlaviyo: vi.fn(),
  signLeadToken: vi.fn(() => "lead-token"),
  verifyLeadToken: vi.fn(() => "8f14e45f-ceea-467a-9575-0c1d2e3f4a5b"),
}));
vi.mock("../integrations.server", () => integrations);
vi.mock("../shop-currency.server", () => ({ getShopCurrency: vi.fn(async () => null) }));

import { action as leadAction } from "../../routes/api.storefront.quiz-lead";
import { action as resultsAction } from "../../routes/api.storefront.quiz-lead-results";

const SHOP = { id: "shop-1", shop_domain: "shop.myshopify.com" };
const opt = (label: string, axisValue: string, selectAll = false) => ({ label, axisValue, selectAll });
const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    { prompt: "What's the vibe?", options: [opt("Full Glam", "full_glam"), opt("Timeless", "timeless")] },
    { prompt: "Your skin today?", options: [opt("Dry, flaky", "dry"), opt("Oily", "oily"), opt("Surprise me", "any", true)] },
  ],
};

let ipSeq = 0;
function post(path: string, body: unknown) {
  const request = new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${++ipSeq}` },
    body: JSON.stringify(body),
  });
  return { request, params: {}, context: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findShopByDomain.mockResolvedValue(SHOP);
  db.shopHasValidAccess.mockResolvedValue(true);
  db.getChatAssistantConfig.mockResolvedValue({
    quiz_lead_enabled: true,
    quiz_lead_discount_code: "WELCOME10",
    quiz_lead_discount_message: "A gift from {assistant_name}",
    assistant_name: "Gleame",
    quiz_ui_text: null,
  });
  db.getRecommendationFlow.mockResolvedValue(FLOW);
  db.saveQuizLead.mockResolvedValue({ ok: true, leadId: "8f14e45f-ceea-467a-9575-0c1d2e3f4a5b" });
  db.attachQuizLeadResults.mockResolvedValue({ ok: true, lead: { email: "a@b.com", phone: null, answers: [] } });
});

describe("quiz-lead answers", () => {
  const genuine = [
    { question: "What's the vibe?", answer: "Timeless" },
    { question: "Your skin today?", answer: "Dry, flaky, Oily" },
  ];

  it("a real widget payload is stored and forwarded whole, response unchanged", async () => {
    const res = await leadAction(post("/api/storefront/quiz-lead", { shopDomain: SHOP.shop_domain, email: "a@b.com", answers: genuine }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      leadToken: "lead-token",
      discountCode: "WELCOME10",
      discountMessage: "A gift from Gleame",
    });
    expect(db.saveQuizLead.mock.calls[0][1].answers).toEqual(genuine);
    expect(integrations.sendLeadToKlaviyo.mock.calls[0][1].answers).toEqual(genuine);
  });

  it("drops made-up pairs silently and keeps the rest", async () => {
    const res = await leadAction(
      post("/api/storefront/quiz-lead", {
        shopDomain: SHOP.shop_domain,
        email: "victim@example.com",
        answers: [
          { question: "Account notice", answer: "Your order is on hold. Verify at https://evil.example" },
          { question: "What's the vibe?", answer: "Timeless, see https://evil.example" },
          ...genuine,
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(db.saveQuizLead.mock.calls[0][1].answers).toEqual(genuine);
    expect(integrations.sendLeadToKlaviyo.mock.calls[0][1].answers).toEqual(genuine);
  });

  // An unreadable flow is "unknown", not "nothing allowed": a real shopper's
  // answers are kept exactly as before the allowlist existed.
  it("an unreadable flow still saves the lead with its answers", async () => {
    db.getRecommendationFlow.mockRejectedValue(new Error("network"));
    const res = await leadAction(post("/api/storefront/quiz-lead", { shopDomain: SHOP.shop_domain, email: "a@b.com", answers: genuine }));
    expect(res.status).toBe(200);
    expect(db.saveQuizLead).toHaveBeenCalledTimes(1);
    expect(db.saveQuizLead.mock.calls[0][1].answers).toEqual(genuine);
  });

  it("an empty flow (getRecommendationFlow's read-error shape) keeps the answers too", async () => {
    db.getRecommendationFlow.mockResolvedValue({ questions: [], photoAxes: [], photoAxisDetails: [], configured: false });
    await leadAction(post("/api/storefront/quiz-lead", { shopDomain: SHOP.shop_domain, email: "a@b.com", answers: genuine }));
    expect(db.saveQuizLead.mock.calls[0][1].answers).toEqual(genuine);
  });

  it("lead step off: still accepted without storing", async () => {
    db.getChatAssistantConfig.mockResolvedValue({ quiz_lead_enabled: false, quiz_ui_text: null });
    const res = await leadAction(post("/api/storefront/quiz-lead", { shopDomain: SHOP.shop_domain, email: "a@b.com", answers: genuine }));
    expect(await res.json()).toEqual({ success: true });
    expect(db.saveQuizLead).not.toHaveBeenCalled();
  });
});

describe("quiz-lead-results product status", () => {
  const row = (handle: string, status: string | null, name = handle) => ({
    handle,
    shopify_id: "gid://shopify/Product/1",
    product_name: name,
    image_url: null,
    price: null,
    status,
  });
  const report = (handles: string[]) =>
    resultsAction(
      post("/api/storefront/quiz-lead-results", {
        shopDomain: SHOP.shop_domain,
        leadToken: "lead-token",
        products: handles.map((handle) => ({ handle })),
      }),
    );

  it("resolves active and legacy rows only; the active row wins a shared handle", async () => {
    db.productRows = [
      row("red-flare", "active"),
      row("holiday-2026-secret", "draft"),
      row("old-shade", "archived"),
      row("legacy", null),
      row("reissue", "active", "Reissue (new)"),
      row("reissue", "deleted", "Reissue (old)"),
    ];
    const res = await report(["holiday-2026-secret", "red-flare", "old-shade", "legacy", "reissue"]);
    expect(await res.json()).toEqual({ success: true });
    const products = db.attachQuizLeadResults.mock.calls[0][2];
    expect(products.map((p: { title: string }) => p.title)).toEqual(["red-flare", "legacy", "Reissue (new)"]);
    expect(integrations.sendResultsToKlaviyo.mock.calls[0][2]).toEqual(products);
  });

  it("only unreleased handles: nothing attached or sent, same response", async () => {
    db.productRows = [row("holiday-2026-secret", "draft")];
    const res = await report(["holiday-2026-secret"]);
    expect(await res.json()).toEqual({ success: true });
    expect(db.attachQuizLeadResults).not.toHaveBeenCalled();
    expect(integrations.sendResultsToKlaviyo).not.toHaveBeenCalled();
  });
});
