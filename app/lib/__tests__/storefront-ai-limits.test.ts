import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Storefront per-shop windows: daily ceilings on paid AI routes, and every
// per-shop key on the VERIFIED canonical domain (never the claimed one).
// Supabase and the AI layers are stubbed so each allowed request stops
// right after the limiter at a cheap, recognizable response.

const SHOP = { id: "shop-1", shop_domain: "glow.myshopify.com" };
const ALIASES = new Set(["glow.myshopify.com", "www.glowbeauty.com", "glowbeauty.com"]);

vi.mock("../supabase.server", () => ({
  findShopByDomain: async (d: string) => (ALIASES.has(d) ? SHOP : null),
  shopHasValidAccess: async () => true,
  // Off switches: try-on stops at "Assistant not enabled", leads at an
  // opaque success, both after the rate limits.
  getChatAssistantConfig: async () => ({ enabled: false, quiz_lead_enabled: false }),
  saveQuizLead: async () => ({ ok: true }),
  saveSkinAnalysisPhoto: async () => null,
  getRecommendationFlow: async () => ({ questions: [], photoAxes: [], photoAxisDetails: [], configured: true }),
}));
vi.mock("../recommendation-engine.server", () => ({ buildCandidatePool: async () => ({ pool: null }) }));
vi.mock("../tryon-transform.server", () => ({ transformCandidateImage: async () => null }));
vi.mock("../integrations.server", () => ({ sendLeadToKlaviyo: async () => {}, signLeadToken: () => null }));
vi.mock("../skin-analysis.server", () => ({
  analyzeSkin: async () => null,
  pickRecommendations: () => [],
  isSkinAnalysisEnabledByShopId: async () => true,
  getSkinAnalysisConfigByShopId: async () => ({}),
  fetchProductCards: async () => [],
  projectSkin: async () => null,
  DEFAULT_PROJECTION_WITHOUT_TREATMENT_PROMPT: "",
  DEFAULT_PROJECTION_WITH_TREATMENT_PROMPT: "",
}));
vi.mock("../photo-axis-classifier.server", () => ({ classifyPhotoAxesForShopDetailed: async () => ({ values: {} }) }));
vi.mock("../shade-board-config.server", () => ({ shadeBoardConfigForShop: () => null }));

import { action as tryonAction } from "../../routes/api.storefront.quiz-tryon";
import { action as shadeAction } from "../../routes/api.storefront.quiz-shade";
import { action as leadAction } from "../../routes/api.storefront.quiz-lead";
import { action as analyzeSkinAction } from "../../routes/api.storefront.analyze-skin";
import { action as projectSkinAction } from "../../routes/api.storefront.project-skin";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-16T00:00:00Z");
let ipSeq = 0;
// A fresh client IP per request keeps the per-IP windows out of the way.
const nextIP = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;

const run = (action: (args: any) => Promise<Response>, request: Request) =>
  action({ request, params: {}, context: {} });

function tryonRequest() {
  const fd = new FormData();
  fd.append("image", new File([new Uint8Array([1, 2, 3])], "me.jpg", { type: "image/jpeg" }));
  fd.append("shopDomain", "glow.myshopify.com");
  fd.append("productId", "gid://shopify/Product/1");
  return new Request("https://app.test/api/storefront/quiz-tryon", {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": nextIP() },
  });
}

function shadeRequest() {
  const fd = new FormData();
  fd.append("image", new File([new Uint8Array([1, 2, 3])], "me.jpg", { type: "image/jpeg" }));
  // An alias: the shop windows must still land on the canonical domain.
  fd.append("shopDomain", "www.glowbeauty.com");
  return new Request("https://app.test/api/storefront/quiz-shade", {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": nextIP() },
  });
}

function leadRequest(shopDomain: string) {
  return new Request("https://app.test/api/storefront/quiz-lead", {
    method: "POST",
    body: JSON.stringify({ shopDomain, email: "shopper@example.com" }),
    headers: { "content-type": "application/json", "x-forwarded-for": nextIP() },
  });
}

