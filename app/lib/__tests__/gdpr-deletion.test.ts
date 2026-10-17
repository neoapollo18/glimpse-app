import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake supabase-js client: records every query the GDPR paths build and
// answers through a per-test handler. Storage list/remove are spies.
type Op = {
  table: string;
  action: "select" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
  single?: boolean;
};
type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

const h = vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "http://supabase.test";
  process.env.SUPABASE_API_KEY ||= "test-key";
  const state = {
    ops: [] as Op[],
    log: [] as string[],
    handler: (_op: Op): Result => ({ data: [], error: null }),
  };
  const query = (table: string) => {
    const op: Op = { table, action: "select", filters: [] };
    const b: any = {
      select: () => b,
      update: (payload: Record<string, unknown>) => ((op.action = "update"), (op.payload = payload), b),
      delete: () => ((op.action = "delete"), b),
      eq: (c: string, v: unknown) => (op.filters.push(["eq", c, v]), b),
      in: (c: string, v: unknown) => (op.filters.push(["in", c, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((op.single = true), b),
      then: (res: any, rej: any) => {
        state.ops.push(op);
        state.log.push(`${op.action}:${table}`);
        return Promise.resolve().then(() => state.handler(op)).then(res, rej);
      },
    };
    return b;
  };
  const bucket = {
    list: vi.fn(),
    remove: vi.fn(),
  };
  const client = { from: query, storage: { from: vi.fn(() => bucket) } };
  return { state, bucket, client };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => h.client }));

import {
  countOrderEmailsForCustomer,
  deleteShopData,
  findQuizLeadsForCustomer,
  redactOrderEmailsForCustomer,
  redactQuizLeadsForCustomer,
} from "../supabase.server";

const SHOP = "demo-shop.myshopify.com";
const files = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ name: `f${from + i}.jpg` }));
const filterOf = (op: Op, kind: string, col: string) =>
  op.filters.find(([k, c]) => k === kind && c === col)?.[2];

// Shop row present (or not) and every other call succeeds.
function db(shopRow: { id: string } | null, overrides: (op: Op) => Result | undefined = () => undefined) {
  h.state.handler = (op) => {
    const o = overrides(op);
    if (o) return o;
    if (op.table === "shops" && op.action === "select") {
      return op.single ? { data: shopRow, error: null } : { data: shopRow ? [shopRow] : [], error: null };
    }
    if (op.action === "select") return { data: [], error: null };
    return { data: null, error: null, count: 0 };
  };
}

beforeEach(() => {
  h.state.ops = [];
  h.state.log = [];
  h.bucket.list.mockReset().mockResolvedValue({ data: [], error: null });
  h.bucket.remove.mockReset().mockImplementation(async (paths: string[]) => {
    h.state.log.push(`storage.remove:${paths.length}`);
    return { data: paths.map((name) => ({ name })), error: null };
  });
});

