import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findShopByDomain: vi.fn(),
  shopHasValidAccess: vi.fn(),
  getChatAssistantConfig: vi.fn(),
  getPhotoAxes: vi.fn(),
  trackAssistantEvent: vi.fn(),
  trackTransformationEvent: vi.fn(),
  classifyPhotoAxesForShopDetailed: vi.fn(),
  buildCandidatePool: vi.fn(),
  transformCandidateImage: vi.fn(),
}));

vi.mock("../supabase.server", () => ({
  findShopByDomain: mocks.findShopByDomain,
  shopHasValidAccess: mocks.shopHasValidAccess,
  getChatAssistantConfig: mocks.getChatAssistantConfig,
  getPhotoAxes: mocks.getPhotoAxes,
  trackAssistantEvent: mocks.trackAssistantEvent,
  trackTransformationEvent: mocks.trackTransformationEvent,
}));
vi.mock("../photo-axis-classifier.server", () => ({
  classifyPhotoAxesForShopDetailed: mocks.classifyPhotoAxesForShopDetailed,
}));
vi.mock("../recommendation-engine.server", () => ({ buildCandidatePool: mocks.buildCandidatePool }));
vi.mock("../tryon-transform.server", () => ({ transformCandidateImage: mocks.transformCandidateImage }));

import { rejectOversizedBody, CORS_HEADERS } from "../storefront-api.server";
import { RATE_LIMITS } from "../rate-limiter.server";
import { action as quizShade } from "../../routes/api.storefront.quiz-shade";
import { action as quizTryon } from "../../routes/api.storefront.quiz-tryon";
import { action as quizRecommend } from "../../routes/api.storefront.quiz-recommend";
import { action as trackEvent } from "../../routes/api.storefront.track-event";

const SHOP = { id: "shop-1", shop_domain: "demo.myshopify.com" };
const PRODUCT = "gid://shopify/Product/1";

