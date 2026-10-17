import { describe, it, expect } from "vitest";
import { phoneMatchCandidates } from "../gdpr-phone";

// What the lead step stores for a typed phone (api.storefront.quiz-lead.ts).
const stored = (typed: string) => typed.replace(/[\s().-]/g, "");

describe("phoneMatchCandidates", () => {
  it("keeps the exact payload value, so every row matched before still matches", () => {
    expect(phoneMatchCandidates("+15551234567")).toContain("+15551234567");
    expect(phoneMatchCandidates("+1 (555) 123-4567")).toContain("+15551234567");
    expect(phoneMatchCandidates("5551234567")).toContain("5551234567");
  });

  it("matches a US lead typed in national format against Shopify's E.164", () => {
    const c = phoneMatchCandidates("+15551234567");
    expect(c).toContain(stored("(555) 123-4567"));
    expect(c).toContain(stored("1-555-123-4567"));
    expect(c).toContain(stored("+1 555 123 4567"));
  });

  it("matches trunk-0 national forms (UK, FR, AU)", () => {
    expect(phoneMatchCandidates("+447700900123")).toContain(stored("07700 900123"));
    expect(phoneMatchCandidates("+447700900123")).toContain(stored("7700 900123"));
    expect(phoneMatchCandidates("+33612345678")).toContain(stored("06 12 34 56 78"));
    expect(phoneMatchCandidates("+61412345678")).toContain(stored("0412 345 678"));
  });

  it("matches 3-digit country codes and 8-digit national numbers", () => {
    expect(phoneMatchCandidates("+353871234567")).toContain(stored("087 123 4567")); // IE
    expect(phoneMatchCandidates("+6591234567")).toContain("91234567"); // SG
    expect(phoneMatchCandidates("+447700900123")).toContain("00447700900123");
  });

  it("never strips down to fewer than 8 digits", () => {
    for (const c of phoneMatchCandidates("+15551234567")) {
      expect(c.replace(/^\+/, "").replace(/^0+/, "").length).toBeGreaterThanOrEqual(8);
    }
    const short = phoneMatchCandidates("+1234567");
    expect(short).not.toContain("234567");
    expect(short).not.toContain("34567");
  });

  it("leaves a national-format payload as is (no country code to strip)", () => {
    const c = phoneMatchCandidates("07700900123");
    expect(c).toEqual(expect.arrayContaining(["07700900123", "+07700900123"]));
    expect(c).not.toContain("7700900123");
  });

  it("returns only digits with an optional leading '+', safe for .in()", () => {
    for (const c of phoneMatchCandidates("+1 (555) 123-4567")) {
      expect(c).toMatch(/^\+?\d+$/);
    }
    expect(new Set(phoneMatchCandidates("+15551234567")).size).toBe(
      phoneMatchCandidates("+15551234567").length
    );
  });

  it("returns nothing for values no stored phone can equal", () => {
    expect(phoneMatchCandidates(null)).toEqual([]);
    expect(phoneMatchCandidates(undefined)).toEqual([]);
    expect(phoneMatchCandidates("")).toEqual([]);
    expect(phoneMatchCandidates('555"),id.neq.0')).toEqual([]);
    expect(phoneMatchCandidates("+1 555 123 4567 ext 9")).toEqual([]);
  });
});
