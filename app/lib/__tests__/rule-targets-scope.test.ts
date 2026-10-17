import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory tables behind just enough of the supabase-js chain the rule
// target readers use. Filters really filter (including the products!inner
// embed scope), so a lookup that forgets its shop scope leaks here too.
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let embedProducts = false;
  const parentOf = (r: Row) => (db.products ?? []).find((p) => p.id === r.product_id) ?? null;
  const run = () =>
    (db[table] ?? [])
      .filter((r) => filters.every((f) => f(r)))
      .map((r) => (embedProducts ? { ...r, products: parentOf(r) } : r));
  const b: any = {
    select(cols: string) {
      embedProducts = /products\s*(!inner)?\s*\(/.test(cols);
      return b;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => (col === "products.shop_id" ? parentOf(r)?.shop_id === val : r[col] === val));
      return b;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return b;
    },
    or: () => b,
    order: () => b,
    limit: () => b,
    single: async () => {
      const rows = run();
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } };
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
    },
  };
  return b;
}

const ownTargets: Array<{ kind: "product" | "variant"; id: string }> = [];
vi.mock("../supabase.server", () => ({
  supabase: { from: (table: string) => query(table) },
  getChatAssistantConfig: async () => ({
    num_recommendations: 5,
    product_scope: "all",
    selected_product_ids: [],
    recommendation_mode: "matrix",
    priority_product_ids: [],
  }),
  getShopVariantsFlat: async () => ownTargets,
  saveRecommendationConfig: async () => ({ ok: true }),
  saveChatAssistantConfig: async () => {},
  getRecommendationAdminConfig: async () => ({ axes: [], questions: [], rules: [] }),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: { admin: async () => ({ session: { shop: "attacker.myshopify.com" } }) },
}));

import { action as matchCheck } from "../../routes/app.api.match-check";
import { checkRuleTargets } from "../quiz-draft.server";

// Real-looking UUIDs: the fallback label shows the first 8 characters.
const OWN_SHOP = "a0000000-0000-4000-8000-000000000001";
const VICTIM_SHOP = "b0000000-0000-4000-8000-000000000002";
const P_OWN = "c1000000-0000-4000-8000-000000000001";
const P_OWN_SHADES = "c2000000-0000-4000-8000-000000000002";
const P_OWN_ARCHIVED = "c3000000-0000-4000-8000-000000000003";
const V_OWN = "d1000000-0000-4000-8000-000000000001";
const V_OWN_ARCHIVED = "d2000000-0000-4000-8000-000000000002";
const P_VICTIM = "e1000000-0000-4000-8000-000000000001";
const V_VICTIM = "f1000000-0000-4000-8000-000000000001";

beforeEach(() => {
  db.shops = [
    { id: OWN_SHOP, shop_domain: "attacker.myshopify.com" },
    { id: VICTIM_SHOP, shop_domain: "victim.myshopify.com" },
  ];
  db.products = [
    { id: P_OWN, shop_id: OWN_SHOP, product_name: "Own Serum", handle: "own-serum", image_url: "own.jpg", price: 20, status: "active" },
    { id: P_OWN_SHADES, shop_id: OWN_SHOP, product_name: "Own Lipstick", handle: "own-lip", image_url: "lip.jpg", price: 15, status: "active" },
    { id: P_OWN_ARCHIVED, shop_id: OWN_SHOP, product_name: "Cherry Red", handle: "cherry", image_url: null, price: 9, status: "archived" },
    { id: P_VICTIM, shop_id: VICTIM_SHOP, product_name: "Victim Secret Launch", handle: "secret", image_url: "secret.jpg", price: 99, status: "draft" },
  ];
  db.product_variants = [
    { id: V_OWN, product_id: P_OWN_SHADES, variant_title: "Rosewood", price: 16, image_url: "rose.jpg" },
    { id: V_OWN_ARCHIVED, product_id: P_OWN_ARCHIVED, variant_title: "Matte", price: 9, image_url: null },
    { id: V_VICTIM, product_id: P_VICTIM, variant_title: "Victim Unreleased Shade", price: 99, image_url: "shade.jpg" },
  ];
  db.recommendation_rules = [];
  ownTargets.length = 0;
});

const rule = (id: string, target: { product_id?: string; variant_id?: string }, rank: number) => ({
  id,
  shop_id: OWN_SHOP,
  criteria: { skin: "dry" },
  product_id: target.product_id ?? null,
  variant_id: target.variant_id ?? null,
  rank,
  quantity: 1,
});

async function runMatchCheck() {
  const request = new Request("https://app.example/app/api/match-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ criteria: { skin: "dry" } }),
  });
  const res = await matchCheck({ request, params: {}, context: {} } as any);
  return (await res.json()) as any;
}

describe("match-check resolves only the shop's own rule targets", () => {
  it("a rule pointing at another shop's product or variant reveals nothing", async () => {
    db.recommendation_rules = [
      rule("r1", { product_id: P_VICTIM }, 1),
      rule("r2", { variant_id: V_VICTIM }, 2),
      rule("r3", { product_id: P_OWN }, 3),
      rule("r4", { variant_id: V_OWN }, 4),
    ];
    const body = await runMatchCheck();
    expect(body.ok).toBe(true);
    expect(body.matches.map((m: any) => m.productId)).toEqual([P_OWN, P_OWN_SHADES]);
    expect(body.matches[1]).toMatchObject({ name: "Own Lipstick", variantTitle: "Rosewood", price: 16 });
    const text = JSON.stringify(body);
    expect(text).not.toContain("Victim");
    expect(text).not.toContain(P_VICTIM);
  });
});

describe("checkRuleTargets names only the shop's own pruned targets", () => {
  it("own archived targets keep their names; foreign ones get the generic label", async () => {
    ownTargets.push({ kind: "product", id: P_OWN }, { kind: "variant", id: V_OWN });
    const flow = {
      axes: [],
      questions: [],
      rules: [
        { criteria: { skin: "dry" }, productId: P_VICTIM, variantId: null, rank: 1 },
        { criteria: { skin: "dry" }, productId: P_OWN_ARCHIVED, variantId: null, rank: 2 },
        { criteria: { skin: "dry" }, productId: null, variantId: V_VICTIM, rank: 3 },
        { criteria: { skin: "dry" }, productId: null, variantId: V_OWN_ARCHIVED, rank: 4 },
        { criteria: { skin: "dry" }, productId: P_OWN, variantId: null, rank: 5 },
      ],
    } as any;
    const r = await checkRuleTargets(OWN_SHOP, flow);
    expect([...r.pruneIndexes]).toEqual([0, 1, 2, 3]);
    expect(r.prunedNames).toEqual([
      `product ${P_VICTIM.slice(0, 8)}`,
      "Cherry Red",
      `variant ${V_VICTIM.slice(0, 8)}`,
      "Cherry Red / Matte",
    ]);
    expect(r.prunedNames.join(" ")).not.toContain("Victim");
  });
});
