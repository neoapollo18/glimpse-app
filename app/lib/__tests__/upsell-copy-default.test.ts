import { describe, it, expect, vi } from "vitest";

// The try-on banner's default title (used whenever a shop never edited it,
// like the App Review store) carries no emoji.

vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_API_KEY ||= "test-key";
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data: { shop_domain: "pqkzt0-gb.myshopify.com", quiz_upsell_title: null, quiz_upsell_body: null, quiz_upsell_cta: null },
          error: null,
        }),
      };
      return q;
    },
  }),
}));

import { getChatAssistantConfig } from "../supabase.server";

describe("default try-on banner copy", () => {
  it("has no sparkle emoji", async () => {
    const config = await getChatAssistantConfig("pqkzt0-gb.myshopify.com");
    expect(config.quiz_upsell_title).toBe("See these on you");
    expect(config.quiz_upsell_cta).toBe("Try them on me");
    expect(`${config.quiz_upsell_title} ${config.quiz_upsell_body} ${config.quiz_upsell_cta}`).not.toMatch(/✨/);
  });
});