function skinRequest(route: "analyze-skin" | "project-skin") {
  const fd = new FormData();
  // Not an image: an allowed request stops at the image check (400).
  fd.append("image", new File(["hello"], "note.txt", { type: "text/plain" }));
  fd.append("shopDomain", "glow.myshopify.com");
  return new Request(`https://app.test/api/storefront/${route}`, {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": nextIP() },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("quiz-tryon", () => {
  it("keeps the hourly cap and adds a 10000/day ceiling", async () => {
    // Hour 0: the existing 1000/hour cap, same 429 message as before.
    for (let i = 0; i < 1000; i++) expect((await run(tryonAction, tryonRequest())).status).toBe(403);
    const hourBlocked = await run(tryonAction, tryonRequest());
    expect(hourBlocked.status).toBe(429);
    expect(await hourBlocked.json()).toEqual({ error: "Too many requests. Please wait a moment." });

    // Nine more full hours reach the daily ceiling; the next hour is refused
    // even though its own window is fresh.
    for (let hour = 1; hour < 10; hour++) {
      vi.setSystemTime(new Date(T0 + hour * (HOUR + 1000)));
      for (let i = 0; i < 1000; i++) expect((await run(tryonAction, tryonRequest())).status).toBe(403);
    }
    vi.setSystemTime(new Date(T0 + 10 * (HOUR + 1000)));
    const dayBlocked = await run(tryonAction, tryonRequest());
    expect(dayBlocked.status).toBe(429);
    expect(await dayBlocked.json()).toEqual({ error: "Too many requests. Please wait a moment." });
  }, 60_000);
});

describe("quiz-shade", () => {
  it("keeps the 600/hour cap and adds a 2000/day ceiling, on the canonical domain", async () => {
    for (let i = 0; i < 600; i++) expect((await run(shadeAction, shadeRequest())).status).toBe(403);
    const hourBlocked = await run(shadeAction, shadeRequest());
    expect(hourBlocked.status).toBe(429);
    expect(await hourBlocked.json()).toEqual({ error: "Too many requests. Please wait a moment." });

    // Two more full hours plus 200 reach 2000 for the day.
    for (let hour = 1; hour <= 3; hour++) {
      vi.setSystemTime(new Date(T0 + hour * (HOUR + 1000)));
      const n = hour < 3 ? 600 : 200;
      for (let i = 0; i < n; i++) expect((await run(shadeAction, shadeRequest())).status).toBe(403);
    }
    const dayBlocked = await run(shadeAction, shadeRequest());
    expect(dayBlocked.status).toBe(429);
    expect(await dayBlocked.json()).toEqual({ error: "Too many requests. Please wait a moment." });
  }, 60_000);
});

describe("skin analysis", () => {
  it("analyze-skin keeps 200/hour and adds 2000/day, both with the existing message", async () => {
    const message = "This store has reached its hourly limit. Please try again later.";
    for (let i = 0; i < 200; i++) expect((await run(analyzeSkinAction, skinRequest("analyze-skin"))).status).toBe(400);
    const hourBlocked = await run(analyzeSkinAction, skinRequest("analyze-skin"));
    expect(hourBlocked.status).toBe(429);
    expect((await hourBlocked.json()).error).toBe(message);

    for (let hour = 1; hour < 10; hour++) {
      vi.setSystemTime(new Date(T0 + hour * (HOUR + 1000)));
      for (let i = 0; i < 200; i++) expect((await run(analyzeSkinAction, skinRequest("analyze-skin"))).status).toBe(400);
    }
    vi.setSystemTime(new Date(T0 + 10 * (HOUR + 1000)));
    const dayBlocked = await run(analyzeSkinAction, skinRequest("analyze-skin"));
    expect(dayBlocked.status).toBe(429);
    expect((await dayBlocked.json()).error).toBe(message);
  }, 60_000);

  it("project-skin keeps 100/hour and adds 1000/day, both with the existing message", async () => {
    const message = "This store has reached its hourly limit. Please try again later.";
    for (let i = 0; i < 100; i++) expect((await run(projectSkinAction, skinRequest("project-skin"))).status).toBe(400);
    const hourBlocked = await run(projectSkinAction, skinRequest("project-skin"));
    expect(hourBlocked.status).toBe(429);
    expect((await hourBlocked.json()).error).toBe(message);

    for (let hour = 1; hour < 10; hour++) {
      vi.setSystemTime(new Date(T0 + hour * (HOUR + 1000)));
      for (let i = 0; i < 100; i++) expect((await run(projectSkinAction, skinRequest("project-skin"))).status).toBe(400);
    }
    vi.setSystemTime(new Date(T0 + 10 * (HOUR + 1000)));
    const dayBlocked = await run(projectSkinAction, skinRequest("project-skin"));
    expect(dayBlocked.status).toBe(429);
    expect((await dayBlocked.json()).error).toBe(message);
  }, 60_000);
});

describe("quiz-lead", () => {
  it("counts every alias of a shop against one canonical hourly bucket", async () => {
    const claims = ["glow.myshopify.com", "www.glowbeauty.com", "glowbeauty.com"];
    for (let i = 0; i < 500; i++) {
      const res = await run(leadAction, leadRequest(claims[i % claims.length]));
      expect(res.status).toBe(200);
    }
    // Before: each alias had its own 500/hour bucket.
    const res = await run(leadAction, leadRequest("www.glowbeauty.com"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests — please try again shortly." });
  });

  it("still answers an unknown shop with 403 and keeps the per-IP cap", async () => {
    expect((await run(leadAction, leadRequest("nope.myshopify.com"))).status).toBe(403);
    const ip = "203.0.113.9";
    const fromOneIP = () =>
      new Request("https://app.test/api/storefront/quiz-lead", {
        method: "POST",
        body: JSON.stringify({ shopDomain: "nope.myshopify.com", email: "a@example.com" }),
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
      });
    for (let i = 0; i < 5; i++) expect((await run(leadAction, fromOneIP())).status).toBe(403);
    expect((await run(leadAction, fromOneIP())).status).toBe(429);
  });
});
