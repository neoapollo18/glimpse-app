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
import { sanitizeColumnarSpec } from "../columnar/spec";

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

// Columnar matching keeps a synced product pool in recommendation_tuning.
// Every save writes the whole tuning blob when it changed, so a restore of
// a version captured before the spec existed must not delete it.
describe("columnar spec across saves and restores", () => {
  const spec = sanitizeColumnarSpec({ enabled: true, pool: { handles: ["pink-pop"], source: "csv" } })!;
  const versionWith = (tuning: Record<string, unknown>): QuizDraft => ({
    flow: { axes: [], questions: [], rules: [] } as unknown as QuizDraft["flow"],
    settings: { recommendation_tuning: tuning } as unknown as QuizDraft["settings"],
  });

  it("a version from before the spec existed keeps the live spec", async () => {
    state.live = { recommendation_tuning: { rankerModel: "flash", columnar: spec } };
    const saved = await saveLiveQuizConfig(SHOP, versionWith({ rankerModel: "lite" }));
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ recommendation_tuning: { rankerModel: "lite", columnar: spec } }]);
  });

  it("a version that has a spec restores it as it was", async () => {
    state.live = { recommendation_tuning: { rankerModel: "flash", columnar: spec } };
    const off = { ...spec, enabled: false };
    const saved = await saveLiveQuizConfig(SHOP, versionWith({ rankerModel: "flash", columnar: off }));
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ recommendation_tuning: { rankerModel: "flash", columnar: off } }]);
  });

  it("a shop without a spec never grows one", async () => {
    state.live = { recommendation_tuning: { rankerModel: "flash" } };
    await saveLiveQuizConfig(SHOP, versionWith({ rankerModel: "lite" }));
    expect(state.written).toEqual([{ recommendation_tuning: { rankerModel: "lite" } }]);
  });
});
