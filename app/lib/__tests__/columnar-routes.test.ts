import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

// A columnar result on its two routes, with the engine stubbed:
//   - the Studio preview resolves images and prices for the Also matched
//     row too (the preview widget reads product data only from productJson)
//   - the storefront logs a finished quiz, not a results permalink reload

const db = vi.hoisted(() => ({
  findShopByDomain: vi.fn(),
  shopHasValidAccess: vi.fn(async () => true),
  getChatAssistantConfig: vi.fn(async () => ({ enabled: true })),
  trackAssistantEvent: vi.fn(async () => {}),
}));
const rows = vi.hoisted(() => ({ products: [] as Array<Record<string, unknown>> }));
vi.mock("../supabase.server", () => {
  function from(table: string) {
    let out = table === "products" ? [...rows.products] : [];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        out = out.filter((r) => r[c] === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        out = out.filter((r) => vs.includes(r[c]));
        return q;
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: out, error: null }),
    };
    return q;
  }
  return { ...db, supabase: { from } };
});
const engine = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock("../quiz-recommend.server", () => ({
  computeQuizRecommendations: (args: unknown) => engine.compute(args),
}));

import { action as previewAction } from "../../routes/quiz-preview-recommend";
import { action as storefrontAction } from "../../routes/api.storefront.quiz-recommend";

const SHOP = { id: "shop-glam", shop_domain: "glamrco.myshopify.com" };
const match = (i: number) => ({
  productId: `gid://shopify/Product/${i}`,
  variantId: null,
  variantNumericId: null,
  productHandle: `set-${i}`,
  productName: `Set ${i}`,
  variantTitle: null,
  title: `Set ${i}`,
  tagline: null,
  whyFits: null,
  rank: (i % 6) + 1,
  quantity: 1,
  reasons: ["Glossy short almond in the nudes you picked."],
  meta: { length: "Short", shape: "Almond", finish: "Glossy" },
});
const columnarResult = () => ({
  matches: [0, 1, 2, 3, 4, 5].map(match),
  matrixApplied: false,
  partial: false,
  columnar: {
    rung: 1,
    exactCount: 40,
    header: { kind: "normal", text: null },
    bestMatchBadge: true,
    alsoMatched: [6, 7, 8, 9, 10, 11].map(match),
    resultKey: "c1.x.2.1.1.1.1",
    loosen: null,
    answers: { length: ["short"] },
  },
});

beforeEach(() => {
  process.env.SHOPIFY_API_SECRET = "test-secret";
  db.findShopByDomain.mockResolvedValue(SHOP);
  db.trackAssistantEvent.mockClear();
  engine.compute.mockReset();
  engine.compute.mockResolvedValue(columnarResult());
  rows.products = Array.from({ length: 12 }, (_, i) => ({
    id: `row-${i}`,
    shop_id: SHOP.id,
    shopify_id: `gid://shopify/Product/${i}`,
    image_url: `https://cdn.example/set-${i}.jpg`,
    price: 18 + i,
  }));
});

describe("Studio preview (quiz-preview-recommend)", () => {
  it("returns product data for the six matches and the Also matched row", async () => {
    const token = jwt.sign({ shopId: SHOP.id, shopDomain: SHOP.shop_domain }, "test-secret", { algorithm: "HS256" });
    const res = await previewAction({
      request: new Request(`https://app.example/quiz-preview-recommend?token=${token}`, {
        method: "POST",
        body: JSON.stringify({ criteria: { length: ["short"] } }),
      }),
      params: {},
      context: {},
    } as never);
    const body = (await (res as Response).json()) as { productJson: Record<string, { featured_image: string; price: number }> };
    expect(Object.keys(body.productJson).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `set-${i}`).sort());
    expect(body.productJson["set-9"]).toMatchObject({ featured_image: "https://cdn.example/set-9.jpg", price: 2700 });
  });
});

describe("storefront quiz-recommend analytics", () => {
  const post = (body: Record<string, unknown>) =>
    storefrontAction({
      request: new Request("https://app.example/api/storefront/quiz-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.1.2.3" },
        body: JSON.stringify({ shopDomain: SHOP.shop_domain, ...body }),
      }),
      params: {},
      context: {},
    } as never) as Promise<Response>;

  it("a finished quiz logs the rung and the permalink key", async () => {
    const res = await post({ criteria: { length: ["short"] } });
    expect(res.status).toBe(200);
    expect(db.trackAssistantEvent).toHaveBeenCalledTimes(1);
    const props = (db.trackAssistantEvent.mock.calls[0] as unknown[])[5] as Record<string, unknown>;
    expect(props).toMatchObject({ criteria: { length: ["short"] }, rung: 1, rk: "c1.x.2.1.1.1.1", n: 6 });
  });

  it("a results permalink reload serves the result without logging another finished quiz", async () => {
    const res = await post({ resultKey: "c1.x.2.1.1.1.1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { matches: unknown[] }).matches).toHaveLength(6);
    expect(engine.compute).toHaveBeenCalledWith(expect.objectContaining({ resultKey: "c1.x.2.1.1.1.1" }));
    expect(db.trackAssistantEvent).not.toHaveBeenCalled();
  });
});
