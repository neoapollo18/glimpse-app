import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory quiz_offers table: just enough of the supabase-js chain the
// offers module uses (select/eq/maybeSingle, upsert/select/single).
const table: { row: Record<string, unknown> | null } = { row: null };
vi.mock("../supabase.server", () => {
  const from = (name: string) => {
    if (name !== "quiz_offers") throw new Error(`unexpected table ${name}`);
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table.row, error: null }) }),
      }),
      upsert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            table.row = { ...(table.row ?? {}), ...row };
            return { data: table.row, error: null };
          },
        }),
      }),
    };
  };
  return { supabase: { from } };
});

import {
  OFFERS_DEFAULTS,
  buildBundleDiscountInput,
  bundleDiscountLive,
  effectiveMinQty,
  generateBundleCode,
  mapOffersRow,
  publicOffersPayload,
  syncManagedBundleDiscount,
  validateOffersPatch,
  type QuizOffers,
} from "../quiz-offers.server";

const item = (productId: string, handle: string, extra: Record<string, unknown> = {}) => ({
  productId,
  handle,
  title: handle,
  imageUrl: "https://cdn.example.com/x.jpg",
  when: null,
  ...extra,
});

describe("validateOffersPatch", () => {
  it("accepts a full valid patch and normalizes it", () => {
    const v = validateOffersPatch({
      crossSellEnabled: true,
      crossSellSource: "both",
      crossSellTitle: "  Complete the set  ",
      crossSellItems: [item("123", "nail-glue"), item("123", "nail-glue"), item("456", "prep-pads", { when: { axisKey: "vibe", axisValue: "full_glam" } })],
      crossSellMax: 4,
      bundleDiscountMode: "managed",
      bundleDiscountType: "percentage",
      bundleDiscountValue: "20",
      bundleDiscountMinQty: 3,
      bundleDiscountCode: " BUNDLE20 ",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.patch.crossSellTitle).toBe("Complete the set");
    expect(v.patch.crossSellItems).toHaveLength(2); // duplicate product dropped
    expect(v.patch.crossSellItems![1].when).toEqual({ axisKey: "vibe", axisValue: "full_glam" });
    expect(v.patch.bundleDiscountValue).toBe(20);
    expect(v.patch.bundleDiscountCode).toBe("BUNDLE20");
  });

  it("rejects out-of-range and malformed values", () => {
    expect(validateOffersPatch({ bundleDiscountMode: "free" }).ok).toBe(false);
    expect(validateOffersPatch({ bundleDiscountType: "percentage", bundleDiscountValue: 95 }).ok).toBe(false);
    expect(validateOffersPatch({ bundleDiscountType: "percentage", bundleDiscountValue: 0 }).ok).toBe(false);
    expect(validateOffersPatch({ bundleDiscountMinQty: 1 }).ok).toBe(false);
    expect(validateOffersPatch({ bundleDiscountCode: "has space" }).ok).toBe(false);
    expect(validateOffersPatch({ crossSellMax: 9 }).ok).toBe(false);
    expect(validateOffersPatch({ crossSellItems: [item("abc", "x")] }).ok).toBe(false); // non-numeric id
    expect(validateOffersPatch({ crossSellItems: Array.from({ length: 13 }, (_, i) => item(String(i + 1), `p${i}`)) }).ok).toBe(false);
    expect(validateOffersPatch(null).ok).toBe(false);
  });

  it("drops a malformed answer condition instead of trusting it", () => {
    const v = validateOffersPatch({ crossSellItems: [item("1", "glue", { when: { axisKey: "Bad Key", axisValue: "x" } })] });
    expect(v.ok && v.patch.crossSellItems![0].when).toBe(null);
  });

  it("clears nullable fields with empty input", () => {
    const v = validateOffersPatch({ bundleDiscountValue: "", bundleDiscountMinQty: null, bundleDiscountCode: "", crossSellSubtext: "  " });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.patch).toEqual({ bundleDiscountValue: null, bundleDiscountMinQty: null, bundleDiscountCode: null, crossSellSubtext: null });
  });
});

