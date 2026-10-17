import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Admin AI resource routes (products page test transform, category
// suggestion): billing gate, per-shop caps and input bounds. Auth, Gemini
// and Supabase are stubbed; the in-memory rate limiter is real.

let currentShop = "shop-a.myshopify.com";

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ session: { shop: currentShop, accessToken: "shpat_test" } })),
  },
}));

const transformImage = vi.fn(async (_req: { transformationPrompt: string }) => ({
  success: true,
  generatedImage: "aW1n",
}));
vi.mock("../ai.server", () => ({ transformImage: (req: any) => transformImage(req) }));

vi.mock("../supabase.server", () => ({ trackTransformationEvent: async () => {} }));

const shopNeedsBilling = vi.fn(async () => false);
vi.mock("../billing-gate.server", () => ({ shopNeedsBilling: () => shopNeedsBilling() }));

const classifyProduct = vi.fn(async (..._args: unknown[]) => null);
vi.mock("../category-classifier.server", () => ({
  classifyProduct: (...args: unknown[]) => classifyProduct(...args),
}));

import { action as transformAction } from "../../routes/api.transform-image";
import { action as classifyAction } from "../../routes/api.classify-product";

const HOUR = 60 * 60 * 1000;

function transformRequest(prompt: string) {
  const fd = new FormData();
  fd.append("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "face.jpg", { type: "image/jpeg" }));
  fd.append("transformationPrompt", prompt);
  return new Request("https://app.test/api/transform-image", { method: "POST", body: fd });
}

function classifyRequest(name: string, type = "") {
  const fd = new FormData();
  fd.append("productName", name);
  fd.append("productType", type);
  return new Request("https://app.test/api/classify-product", { method: "POST", body: fd });
}

const runTransform = (prompt: string) =>
  transformAction({ request: transformRequest(prompt), params: {}, context: {} } as any);
const runClassify = (name: string, type?: string) =>
  classifyAction({ request: classifyRequest(name, type), params: {}, context: {} } as any);

beforeEach(() => {
  transformImage.mockClear();
  classifyProduct.mockClear();
  shopNeedsBilling.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/transform-image (admin test transform)", () => {
  it("passes a real-length product prompt through unchanged", async () => {
    currentShop = "prompt-ok.myshopify.com";
    const prompt = "Apply a soft matte rose lip. ".repeat(200); // ~5.8k chars
    const res = await runTransform(prompt);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, generatedImage: "aW1n" });
    expect(transformImage).toHaveBeenCalledTimes(1);
    expect(transformImage.mock.calls[0][0].transformationPrompt).toBe(prompt);
  });

  it("rejects a prompt over 20000 chars before any Gemini call", async () => {
    currentShop = "prompt-long.myshopify.com";
    expect((await runTransform("x".repeat(20_000))).status).toBe(200);
    const res = await runTransform("x".repeat(20_001));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Transformation prompt is too long." });
    expect(transformImage).toHaveBeenCalledTimes(1);
  });

  it("treats a file part named transformationPrompt as a missing prompt", async () => {
    currentShop = "prompt-file.myshopify.com";
    const fd = new FormData();
    fd.append("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "face.jpg", { type: "image/jpeg" }));
    fd.append("transformationPrompt", new File(["x".repeat(50_000)], "prompt.txt", { type: "text/plain" }));
    const request = new Request("https://app.test/api/transform-image", { method: "POST", body: fd });
    const res = await transformAction({ request, params: {}, context: {} } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing required fields: image and transformationPrompt" });
    expect(transformImage).not.toHaveBeenCalled();
  });

  it("returns 402 with an error the products page shows when billing is required", async () => {
    currentShop = "unpaid.myshopify.com";
    shopNeedsBilling.mockResolvedValueOnce(true);
    const res = await runTransform("Apply blush.");
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/subscription/) });
    expect(transformImage).not.toHaveBeenCalled();
  });

  it("caps a shop at 30 an hour without touching other shops", async () => {
    currentShop = "busy.myshopify.com";
    for (let i = 0; i < 30; i++) expect((await runTransform("Apply blush.")).status).toBe(200);
    const res = await runTransform("Apply blush.");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many test transformations. Please try again later." });
    expect(transformImage).toHaveBeenCalledTimes(30);

    currentShop = "neighbor.myshopify.com";
    expect((await runTransform("Apply blush.")).status).toBe(200);
  });

  it("caps a shop at 150 a day even when each hour stays under 30", async () => {
    currentShop = "all-day.myshopify.com";
    for (let hour = 0; hour < 5; hour++) {
      vi.setSystemTime(new Date(Date.parse("2026-10-16T00:00:00Z") + hour * (HOUR + 1000)));
      for (let i = 0; i < 30; i++) expect((await runTransform("Apply blush.")).status).toBe(200);
    }
    vi.setSystemTime(new Date(Date.parse("2026-10-16T00:00:00Z") + 5 * (HOUR + 1000)));
    expect((await runTransform("Apply blush.")).status).toBe(429);
    expect(transformImage).toHaveBeenCalledTimes(150);
  });
});

describe("POST /api/classify-product", () => {
  it("passes a normal title and type through unchanged", async () => {
    currentShop = "classify-ok.myshopify.com";
    const res = await runClassify("Velvet Matte Lipstick - Rosewood", "Lipstick");
    expect(res.status).toBe(200);
    expect(classifyProduct).toHaveBeenCalledWith("Velvet Matte Lipstick - Rosewood", "Lipstick", undefined);
  });

  it("caps the name at 300 and the type at 255 chars before classifying", async () => {
    currentShop = "classify-long.myshopify.com";
    const res = await runClassify("n".repeat(1_000_000), "t".repeat(10_000));
    expect(res.status).toBe(200);
    const [name, type] = classifyProduct.mock.calls[0] as [string, string];
    expect(name).toBe("n".repeat(300));
    expect(type).toBe("t".repeat(255));
  });

  it("ignores a file part sent as the description instead of failing", async () => {
    currentShop = "classify-file.myshopify.com";
    const fd = new FormData();
    fd.append("productName", "Volume Mascara");
    fd.append("productDescription", new File(["desc"], "desc.txt", { type: "text/plain" }));
    const request = new Request("https://app.test/api/classify-product", { method: "POST", body: fd });
    const res = await classifyAction({ request, params: {}, context: {} } as any);
    expect(res.status).toBe(200);
    expect(classifyProduct).toHaveBeenCalledWith("Volume Mascara", undefined, undefined);
  });

  it("caps a shop at 120 classifications an hour", async () => {
    currentShop = "classify-loop.myshopify.com";
    for (let i = 0; i < 120; i++) expect((await runClassify(`Product ${i}`)).status).toBe(200);
    const res = await runClassify("Product 121");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many classification requests. Please try again later." });
    expect(classifyProduct).toHaveBeenCalledTimes(120);
  });
});
