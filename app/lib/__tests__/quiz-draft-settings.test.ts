import { describe, it, expect, vi, beforeEach } from "vitest";

// Settings allowlist (quiz-draft.server.ts): the results restart label is a
// chat-era column, not quiz_*, so capture and save carry it by name. Without
// that, Text & labels always showed the default and Translate this quiz
// counted the line as translated while the save dropped it.

const state = vi.hoisted(() => ({
  live: {} as Record<string, unknown>,
  written: [] as Record<string, unknown>[],
}));

vi.mock("../supabase.server", () => {
  // Just enough of the supabase-js chain for the shop domain lookup, the
  // snapshot bucket check and version pruning.
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "range", "in", "insert", "delete"]) c[m] = () => c;
    c.single = c.maybeSingle = async () => result;
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return c;
  };
  return {
    supabase: {
      from: (table: string) =>
        chain(table === "shops" ? { data: { shop_domain: "demo.myshopify.com" }, error: null } : { data: null, error: null }),
    },
    getRecommendationAdminConfig: async () => ({ axes: [], questions: [], rules: [] }),
    getChatAssistantConfig: async () => ({ ...state.live }),
    saveChatAssistantConfig: async (_shopDomain: string, fields: Record<string, unknown>) => {
      state.written.push(fields);
    },
    saveRecommendationConfig: async () => ({ ok: true }),
    getShopVariantsFlat: async () => [],
  };
});

import { captureLiveConfig, saveLiveQuizConfig, type QuizDraft } from "../quiz-draft.server";
import { applyTranslations, collectTranslatable } from "../quiz-translate";
import { applyUpdateCopy, type DraftShape } from "../quiz-copilot-tools.server";

const SHOP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.live = { end_restart_label: "Try another look", end_save_label: "Save these", quiz_headline: "Find your shade" };
  state.written = [];
});

describe("restart label in the live settings", () => {
  it("capture carries end_restart_label; other chat columns stay out", async () => {
    const live = await captureLiveConfig(SHOP);
    expect(live.settings).toEqual({ end_restart_label: "Try another look", quiz_headline: "Find your shade" });
  });

  it("a Text & labels edit is written on save", async () => {
    const current = await captureLiveConfig(SHOP);
    const r = applyUpdateCopy(current as DraftShape, { fields: { end_restart_label: "Start over" } }, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saved = await saveLiveQuizConfig(SHOP, r.draft as QuizDraft, { preWriteConfig: current });
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ end_restart_label: "Start over" }]);
  });

  it("a translated restart label is written on save", async () => {
    const current = await captureLiveConfig(SHOP);
    const items = collectTranslatable(current, { content: false, template: null });
    const fr: Record<string, string> = {};
    for (const i of items) fr[i.id] = `FR ${i.text}`;
    const { draft } = applyTranslations(current, items, fr, null);
    const saved = await saveLiveQuizConfig(SHOP, draft, { preWriteConfig: current });
    expect(saved.ok).toBe(true);
    expect(state.written).toHaveLength(1);
    expect(state.written[0].end_restart_label).toBe("FR Try another look");
    expect(state.written[0]).not.toHaveProperty("end_save_label");
  });
});