describe("mapOffersRow / payload", () => {
  it("absent row = defaults (everything off)", () => {
    expect(mapOffersRow(null)).toEqual(OFFERS_DEFAULTS);
  });

  it("maps a stored row defensively", () => {
    const o = mapOffersRow({
      cross_sell_enabled: true,
      cross_sell_source: "nope",
      cross_sell_items: [item("1", "glue"), { bogus: true }, item("1", "glue")],
      cross_sell_max: 99,
      bundle_discount_mode: "managed",
      bundle_discount_value: "15.5",
      bundle_discount_code: "QUIZBUNDLE-ABC234",
      bundle_discount_shopify_id: "gid://shopify/DiscountCodeNode/1",
    });
    expect(o.crossSellSource).toBe("manual");
    expect(o.crossSellItems).toHaveLength(1);
    expect(o.crossSellMax).toBe(3);
    expect(o.bundleDiscountValue).toBe(15.5);
    expect(bundleDiscountLive(o)).toBe(true);
  });

  it("public payload never carries the discount code, and gates on the bundle button", () => {
    const offers: QuizOffers = {
      ...OFFERS_DEFAULTS,
      crossSellEnabled: true,
      crossSellItems: [item("1", "glue")],
      bundleDiscountMode: "code",
      bundleDiscountCode: "SECRET20",
      bundleDiscountValue: 20,
    };
    const on = publicOffersPayload(offers, { bundleEnabled: true, bundleSize: 3 });
    expect(JSON.stringify(on)).not.toContain("SECRET20");
    expect(on.bundleDiscount).toEqual({ type: "percentage", value: 20, minQty: 3, note: "Bundle savings applied at checkout" });
    expect(on.crossSell?.title).toBe("Complete the look");
    expect(publicOffersPayload(offers, { bundleEnabled: false, bundleSize: 3 }).bundleDiscount).toBe(null);
  });

  it("manual cross-sell with no products is not offered; Shopify-sourced is", () => {
    const base = { ...OFFERS_DEFAULTS, crossSellEnabled: true };
    expect(publicOffersPayload(base, { bundleEnabled: false, bundleSize: 0 }).crossSell).toBe(null);
    expect(publicOffersPayload({ ...base, crossSellSource: "shopify" }, { bundleEnabled: false, bundleSize: 0 }).crossSell).not.toBe(null);
  });

  it("managed mode is live only once synced to Shopify", () => {
    const o: QuizOffers = { ...OFFERS_DEFAULTS, bundleDiscountMode: "managed", bundleDiscountCode: "QUIZBUNDLE-AAAAAA", bundleDiscountValue: 10 };
    expect(bundleDiscountLive(o)).toBe(false);
    expect(bundleDiscountLive({ ...o, bundleDiscountShopifyId: "gid://x" })).toBe(true);
  });

  it("threshold defaults to the bundle size, else 2", () => {
    expect(effectiveMinQty(OFFERS_DEFAULTS, 3)).toBe(3);
    expect(effectiveMinQty(OFFERS_DEFAULTS, 0)).toBe(2);
    expect(effectiveMinQty({ ...OFFERS_DEFAULTS, bundleDiscountMinQty: 4 }, 3)).toBe(4);
  });
});

