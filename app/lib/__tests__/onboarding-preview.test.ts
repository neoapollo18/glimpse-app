// Onboarding preview products (2026-10-19): a few of the store's own
// products for the intro and scope drawings. Synced rows first, scoped by
// shop; the Admin API only when nothing usable is synced yet; never throws.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Rows = Array<Record<string, unknown>>;
let rows: Rows | Error = [];
const calls: Array<[string, ...unknown[]]> = [];

// A chainable stand-in for supabase-js: records every filter, resolves at limit().
function query() {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "not", "or"]) {
    chain[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return chain;
    };
  }
  chain.limit = async (...a: unknown[]) => {
    calls.push(["limit", ...a]);
    if (rows instanceof Error) throw rows;
    return { data: rows, error: null };
  };
  return chain;
}

vi.mock("../supabase.server", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      return query();
    },
  },
}));

import { loadPreviewProducts } from "../onboarding-preview.server";

const admin = (nodes: unknown[] | Error) => ({
  graphql: vi.fn(async () => {
    if (nodes instanceof Error) throw nodes;
    return new Response(JSON.stringify({ data: { products: { nodes } } }));
  }),
});

beforeEach(() => {
  rows = [];
  calls.length = 0;
});

describe("loadPreviewProducts", () => {
  it("reads this shop's active, photographed products from the synced catalog", async () => {
    rows = [
      { product_name: "Cherry Glaze", image_url: "https://cdn.shopify.com/a.webp" },
      { product_name: "Ballet Pink", image_url: "https://cdn.shopify.com/b.webp" },
      { product_name: "", image_url: "https://cdn.shopify.com/c.webp" },
      { product_name: "Boba", image_url: "http://insecure.example/d.jpg" },
    ];
    const a = admin([]);
    const out = await loadPreviewProducts("shop-1", a, 4);
    expect(out).toEqual([
      { name: "Cherry Glaze", imageUrl: "https://cdn.shopify.com/a.webp" },
      { name: "Ballet Pink", imageUrl: "https://cdn.shopify.com/b.webp" },
    ]);
    expect(calls).toContainEqual(["from", "products"]);
    expect(calls).toContainEqual(["eq", "shop_id", "shop-1"]);
    expect(calls).toContainEqual(["not", "image_url", "is", null]);
    expect(calls).toContainEqual(["limit", 4]);
    // Enough synced: no Admin API call.
    expect(a.graphql).not.toHaveBeenCalled();
  });

  it("asks the Admin API when nothing usable is synced yet (a brand-new install)", async () => {
    const a = admin([
      { title: "Glow Serum", featuredImage: { url: "https://cdn.shopify.com/s.png" } },
      { title: "No photo", featuredImage: null },
      { title: "Velvet Lip", featuredImage: { url: "https://cdn.shopify.com/l.png" } },
    ]);
    const out = await loadPreviewProducts("shop-1", a, 4);
    expect(out.map((p) => p.name)).toEqual(["Glow Serum", "Velvet Lip"]);
    expect(a.graphql).toHaveBeenCalledTimes(1);
  });

  it("never throws: a failed read is an empty preview", async () => {
    rows = new Error("db down");
    expect(await loadPreviewProducts("shop-1", admin(new Error("throttled")), 4)).toEqual([]);
    expect(await loadPreviewProducts("shop-1", null, 4)).toEqual([]);
  });

  it("keeps the one synced product when the Admin API has nothing better", async () => {
    rows = [{ product_name: "Cherry Glaze", image_url: "https://cdn.shopify.com/a.webp" }];
    const out = await loadPreviewProducts("shop-1", admin(new Error("throttled")), 4);
    expect(out).toEqual([{ name: "Cherry Glaze", imageUrl: "https://cdn.shopify.com/a.webp" }]);
  });
});