describe("deleteShopData: skin-analysis photos", () => {
  it("sweeps the shop's folder even when the shops row is already gone", async () => {
    db(null);
    h.bucket.list
      .mockResolvedValueOnce({ data: files(1000), error: null })
      .mockResolvedValueOnce({ data: files(1000, 1000), error: null })
      .mockResolvedValueOnce({ data: files(500, 2000), error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const r = await deleteShopData(SHOP);

    expect(r.success).toBe(true);
    expect(r.deleted.skinAnalysisPhotos).toBe(2500);
    expect(h.bucket.list.mock.calls.map((c) => [c[0], c[1].offset])).toEqual([
      [SHOP, 0],
      [SHOP, 1000],
      [SHOP, 2000],
      [SHOP, 2500],
    ]);
    const batches = h.bucket.remove.mock.calls.map((c) => c[0] as string[]);
    expect(batches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(batches.flat()).toContain(`${SHOP}/f0.jpg`);
    expect(batches.flat()).toContain(`${SHOP}/f2499.jpg`);
    expect(batches.flat().every((p) => p.startsWith(`${SHOP}/`))).toBe(true);
    // Nothing else to delete without a row.
    expect(h.state.ops.filter((o) => o.action === "delete")).toHaveLength(0);
  });

  it("also removes indexed paths, before the shops row is deleted", async () => {
    db({ id: "shop-1" }, (op) =>
      op.table === "skin_analysis_uploads"
        ? { data: [{ storage_path: `${SHOP}/f0.jpg` }, { storage_path: "old-domain.myshopify.com/x.jpg" }], error: null }
        : undefined
    );
    h.bucket.list.mockResolvedValueOnce({ data: files(2), error: null });

    const r = await deleteShopData(SHOP);

    expect(r.success).toBe(true);
    expect(h.bucket.remove).toHaveBeenCalledTimes(1);
    expect([...h.bucket.remove.mock.calls[0][0]].sort()).toEqual(
      [`${SHOP}/f0.jpg`, `${SHOP}/f1.jpg`, "old-domain.myshopify.com/x.jpg"].sort()
    );
    expect(h.state.log.indexOf("storage.remove:3")).toBeLessThan(h.state.log.indexOf("delete:shops"));
    expect(r.deleted.shop).toBe(true);
  });

  it("uses the same folder name the upload path writes to", async () => {
    db(null);
    await deleteShopData("odd shop/name.myshopify.com");
    expect(h.bucket.list.mock.calls[0][0]).toBe("odd_shop_name.myshopify.com");
  });

  it("never lists the bucket root for an empty domain", async () => {
    db(null);
    await deleteShopData("");
    expect(h.bucket.list).not.toHaveBeenCalled();
  });

  it("fails (so the webhook retries) and keeps the shops row when a remove errors", async () => {
    db({ id: "shop-1" });
    h.bucket.list.mockResolvedValueOnce({ data: files(3), error: null });
    h.bucket.remove.mockResolvedValueOnce({ data: null, error: { message: "storage unavailable" } });

    const r = await deleteShopData(SHOP);

    expect(r.success).toBe(false);
    expect(r.error).toBe("storage unavailable");
    expect(h.state.log).not.toContain("delete:shops");
  });

  it("fails when listing errors, even with no shops row", async () => {
    db(null);
    h.bucket.list.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    const r = await deleteShopData(SHOP);
    expect(r.success).toBe(false);
  });

  it("treats a missing bucket as nothing stored", async () => {
    db({ id: "shop-1" });
    h.bucket.list.mockResolvedValueOnce({ data: null, error: { message: "Bucket not found" } });
    const r = await deleteShopData(SHOP);
    expect(r.success).toBe(true);
    expect(r.deleted.shop).toBe(true);
  });
});

describe("deleteShopData: shop lookup", () => {
  it("reports failure on a lookup error instead of 'already deleted'", async () => {
    db(null, (op) => (op.table === "shops" ? { data: null, error: { message: "connection reset" } } : undefined));
    const r = await deleteShopData(SHOP);
    expect(r.success).toBe(false);
    expect(r.error).toBe("connection reset");
    expect(h.bucket.remove).not.toHaveBeenCalled();
  });

  it("still reports success when the row is truly absent", async () => {
    db(null);
    const r = await deleteShopData(SHOP);
    expect(r.success).toBe(true);
    expect(r.deleted.shop).toBe(false);
  });
});

describe("GDPR customer helpers: shop lookup errors", () => {
  const lookupFails = () =>
    db(null, (op) => (op.table === "shops" ? { data: null, error: { message: "timeout" } } : undefined));

  it("redactQuizLeadsForCustomer returns ok:false and deletes nothing", async () => {
    lookupFails();
    const r = await redactQuizLeadsForCustomer(SHOP, "a@b.com", "+15551234567");
    expect(r.ok).toBe(false);
    expect(h.state.ops.filter((o) => o.table === "quiz_leads")).toHaveLength(0);
  });

  it("redactOrderEmailsForCustomer returns ok:false", async () => {
    lookupFails();
    const r = await redactOrderEmailsForCustomer(SHOP, "a@b.com", { orderIds: [1], customerId: 2 });
    expect(r.ok).toBe(false);
    expect(h.state.ops.filter((o) => o.table === "widget_orders")).toHaveLength(0);
  });

  it("an absent shop is still a clean no-op", async () => {
    db(null);
    expect(await redactQuizLeadsForCustomer(SHOP, "a@b.com", null)).toEqual({ ok: true, deleted: 0 });
    expect(await redactOrderEmailsForCustomer(SHOP, "a@b.com")).toEqual({ ok: true, redacted: 0 });
  });

  it("looks the shop up by exact domain only", async () => {
    db({ id: "shop-1" });
    await redactQuizLeadsForCustomer(SHOP, "a@b.com", null);
    const lookups = h.state.ops.filter((o) => o.table === "shops");
    expect(lookups).toHaveLength(1);
    expect(filterOf(lookups[0], "eq", "shop_domain")).toBe(SHOP);
  });
});

describe("quiz lead phone matching", () => {
  it("redact matches the stored national form of an E.164 payload", async () => {
    db({ id: "shop-1" }, (op) => (op.action === "delete" ? { error: null, count: 1 } : undefined));
    const r = await redactQuizLeadsForCustomer(SHOP, null, "+15551234567");
    expect(r).toEqual({ ok: true, deleted: 1 });
    const del = h.state.ops.find((o) => o.table === "quiz_leads" && o.action === "delete")!;
    expect(filterOf(del, "eq", "shop_id")).toBe("shop-1");
    expect(filterOf(del, "in", "phone")).toEqual(expect.arrayContaining(["+15551234567", "5551234567"]));
  });

  it("data_request uses the same candidates", async () => {
    db({ id: "shop-1" });
    await findQuizLeadsForCustomer(SHOP, null, "+447700900123");
    const sel = h.state.ops.find((o) => o.table === "quiz_leads")!;
    expect(filterOf(sel, "in", "phone")).toEqual(expect.arrayContaining(["+447700900123", "07700900123"]));
  });

  it("skips the phone query for a value no stored phone can equal", async () => {
    db({ id: "shop-1" });
    expect(await redactQuizLeadsForCustomer(SHOP, null, "not a phone")).toEqual({ ok: true, deleted: 0 });
    expect(h.state.ops.filter((o) => o.table === "quiz_leads")).toHaveLength(0);
  });
});

describe("order rows: orders_to_redact and customer.id", () => {
  it("nulls email and customer_id by order id (chunked) and customer id, then the email pass", async () => {
    db({ id: "shop-1" }, (op) => (op.action === "update" ? { error: null, count: 1 } : undefined));
    const orderIds = Array.from({ length: 250 }, (_, i) => 1000 + i);

    const r = await redactOrderEmailsForCustomer(SHOP, "Buyer@Example.com", { orderIds, customerId: 777 });

    expect(r.ok).toBe(true);
    const updates = h.state.ops.filter((o) => o.table === "widget_orders" && o.action === "update");
    const byOrder = updates.filter((o) => filterOf(o, "in", "shopify_order_id"));
    expect(byOrder.map((o) => (filterOf(o, "in", "shopify_order_id") as string[]).length)).toEqual([100, 100, 50]);
    expect((byOrder.flatMap((o) => filterOf(o, "in", "shopify_order_id") as string[]))[0]).toBe("1000");
    for (const o of byOrder) {
      expect(o.payload).toMatchObject({ customer_email: null, customer_id: null });
      expect(o.payload!.email_redacted_at).toBeTruthy();
      expect(filterOf(o, "eq", "shop_id")).toBe("shop-1");
    }
    const byCustomer = updates.find((o) => filterOf(o, "in", "customer_id"))!;
    expect(filterOf(byCustomer, "in", "customer_id")).toEqual(["777"]);
    expect(byCustomer.payload).toMatchObject({ customer_email: null, customer_id: null });
    const byEmail = updates.find((o) => filterOf(o, "eq", "customer_email"))!;
    expect(filterOf(byEmail, "eq", "customer_email")).toBe("buyer@example.com");
    expect(byEmail.payload).not.toHaveProperty("customer_id");
    expect(r.redacted).toBe(5);
  });

  it("skips each pass when its key is absent", async () => {
    db({ id: "shop-1" });
    await redactOrderEmailsForCustomer(SHOP, null, { orderIds: [], customerId: null });
    expect(h.state.ops.filter((o) => o.table === "widget_orders")).toHaveLength(0);
  });

  it("falls back without email_redacted_at when migration 079 hasn't run", async () => {
    db({ id: "shop-1" }, (op) =>
      op.action === "update" && op.payload && "email_redacted_at" in op.payload
        ? { error: { message: "column missing", code: "PGRST204" } }
        : op.action === "update"
          ? { error: null, count: 2 }
          : undefined
    );
    const r = await redactOrderEmailsForCustomer(SHOP, null, { orderIds: [5] });
    expect(r).toEqual({ ok: true, redacted: 2 });
    const retry = h.state.ops.filter((o) => o.action === "update").pop()!;
    expect(retry.payload).toEqual({ customer_email: null, customer_id: null });
  });

  it("returns ok:false on a real update error so the webhook retries", async () => {
    db({ id: "shop-1" }, (op) => (op.action === "update" ? { error: { message: "deadlock", code: "40P01" } } : undefined));
    const r = await redactOrderEmailsForCustomer(SHOP, "a@b.com", { customerId: 9 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("deadlock");
  });

  it("data_request count unions the same predicates by row id", async () => {
    db({ id: "shop-1" }, (op) => {
      if (op.table !== "widget_orders") return undefined;
      if (filterOf(op, "eq", "customer_email")) return { data: [{ id: "o1" }, { id: "o2" }], error: null };
      if (filterOf(op, "in", "shopify_order_id")) return { data: [{ id: "o2" }, { id: "o3" }], error: null };
      if (filterOf(op, "eq", "customer_id")) return { data: [{ id: "o3" }, { id: "o4" }], error: null };
      return undefined;
    });
    const n = await countOrderEmailsForCustomer(SHOP, "a@b.com", { orderIds: [11, 12], customerId: 42 });
    expect(n).toBe(4);
  });
});