describe("Shopify discount input", () => {
  it("percentage → 0-1 float, quantity minimum as a string, all items, context eligibility", () => {
    const input = buildBundleDiscountInput({ code: "QUIZBUNDLE-X", type: "percentage", value: 20, minQty: 3, startsAt: "2026-10-09T00:00:00Z" });
    expect(input).toMatchObject({
      code: "QUIZBUNDLE-X",
      startsAt: "2026-10-09T00:00:00Z",
      context: { all: "ALL" },
      customerGets: { value: { percentage: 0.2 }, items: { all: true } },
      minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "3" } },
      appliesOncePerCustomer: true,
    });
    expect(input).not.toHaveProperty("customerSelection");
  });

  it("fixed amount splits across the bundle; legacy schemas get customerSelection", () => {
    const input = buildBundleDiscountInput({ code: "C", type: "fixed_amount", value: 10, minQty: 2, legacyEligibility: true });
    expect((input.customerGets as any).value).toEqual({ discountAmount: { amount: "10.00", appliesOnEachItem: false } });
    expect(input).toHaveProperty("customerSelection", { all: true });
    expect(input).not.toHaveProperty("context");
  });

  it("generated codes are URL-safe and recognizable", () => {
    for (let i = 0; i < 20; i++) expect(generateBundleCode()).toMatch(/^QUIZBUNDLE-[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe("syncManagedBundleDiscount", () => {
  beforeEach(() => {
    table.row = null;
  });

  it("creates the discount on first sync and stores id, code and threshold", async () => {
    table.row = { shop_id: "s1", bundle_discount_mode: "managed", bundle_discount_type: "percentage", bundle_discount_value: 20 };
    const calls: Array<{ query: string; vars: any }> = [];
    const gql = async (query: string, vars: any) => {
      calls.push({ query, vars });
      return { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/9" }, userErrors: [] } };
    };
    const r = await syncManagedBundleDiscount("s1", gql, { bundleSize: 3 });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("discountCodeBasicCreate");
    expect(calls[0].vars.input.minimumRequirement.quantity.greaterThanOrEqualToQuantity).toBe("3");
    expect(table.row).toMatchObject({ bundle_discount_shopify_id: "gid://shopify/DiscountCodeNode/9", bundle_discount_min_qty: 3 });
    expect(String(table.row!.bundle_discount_code)).toMatch(/^QUIZBUNDLE-/);
  });

  it("retries with customerSelection when the schema rejects context", async () => {
    table.row = { shop_id: "s1", bundle_discount_mode: "managed", bundle_discount_value: 10 };
    let n = 0;
    const gql = async (_q: string, vars: any) => {
      n++;
      if (vars.input.context) throw new Error("Variable $input of type DiscountCodeBasicInput! was provided invalid value for context (Field is not defined)");
      return { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://x/1" }, userErrors: [] } };
    };
    const r = await syncManagedBundleDiscount("s1", gql, { bundleSize: 0 });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("reports the missing scope instead of failing silently", async () => {
    table.row = { shop_id: "s1", bundle_discount_mode: "managed", bundle_discount_value: 10 };
    const r = await syncManagedBundleDiscount("s1", async () => {
      throw new Error("Access denied for discountCodeBasicCreate field. Required access: `write_discounts` access scope.");
    }, { bundleSize: 2 });
    expect(r).toMatchObject({ ok: false, missingScopes: ["write_discounts"] });
  });

  it("switching away from managed deactivates and forgets the generated code", async () => {
    table.row = {
      shop_id: "s1",
      bundle_discount_mode: "off",
      bundle_discount_value: 10,
      bundle_discount_code: "QUIZBUNDLE-AAAAAA",
      bundle_discount_shopify_id: "gid://x/1",
    };
    const queries: string[] = [];
    const r = await syncManagedBundleDiscount("s1", async (q) => {
      queries.push(q);
      return { discountCodeDeactivate: { codeDiscountNode: { id: "gid://x/1" }, userErrors: [] } };
    }, { bundleSize: 2 });
    expect(r.ok).toBe(true);
    expect(queries[0]).toContain("discountCodeDeactivate");
    expect(table.row).toMatchObject({ bundle_discount_shopify_id: null, bundle_discount_code: null });
  });

  it("a failed Shopify update leaves the saved offer untouched (Shopify first, DB second)", async () => {
    table.row = {
      shop_id: "s1",
      bundle_discount_mode: "managed",
      bundle_discount_value: 20,
      bundle_discount_code: "QUIZBUNDLE-CCCCCC",
      bundle_discount_shopify_id: "gid://x/1",
    };
    const before = { ...table.row };
    const r = await syncManagedBundleDiscount("s1", async () => ({
      discountCodeBasicUpdate: { codeDiscountNode: null, userErrors: [{ field: ["value"], message: "Value is invalid" }] },
    }), { bundleSize: 2, pendingPatch: { bundleDiscountValue: 30 } });
    expect(r).toMatchObject({ ok: false, error: "Value is invalid" });
    expect(table.row).toEqual(before);
  });

  it("a successful update persists the pending edit with the sync", async () => {
    table.row = {
      shop_id: "s1",
      bundle_discount_mode: "managed",
      bundle_discount_value: 20,
      bundle_discount_code: "QUIZBUNDLE-CCCCCC",
      bundle_discount_shopify_id: "gid://x/1",
    };
    let sent: any = null;
    const r = await syncManagedBundleDiscount("s1", async (q, vars: any) => {
      if (q.includes("discountCodeBasicUpdate")) {
        sent = vars.input;
        return { discountCodeBasicUpdate: { codeDiscountNode: { id: "gid://x/1" }, userErrors: [] } };
      }
      return { discountCodeActivate: { codeDiscountNode: { id: "gid://x/1" }, userErrors: [] } };
    }, { bundleSize: 2, pendingPatch: { bundleDiscountValue: 30 } });
    expect(r.ok).toBe(true);
    expect(sent.customerGets.value).toEqual({ percentage: 0.3 });
    expect(table.row).toMatchObject({ bundle_discount_value: 30, bundle_discount_shopify_id: "gid://x/1" });
  });

  it("re-creates when the discount was deleted in Shopify admin", async () => {
    table.row = {
      shop_id: "s1",
      bundle_discount_mode: "managed",
      bundle_discount_value: 15,
      bundle_discount_code: "QUIZBUNDLE-BBBBBB",
      bundle_discount_shopify_id: "gid://x/old",
    };
    const r = await syncManagedBundleDiscount("s1", async (q) => {
      if (q.includes("discountCodeBasicUpdate")) {
        return { discountCodeBasicUpdate: { codeDiscountNode: null, userErrors: [{ field: ["id"], message: "Discount does not exist" }] } };
      }
      return { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://x/new" }, userErrors: [] } };
    }, { bundleSize: 2 });
    expect(r.ok).toBe(true);
    expect(table.row).toMatchObject({ bundle_discount_shopify_id: "gid://x/new", bundle_discount_code: "QUIZBUNDLE-BBBBBB" });
  });
});