let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq % 250}`;
const args = (request: Request) => ({ request, params: {}, context: {} }) as any;

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    body,
    headers: { "x-forwarded-for": nextIp(), ...headers },
  });
}

function photoForm(file: File, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("shopDomain", SHOP.shop_domain);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findShopByDomain.mockResolvedValue(SHOP);
  mocks.shopHasValidAccess.mockResolvedValue(true);
  mocks.getChatAssistantConfig.mockResolvedValue({ enabled: true, quiz_tryon_enabled: true });
  mocks.getPhotoAxes.mockResolvedValue([
    { key: "hair_shade", label: "Hair shade", values: [{ value: "honey", label: "Honey" }] },
  ]);
  mocks.classifyPhotoAxesForShopDetailed.mockResolvedValue({ values: {}, shadeNoMatch: false });
  mocks.buildCandidatePool.mockResolvedValue({
    pool: { candidates: [{ product: { shopify_id: PRODUCT }, variant: null }] },
  });
  mocks.transformCandidateImage.mockResolvedValue({ tryOnPreview: "abc", error: null });
  mocks.trackAssistantEvent.mockResolvedValue(null);
  mocks.trackTransformationEvent.mockResolvedValue(null);
});

describe("rejectOversizedBody", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://app.example/x", { method: "POST", body: "{}", headers });

  it("answers 413 with the route's CORS headers when the declared size is over budget", async () => {
    const res = rejectOversizedBody(req({ "content-length": "1025" }), 1024, CORS_HEADERS, "Image too large")!;
    expect(res.status).toBe(413);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Image too large" });
  });

  it("lets through bodies at or under budget", () => {
    expect(rejectOversizedBody(req({ "content-length": "1024" }), 1024)).toBeNull();
    expect(rejectOversizedBody(req({ "content-length": "2" }), 1024)).toBeNull();
  });

  it("lets through a missing or unreadable Content-Length exactly as before", () => {
    expect(rejectOversizedBody(req({}), 1)).toBeNull();
    expect(rejectOversizedBody(req({ "content-length": "abc" }), 1)).toBeNull();
  });
});

describe("photo routes", () => {
  it("quiz-shade refuses a declared 20MB body before reading it", async () => {
    const res = await quizShade(
      args(post("/api/storefront/quiz-shade", "x", { "content-length": String(20 * 1024 * 1024) })),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Image too large" });
    expect(mocks.findShopByDomain).not.toHaveBeenCalled();
  });

  it("quiz-shade refuses an upload that says it is not an image", async () => {
    const file = new File(["a long document ".repeat(100)], "notes.txt", { type: "text/plain" });
    const res = await quizShade(args(post("/api/storefront/quiz-shade", photoForm(file))));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please upload an image file (JPG, PNG, HEIC)." });
    expect(mocks.classifyPhotoAxesForShopDetailed).not.toHaveBeenCalled();
  });

  it("quiz-shade still classifies a typed photo", async () => {
    const file = new File([jpegBytes], "selfie.jpg", { type: "image/jpeg" });
    const res = await quizShade(args(post("/api/storefront/quiz-shade", photoForm(file))));
    expect(res.status).toBe(200);
    expect(mocks.classifyPhotoAxesForShopDetailed).toHaveBeenCalledTimes(1);
    expect(mocks.classifyPhotoAxesForShopDetailed.mock.calls[0][2]).toBe("image/jpeg");
  });

  it("quiz-shade still classifies an untyped photo with no extension (as the quiz allows)", async () => {
    const file = new File([jpegBytes], "IMG_0001", { type: "" });
    const res = await quizShade(args(post("/api/storefront/quiz-shade", photoForm(file))));
    expect(res.status).toBe(200);
    expect(mocks.classifyPhotoAxesForShopDetailed).toHaveBeenCalledTimes(1);
  });

  it("quiz-tryon refuses a declared 20MB body before reading it", async () => {
    const res = await quizTryon(
      args(post("/api/storefront/quiz-tryon", "x", { "content-length": String(20 * 1024 * 1024) })),
    );
    expect(res.status).toBe(413);
    expect(mocks.findShopByDomain).not.toHaveBeenCalled();
  });

  it("quiz-tryon refuses an upload that says it is not an image", async () => {
    const file = new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" });
    const res = await quizTryon(args(post("/api/storefront/quiz-tryon", photoForm(file, { productId: PRODUCT }))));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please upload an image file (JPG, PNG, HEIC)." });
    expect(mocks.transformCandidateImage).not.toHaveBeenCalled();
  });

  it("quiz-tryon still renders typed and untyped photos", async () => {
    for (const file of [
      new File([jpegBytes], "selfie.jpg", { type: "image/jpeg" }),
      new File([jpegBytes], "IMG_0002", { type: "" }),
    ]) {
      const res = await quizTryon(args(post("/api/storefront/quiz-tryon", photoForm(file, { productId: PRODUCT }))));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tryOnPreview: "abc", error: null });
    }
    expect(mocks.transformCandidateImage).toHaveBeenCalledTimes(2);
  });
});

describe("JSON routes", () => {
  it("quiz-recommend refuses a declared oversized body, keeps serving normal ones", async () => {
    const big = await quizRecommend(
      args(post("/api/storefront/quiz-recommend", "{}", { "content-length": String(1024 * 1024) })),
    );
    expect(big.status).toBe(413);
    expect(big.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const bad = await quizRecommend(args(post("/api/storefront/quiz-recommend", "{")));
    expect(bad.status).toBe(400); // reached the parser: no Content-Length passes as before
  });
});

describe("track-event", () => {
  const event = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    trackEvent(
      args(
        post(
          "/api/storefront/track-event",
          JSON.stringify({ shopDomain: SHOP.shop_domain, eventType: "quiz_start", ...body }),
          { "content-type": "application/json", ...headers },
        ),
      ),
    );

  it("stores the widget types the widgets send", async () => {
    for (const widgetType of ["quiz", "chat", "embedded", "horizontal", "legacy", "embed"]) {
      await event({ widgetType });
    }
    expect(mocks.trackAssistantEvent.mock.calls.map((c) => c[2])).toEqual([
      "quiz", "chat", "embedded", "horizontal", "legacy", "embed",
    ]);
  });

  it("drops a widgetType that isn't a short id, falling back to the default", async () => {
    await event({ widgetType: "x".repeat(5000) });
    await event({ widgetType: "<script>" });
    await event({ widgetType: 42 });
    await event({ eventType: "widget_view", productId: "1", widgetType: "Banner Widget" });
    expect(mocks.trackAssistantEvent.mock.calls.map((c) => c[2])).toEqual(["chat", "chat", "chat"]);
    expect(mocks.trackTransformationEvent.mock.calls[0][3]).toBe("unknown");
  });

  it("refuses a declared oversized body", async () => {
    const res = await event({}, { "content-length": String(1024 * 1024) });
    expect(res.status).toBe(413);
    expect(mocks.trackAssistantEvent).not.toHaveBeenCalled();
  });

});
