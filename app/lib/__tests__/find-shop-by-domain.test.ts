import { describe, it, expect, beforeEach, vi } from "vitest";

// findShopByDomain against an in-memory shops table: exact .eq on
// shop_domain, exact element match for .contains on alternate_domains.
// Every filter the function builds is recorded, so a rejected claim can be
// shown to never reach PostgREST.
const state = vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_API_KEY ||= "test-key";
  return { filters: [] as string[] };
});

const SHOPS = [
  { id: 1, shop_domain: "orly-nail.myshopify.com", alternate_domains: ["www.orly.com"] },
  { id: 2, shop_domain: "glamnetic.myshopify.com", alternate_domains: [] as string[] },
];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "shops") throw new Error(`unexpected table ${table}`);
      let rows = SHOPS;
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          state.filters.push(`${column}=eq.${value}`);
          rows = rows.filter((r) => r.shop_domain === value);
          return query;
        },
        contains: (column: string, values: string[]) => {
          state.filters.push(`${column}=cs.{${values.join(",")}}`);
          rows = rows.filter((r) => values.every((v) => r.alternate_domains.includes(v)));
          return query;
        },
        order: () => query,
        limit: async () => ({ data: rows.map(({ id, shop_domain }) => ({ id, shop_domain })), error: null }),
      };
      return query;
    },
  }),
}));

import { findShopByDomain } from "../supabase.server";

beforeEach(() => {
  state.filters = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("findShopByDomain", () => {
  it("still resolves real myshopify and custom domains", async () => {
    expect(await findShopByDomain("orly-nail.myshopify.com")).toEqual({ id: 1, shop_domain: "orly-nail.myshopify.com" });
    expect(await findShopByDomain("www.orly.com")).toEqual({ id: 1, shop_domain: "orly-nail.myshopify.com" });
    expect(await findShopByDomain("glamnetic.myshopify.com")).toEqual({ id: 2, shop_domain: "glamnetic.myshopify.com" });
  });

  it("tolerates whitespace around a hand-typed domain", async () => {
    expect(await findShopByDomain(" www.orly.com ")).toEqual({ id: 1, shop_domain: "orly-nail.myshopify.com" });
  });

  it("looks up other hostnames normally (punycode, unknown shops)", async () => {
    expect(await findShopByDomain("xn--brnd-noa.de")).toBeNull();
    expect(await findShopByDomain("ORLY-NAIL.MYSHOPIFY.COM")).toBeNull();
    expect(state.filters).toContain("shop_domain=eq.xn--brnd-noa.de");
  });

  it.each([
    ["whitespace only (the empty array literal)", " "],
    ["empty", ""],
    ["braces", "{}"],
    ["a comma list", "www.orly.com,www.orly.com"],
    ["quotes", '"www.orly.com"'],
    ["a leading dot", ".www.orly.com"],
    ["a trailing dot", "www.orly.com."],
    ["inner whitespace", "www.orly .com"],
    ["a port", "www.orly.com:443"],
    ["a path", "www.orly.com/apps"],
    ["a scheme", "https://www.orly.com"],
    ["over 253 characters", `${"a".repeat(250)}.com`],
  ])("rejects %s without building a filter", async (_label, claim) => {
    expect(await findShopByDomain(claim)).toBeNull();
    expect(state.filters).toEqual([]);
  });
});
