import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../supabase.server", () => ({ supabase: {} }));

import { buildEventBody, buildSubscribeBody, getMarketingBlocks, looksLikeKlaviyoPrivateKey, toE164 } from "../klaviyo.server";
import {
  decryptSecret,
  encryptSecret,
  integrationsEncryptionReady,
  signLeadToken,
  verifyLeadToken,
} from "../integrations.server";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "test-key-test-key-test-key-test-key-0123";
  process.env.SHOPIFY_API_SECRET = "shpss_test_secret";
});

describe("secret encryption", () => {
  it("round-trips and never stores the plain key", () => {
    expect(integrationsEncryptionReady()).toBe(true);
    const enc = encryptSecret("pk_abcdefabcdefabcdefabcdef1234");
    expect(enc).not.toContain("pk_");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe("pk_abcdefabcdefabcdefabcdef1234");
    // Fresh IV each time.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, data] = encryptSecret("pk_abcdefabcdefabcdefabcdef1234").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("refuses to encrypt without a configured key", () => {
    const saved = process.env.INTEGRATIONS_ENCRYPTION_KEY;
    process.env.INTEGRATIONS_ENCRYPTION_KEY = "short";
    try {
      expect(integrationsEncryptionReady()).toBe(false);
      expect(() => encryptSecret("x")).toThrow();
    } finally {
      process.env.INTEGRATIONS_ENCRYPTION_KEY = saved;
    }
  });
});

describe("lead tokens", () => {
  const lead = "8f14e45f-ceea-467a-9575-0c1d2e3f4a5b";
  it("verify only for the shop and lead they were minted for", () => {
    const token = signLeadToken("shop-a", lead)!;
    expect(verifyLeadToken("shop-a", token)).toBe(lead);
    expect(verifyLeadToken("shop-b", token)).toBe(null);
    expect(verifyLeadToken("shop-a", token.slice(0, -2) + "xx")).toBe(null);
    expect(verifyLeadToken("shop-a", `00000000-0000-0000-0000-000000000000.${token.split(".")[1]}`)).toBe(null);
    expect(verifyLeadToken("shop-a", "garbage")).toBe(null);
  });
});

describe("Klaviyo payloads", () => {
  it("subscribe: email consent, SMS only with merchant opt-in, list relationship", () => {
    const body = buildSubscribeBody({ email: "a@b.com", phone: "5551234567", listId: "Y6nRLr", smsConsent: false, source: "Gleame Quiz" }) as any;
    const attrs = body.data.attributes.profiles.data[0].attributes;
    expect(body.data.type).toBe("profile-subscription-bulk-create-job");
    expect(body.data.attributes.custom_source).toBe("Gleame Quiz");
    expect(attrs.email).toBe("a@b.com");
    expect(attrs.phone_number).toBe("+15551234567");
    expect(attrs.subscriptions).toEqual({ email: { marketing: { consent: "SUBSCRIBED" } } });
    expect(body.data.relationships.list.data).toEqual({ type: "list", id: "Y6nRLr" });

    const sms = buildSubscribeBody({ email: null, phone: "+447700900123", listId: "L", smsConsent: true, source: "s" }) as any;
    expect(sms.data.attributes.profiles.data[0].attributes.subscriptions).toEqual({ sms: { marketing: { consent: "SUBSCRIBED" } } });
  });

  it("event: metric by name, profile by email, unique_id for dedupe", () => {
    const body = buildEventBody({
      metric: "Gleame Quiz Results",
      email: "a@b.com",
      phone: null,
      properties: { products: [] },
      uniqueId: "u1",
      time: "2026-10-09T00:00:00.000Z",
    }) as any;
    expect(body.data.type).toBe("event");
    expect(body.data.attributes.metric.data.attributes.name).toBe("Gleame Quiz Results");
    expect(body.data.attributes.profile.data.attributes).toEqual({ email: "a@b.com" });
    expect(body.data.attributes.unique_id).toBe("u1");
    expect(body.data.attributes).not.toHaveProperty("value");
  });

  it("E.164 only when unambiguous; a bad phone never rides along", () => {
    expect(toE164("+15551234567")).toBe("+15551234567");
    expect(toE164("5551234567")).toBe("+15551234567");
    expect(toE164("15551234567")).toBe("+15551234567");
    expect(toE164("+447700900123")).toBe("+447700900123");
    // National numbers with a trunk 0 have no knowable country code.
    expect(toE164("07700900123")).toBe(null);
    expect(toE164("447700900123")).toBe(null);
    expect(toE164("+0123456789")).toBe(null);
    const body = buildSubscribeBody({ email: "a@b.com", phone: "07700900123", listId: "L", smsConsent: true, source: "s" }) as any;
    const attrs = body.data.attributes.profiles.data[0].attributes;
    expect(attrs).not.toHaveProperty("phone_number");
    expect(attrs.subscriptions).toEqual({ email: { marketing: { consent: "SUBSCRIBED" } } });
  });

  it("key shape", () => {
    expect(looksLikeKlaviyoPrivateKey("pk_0123456789abcdef0123456789abcdef01")).toBe(true);
    expect(looksLikeKlaviyoPrivateKey("AbC123")).toBe(false);
  });
});

describe("Klaviyo consent check", () => {
  const respond = (body: unknown, status = 200) =>
    Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response);

  it("an unsubscribed or suppressed address is blocked; unknown profiles are not", async () => {
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    try {
      globalThis.fetch = ((url: string) => {
        urls.push(url);
        return respond({
          data: [{ attributes: { subscriptions: {
            email: { marketing: { consent: "UNSUBSCRIBED", suppression: [] } },
            sms: { marketing: { consent: "SUBSCRIBED", suppression: [{ reason: "HARD_BOUNCE" }] } },
          } } }],
        });
      }) as typeof fetch;
      expect(await getMarketingBlocks("pk_x", { email: "a@b.com", phone: null })).toEqual({ ok: true, emailBlocked: true, smsBlocked: true });
      expect(decodeURIComponent(urls[0])).toContain('equals(email,"a@b.com")');

      globalThis.fetch = (() => respond({ data: [] })) as typeof fetch;
      expect(await getMarketingBlocks("pk_x", { email: "new@b.com", phone: null })).toEqual({ ok: true, emailBlocked: false, smsBlocked: false });

      globalThis.fetch = (() => respond({ errors: [{ detail: "missing scope profiles:read" }] }, 403)) as typeof fetch;
      expect((await getMarketingBlocks("pk_x", { email: "a@b.com", phone: null })).ok).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
