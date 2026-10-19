import { describe, it, expect, beforeEach, vi } from "vitest";

// shopHasTryonProducts against in-memory products / product_variants
// tables. The fake evaluates the PostgREST filters the function builds
// (eq, not-is-null, neq, or, in, the products!inner embed), so scope,
// status and prompt rules are exercised, not just call shapes. The real
// PostgREST semantics were checked read-only against production on
// 2026-10-19: this check agreed with the full candidate pool for all 27
// shops.

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  products: [] as Row[],
  variants: [] as Row[],
  fail: null as string | null,
  queries: 0,
}));

function matchesOr(row: Row, expr: string) {
  return expr.split(",").some((part) => {
    const [col, op, ...rest] = part.split(".");
    const val = rest.join(".");
    if (op === "is" && val === "null") return row[col] == null;
    if (op === "eq") return row[col] != null && String(row[col]) === val;
    if (op === "neq") return row[col] != null && String(row[col]) !== val;
    throw new Error(`unsupported or filter ${part}`);
  });
}

vi.mock("../supabase.server", () => {
  const from = (table: string) => {
    db.queries++;
    let embed = false;
    const filters: Array<(r: Row) => boolean> = [];
    let lim = Infinity;
    let range: [number, number] | null = null;
    const source = () => (table === "products" ? db.products : table === "product_variants" ? db.variants : []);
    const q: any = {
      select: (cols: string) => {
        embed = cols.includes("products!inner");
        return q;
      },
      eq: (col: string, val: unknown) => {
        if (col.startsWith("products.")) {
          const c = col.slice("products.".length);
          filters.push((r) => r.products != null && r.products[c] === val);
        } else filters.push((r) => r[col] === val);
        return q;
      },
      not: (col: string, op: string, val: unknown) => {
        if (op !== "is" || val !== null) throw new Error("unsupported not filter");
        filters.push((r) => r[col] != null);
        return q;
      },
      // PostgREST neq: NULL <> x is not true, so NULL rows drop out.
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] != null && r[col] !== val);
        return q;
      },
      or: (expr: string) => {
        filters.push((r) => matchesOr(r, expr));
        return q;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return q;
      },
      order: () => q,
      range: (a: number, b: number) => {
        range = [a, b];
        return q;
      },
      limit: (n: number) => {
        lim = n;
        return q;
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (db.fail) return Promise.resolve({ data: null, error: { message: db.fail } }).then(resolve, reject);
        let rows = source().map((r) => {
          if (!embed) return { ...r };
          const parent = db.products.find((p) => p.id === r.product_id);
          return { ...r, products: parent ? { id: parent.id, status: parent.status, shop_id: parent.shop_id } : null };
        });
        rows = rows.filter((r) => (!embed || r.products) && filters.every((f) => f(r)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        rows = rows.slice(0, lim);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { supabase: { from } };
});

import { shopHasTryonProducts } from "../tryon-availability.server";

const SHOP = "shop-1";
const OTHER = "shop-2";
const all = { product_scope: "all_configured", selected_product_ids: [], quiz_multi_set_prompt: null } as any;
const selected = (ids: string[]) => ({ ...all, product_scope: "selected", selected_product_ids: ids });

const product = (id: string, over: Row = {}) => ({
  id,
  shop_id: SHOP,
  status: "active",
  transformation_prompt: null,
  multi_set_prompt: null,
  ...over,
});
const variant = (id: string, productId: string, over: Row = {}) => ({
  id,
  product_id: productId,
  status: "active",
  // product_variants.transformation_prompt is NOT NULL: catalog sync
  // writes '' for variants nobody configured.
  transformation_prompt: "",
  multi_set_prompt: null,
  ...over,
});

beforeEach(() => {
  db.products = [];
  db.variants = [];
  db.fail = null;
  db.queries = 0;
});

describe("shopHasTryonProducts", () => {
  it("false for the App Review store: catalog synced, nothing set up for try-on", async () => {
    db.products = [product("toner"), product("mask", { transformation_prompt: "" }), product("pants", { status: null })];
    db.variants = [variant("t1", "toner"), variant("m1", "mask"), variant("p1", "pants")];
    expect(await shopHasTryonProducts(SHOP, all)).toBe(false);
  });

  it("true once one live product has a prompt (NULL status counts as live)", async () => {
    db.products = [product("a"), product("b", { status: null, transformation_prompt: "Apply" })];
    expect(await shopHasTryonProducts(SHOP, all)).toBe(true);
  });

  it("ignores draft/archived products and other shops' products", async () => {
    db.products = [
      product("draft", { status: "draft", transformation_prompt: "Apply" }),
      product("archived", { status: "archived", transformation_prompt: "Apply" }),
      product("theirs", { shop_id: OTHER, transformation_prompt: "Apply" }),
    ];
    db.variants = [variant("dv", "draft", { transformation_prompt: "Apply" }), variant("tv", "theirs", { transformation_prompt: "Apply" })];
    expect(await shopHasTryonProducts(SHOP, all)).toBe(false);
  });

  it("honors product_scope 'selected'", async () => {
    db.products = [product("in"), product("out", { transformation_prompt: "Apply" })];
    db.variants = [variant("outv", "out", { transformation_prompt: "Apply" })];
    expect(await shopHasTryonProducts(SHOP, selected(["in"]))).toBe(false);
    expect(await shopHasTryonProducts(SHOP, selected(["in", "out"]))).toBe(true);
    db.queries = 0;
    expect(await shopHasTryonProducts(SHOP, selected([]))).toBe(false);
    expect(db.queries).toBe(0);
  });

  it("a live variant's prompt counts; a deleted variant's doesn't (NULL status is live)", async () => {
    db.products = [product("lip")];
    db.variants = [variant("gone", "lip", { status: "deleted", transformation_prompt: "Apply" })];
    expect(await shopHasTryonProducts(SHOP, all)).toBe(false);
    db.variants.push(variant("legacy", "lip", { status: null, transformation_prompt: "Apply" }));
    expect(await shopHasTryonProducts(SHOP, all)).toBe(true);
  });

  it("multi-set prompts count, and so does the shop-wide one when a live product exists", async () => {
    db.products = [product("set", { multi_set_prompt: "Two sets" })];
    expect(await shopHasTryonProducts(SHOP, all)).toBe(true);
    db.products = [product("plain")];
    expect(await shopHasTryonProducts(SHOP, { ...all, quiz_multi_set_prompt: "Render {count} sets" })).toBe(true);
    expect(await shopHasTryonProducts(SHOP, { ...selected(["nope"]), quiz_multi_set_prompt: "Render {count} sets" })).toBe(false);
    db.products = [product("plain", { status: "draft" })];
    expect(await shopHasTryonProducts(SHOP, { ...all, quiz_multi_set_prompt: "Render {count} sets" })).toBe(false);
  });

  it("throws on a failed read so quiz-config can keep the merchant's toggle", async () => {
    db.fail = "connection reset";
    await expect(shopHasTryonProducts(SHOP, all)).rejects.toThrow("connection reset");
  });
});
