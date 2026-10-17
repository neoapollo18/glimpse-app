import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// Klaviyo forwarding budget: the lead form is public, so per shop and per
// event kind only KLAVIYO_FORWARDS_PER_SHOP_HOUR forwards an hour reach
// Klaviyo. Past it nothing is subscribed or fired (the lead is still
// stored by the route), the skip is logged once per window, and the
// budget comes back when the window resets.

const row = { current: null as Record<string, unknown> | null };

vi.mock("../supabase.server", () => {
  const read = {
    select: () => read,
    eq: () => read,
    maybeSingle: async () => ({ data: row.current, error: null }),
  };
  const write = {
    eq: () => write,
    then: (cb: (r: { error: null }) => unknown) => Promise.resolve(cb({ error: null })),
  };
  return { supabase: { from: () => ({ ...read, update: () => write }) } };
});

const klaviyo = vi.hoisted(() => ({
  createEvent: vi.fn(async () => ({ ok: true })),
  subscribeProfile: vi.fn(async () => ({ ok: true })),
  getMarketingBlocks: vi.fn(async () => ({ ok: true, emailBlocked: false, smsBlocked: false })),
}));
vi.mock("../klaviyo.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../klaviyo.server")>()),
  ...klaviyo,
}));

import { RATE_LIMITS } from "../rate-limiter.server";
import { encryptSecret, sendLeadToKlaviyo, sendResultsToKlaviyo, takeKlaviyoForward } from "../integrations.server";

const LIMIT = RATE_LIMITS.KLAVIYO_FORWARDS_PER_SHOP_HOUR.limit;
const HOUR = RATE_LIMITS.KLAVIYO_FORWARDS_PER_SHOP_HOUR.windowMs;
const LEAD = "8f14e45f-ceea-467a-9575-0c1d2e3f4a5b";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "test-key-test-key-test-key-test-key-0123";
  process.env.SHOPIFY_API_SECRET = "shpss_test_secret";
  row.current = {
    id: "row-1",
    enabled: true,
    credentials_encrypted: encryptSecret("pk_abcdefabcdefabcdefabcdef1234"),
    key_hint: "1234",
    settings: { listId: "Y6nRLr" },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  klaviyo.createEvent.mockClear();
  klaviyo.subscribeProfile.mockClear();
});

describe("takeKlaviyoForward", () => {
  it("allows the hour's budget, then refuses until the window resets", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < LIMIT; i++) expect(takeKlaviyoForward("shop-budget", "lead")).toBe(true);
    expect(takeKlaviyoForward("shop-budget", "lead")).toBe(false);
    expect(takeKlaviyoForward("shop-budget", "lead")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // Other shops and the other event kind keep their own budgets.
    expect(takeKlaviyoForward("shop-other", "lead")).toBe(true);
    expect(takeKlaviyoForward("shop-budget", "results")).toBe(true);

    vi.setSystemTime(new Date(Date.now() + HOUR + 1));
    expect(takeKlaviyoForward("shop-budget", "lead")).toBe(true);
    for (let i = 1; i < LIMIT; i++) takeKlaviyoForward("shop-budget", "lead");
    expect(takeKlaviyoForward("shop-budget", "lead")).toBe(false);
    // A new window logs again, once.
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("sendLeadToKlaviyo / sendResultsToKlaviyo budget", () => {
  it("stops subscribing and firing events past the budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lead = { leadId: LEAD, email: "a@b.com", phone: null, answers: [], discountCode: null };
    for (let i = 0; i < LIMIT + 5; i++) await sendLeadToKlaviyo("shop-send", lead);
    expect(klaviyo.subscribeProfile).toHaveBeenCalledTimes(LIMIT);
    expect(klaviyo.createEvent).toHaveBeenCalledTimes(LIMIT);

    klaviyo.createEvent.mockClear();
    const products = [{ productId: "1", title: "Red Flare", url: "https://shop/products/red-flare", imageUrl: null, price: null }];
    for (let i = 0; i < LIMIT + 5; i++) await sendResultsToKlaviyo("shop-send", { leadId: LEAD, email: "a@b.com", phone: null, answers: [] }, products);
    expect(klaviyo.createEvent).toHaveBeenCalledTimes(LIMIT);
  });

  it("a shop that isn't forwarding spends nothing", async () => {
    const saved = row.current;
    row.current = { ...saved, enabled: false };
    try {
      const lead = { leadId: LEAD, email: "a@b.com", phone: null, answers: [], discountCode: null };
      for (let i = 0; i < LIMIT + 5; i++) await sendLeadToKlaviyo("shop-off", lead);
    } finally {
      row.current = saved;
    }
    expect(klaviyo.createEvent).not.toHaveBeenCalled();
    expect(takeKlaviyoForward("shop-off", "lead")).toBe(true);
  });
});
