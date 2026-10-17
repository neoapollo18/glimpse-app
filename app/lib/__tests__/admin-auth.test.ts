import crypto from "crypto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { ADMIN_ALLOWED_SHOPS, mintAdminToken, verifyAdminToken } from "../admin-auth.server";

const SHOP = ADMIN_ALLOWED_SHOPS[0];

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = "shpss_test_secret";
});

afterEach(() => {
  vi.useRealTimers();
});

/** A token signed the way tokens were before purposes existed. */
function legacyToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", "shpss_test_secret").update(body).digest("base64url");
  return `${body}.${sig}`;
}

describe("admin token purposes", () => {
  it("action tokens drive actions but never the CSV export", () => {
    const token = mintAdminToken(SHOP);
    expect(verifyAdminToken(token)).toBe(SHOP);
    expect(verifyAdminToken(token, "actions")).toBe(SHOP);
    expect(verifyAdminToken(token, "csv")).toBe(null);
  });

  it("csv tokens pull the export but never drive actions", () => {
    const token = mintAdminToken(SHOP, "csv");
    expect(verifyAdminToken(token, "csv")).toBe(SHOP);
    expect(verifyAdminToken(token)).toBe(null);
    expect(verifyAdminToken(token, "actions")).toBe(null);
  });

  it("tokens minted before purposes existed still work as action tokens only", () => {
    const token = legacyToken({ shop: SHOP, exp: Date.now() + 60_000 });
    expect(verifyAdminToken(token)).toBe(SHOP);
    expect(verifyAdminToken(token, "csv")).toBe(null);
  });

  it("the purpose is signed: relabeling an action token breaks it", () => {
    const [body, sig] = mintAdminToken(SHOP).split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const relabeled = Buffer.from(JSON.stringify({ ...payload, purpose: "csv" })).toString("base64url");
    expect(verifyAdminToken(`${relabeled}.${sig}`, "csv")).toBe(null);
  });

  it("csv tokens expire after 10 minutes, action tokens keep their 12h", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const csv = mintAdminToken(SHOP, "csv");
    const actions = mintAdminToken(SHOP);
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(verifyAdminToken(csv, "csv")).toBe(SHOP);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(verifyAdminToken(csv, "csv")).toBe(null);
    vi.advanceTimersByTime(11 * 60 * 60 * 1000);
    expect(verifyAdminToken(actions)).toBe(SHOP);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(verifyAdminToken(actions)).toBe(null);
  });

  it("still requires an allowlisted shop and a valid signature", () => {
    expect(verifyAdminToken(mintAdminToken("other.myshopify.com", "csv"), "csv")).toBe(null);
    expect(verifyAdminToken(mintAdminToken(SHOP, "csv").slice(0, -2) + "xx", "csv")).toBe(null);
    expect(verifyAdminToken("garbage", "csv")).toBe(null);
    expect(verifyAdminToken(null, "csv")).toBe(null);
  });
});
