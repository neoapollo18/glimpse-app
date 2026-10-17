import { describe, it, expect, vi, beforeEach } from "vitest";

// Compliance webhook routing: a failed cleanup must answer 500 so Shopify
// retries; a 200 tells Shopify the data is gone. Helpers are mocked.
const m = vi.hoisted(() => ({
  webhook: vi.fn(),
  deleteShopData: vi.fn(),
  redactQuizLeadsForCustomer: vi.fn(),
  redactOrderEmailsForCustomer: vi.fn(),
  findQuizLeadsForCustomer: vi.fn(),
  countOrderEmailsForCustomer: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({ authenticate: { webhook: m.webhook } }));
vi.mock("../supabase.server", () => ({
  deleteShopData: m.deleteShopData,
  redactQuizLeadsForCustomer: m.redactQuizLeadsForCustomer,
  redactOrderEmailsForCustomer: m.redactOrderEmailsForCustomer,
  findQuizLeadsForCustomer: m.findQuizLeadsForCustomer,
  countOrderEmailsForCustomer: m.countOrderEmailsForCustomer,
}));

import { action } from "../../routes/webhooks";

const SHOP = "demo-shop.myshopify.com";
const call = async (topic: string, payload: unknown) => {
  m.webhook.mockResolvedValueOnce({ shop: SHOP, topic, payload });
  const res = await action({ request: new Request("http://app.test/webhooks", { method: "POST" }), params: {}, context: {} });
  return res as Response;
};
const deleted = { skinAnalysisPhotos: 0, analyticsEvents: 0, productVariants: 0, products: 0, shop: false };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.redactQuizLeadsForCustomer.mockResolvedValue({ ok: true, deleted: 0 });
  m.redactOrderEmailsForCustomer.mockResolvedValue({ ok: true, redacted: 0 });
  m.findQuizLeadsForCustomer.mockResolvedValue([]);
  m.countOrderEmailsForCustomer.mockResolvedValue(0);
});

describe("shop/redact", () => {
  it("returns 500 when cleanup fails", async () => {
    m.deleteShopData.mockResolvedValueOnce({ success: false, deleted, error: "storage unavailable" });
    expect((await call("shop/redact", { shop_domain: SHOP, shop_id: 1 })).status).toBe(500);
  });

  it("returns 200 when cleanup succeeds, including 'already deleted'", async () => {
    m.deleteShopData.mockResolvedValueOnce({ success: true, deleted });
    expect((await call("SHOP_REDACT", { shop_domain: SHOP, shop_id: 1 })).status).toBe(200);
    expect(m.deleteShopData).toHaveBeenCalledWith(SHOP);
  });
});

describe("customers/redact", () => {
  const payload = {
    shop_domain: SHOP,
    customer: { id: 777, email: "a@b.com", phone: "+15551234567" },
    orders_to_redact: [1001, 1002],
  };

  it("passes orders_to_redact and customer.id to the order redact", async () => {
    expect((await call("customers/redact", payload)).status).toBe(200);
    expect(m.redactOrderEmailsForCustomer).toHaveBeenCalledWith(SHOP, "a@b.com", {
      orderIds: [1001, 1002],
      customerId: 777,
    });
    expect(m.redactQuizLeadsForCustomer).toHaveBeenCalledWith(SHOP, "a@b.com", "+15551234567");
  });

  it("returns 500 when the shop lookup or a redact fails", async () => {
    m.redactQuizLeadsForCustomer.mockResolvedValueOnce({ ok: false, deleted: 0, error: "timeout" });
    expect((await call("customers/redact", payload)).status).toBe(500);
    m.redactOrderEmailsForCustomer.mockResolvedValueOnce({ ok: false, redacted: 0, error: "timeout" });
    expect((await call("customers/redact", payload)).status).toBe(500);
  });
});

describe("customers/data_request", () => {
  it("counts order rows by the same keys the redact uses", async () => {
    const res = await call("customers/data_request", {
      shop_domain: SHOP,
      customer: { id: 777, email: "a@b.com" },
      orders_requested: [1001],
    });
    expect(res.status).toBe(200);
    expect(m.countOrderEmailsForCustomer).toHaveBeenCalledWith(SHOP, "a@b.com", {
      orderIds: [1001],
      customerId: 777,
    });
  });
});
