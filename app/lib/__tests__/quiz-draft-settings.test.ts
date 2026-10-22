import { describe, it, expect, vi, beforeEach } from "vitest";

// Settings allowlist (quiz-draft.server.ts): the results restart label is a
// chat-era column, not quiz_*, so capture and save carry it by name. Without
// that, Text & labels always showed the default and Translate this quiz
// counted the line as translated while the save dropped it.

const state = vi.hoisted(() => ({
  live: {} as Record<string, unknown>,
  written: [] as Record<string, unknown>[],
  // Migration 095 not run: the old CHECK refuses the "both" placement.
  rejectBoth: false,
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
      if (state.rejectBoth && fields.quiz_email_placement === "both") {
        throw new Error(
          'Failed to save assistant settings: new row for relation "chat_assistant_config" violates check constraint "chat_assistant_config_quiz_email_placement_check"',
        );
      }
      state.written.push(fields);
    },
    saveRecommendationConfig: async () => ({ ok: true }),
    getShopVariantsFlat: async () => [],
  };
});

import { captureLiveConfig, saveLiveQuizConfig, EMAIL_BOTH_NEEDS_MIGRATION, type QuizDraft } from "../quiz-draft.server";
import { applyTranslations, collectTranslatable } from "../quiz-translate";
import { applyUpdateCopy, type DraftShape } from "../quiz-copilot-tools.server";
import { sanitizeColumnarSpec } from "../columnar/spec";

const SHOP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.live = { end_restart_label: "Try another look", end_save_label: "Save these", quiz_headline: "Find your shade" };
  state.written = [];
  state.rejectBoth = false;
});

// Email placement "both" (migration 095, card 2026-10-21): the Studio
// offers it before the migration may have run. A save must not break:
// everything else in the edit is kept and the merchant is told why the
// placement didn't change.
describe('email placement "both"', () => {
  const edit = async (fields: Record<string, unknown>) => {
    state.live = { ...state.live, quiz_email_placement: null, quiz_lead_headline: "Want us to send your matches?" };
    const current = await captureLiveConfig(SHOP);
    const r = applyUpdateCopy(current as DraftShape, { fields }, []);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    return saveLiveQuizConfig(SHOP, r.draft as QuizDraft, { preWriteConfig: current });
  };

  it("is an allowed placement and saves once 095 has run", async () => {
    const saved = await edit({ quiz_email_placement: "both" });
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ quiz_email_placement: "both" }]);
  });

  it("before 095: the rest of the edit saves and the error says why the placement didn't", async () => {
    state.rejectBoth = true;
    const saved = await edit({ quiz_email_placement: "both", quiz_lead_headline: "Get your matches" });
    expect(saved).toMatchObject({ ok: false, error: EMAIL_BOTH_NEEDS_MIGRATION });
    expect(state.written).toEqual([{ quiz_lead_headline: "Get your matches" }]);
  });

  it("any other placement still saves before 095", async () => {
    state.rejectBoth = true;
    const saved = await edit({ quiz_email_placement: "after_results" });
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ quiz_email_placement: "after_results" }]);
  });

  it("an unknown placement is still refused before anything is written", () => {
    const draft = { flow: { axes: [], questions: [], rules: [] }, settings: {} } as unknown as DraftShape;
    expect(applyUpdateCopy(draft, { fields: { quiz_email_placement: "twice" } }, []).ok).toBe(false);
  });
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

// Quiz try-on is switched on by the Gleame team in /admin only (migration
// 094). No editing path may change it: a Studio save, a version restore
// or a Build with AI turn.
describe("quiz try-on is admin-only", () => {
  it("a restored version that had try-on on never turns it on", async () => {
    state.live = { ...state.live, quiz_tryon_enabled: false };
    const current = await captureLiveConfig(SHOP);
    const restored = {
      ...current,
      settings: { ...current.settings, quiz_tryon_enabled: true, quiz_headline: "Restored headline" },
    } as QuizDraft;
    const saved = await saveLiveQuizConfig(SHOP, restored, { preWriteConfig: current });
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([{ quiz_headline: "Restored headline" }]);
  });

  it("an edit can't turn it off either: the live value is left alone", async () => {
    state.live = { ...state.live, quiz_tryon_enabled: true };
    const current = await captureLiveConfig(SHOP);
    const edited = { ...current, settings: { ...current.settings, quiz_tryon_enabled: false } } as QuizDraft;
    const saved = await saveLiveQuizConfig(SHOP, edited, { preWriteConfig: current });
    expect(saved.ok).toBe(true);
    expect(state.written).toEqual([]);
  });

  it("Build with AI can't set it", async () => {
    state.live = { ...state.live, quiz_tryon_enabled: false };
    const current = await captureLiveConfig(SHOP);
    const r = applyUpdateCopy(current as DraftShape, { fields: { quiz_tryon_enabled: true } }, []);
    if (r.ok) {
      expect((r.draft as QuizDraft).settings.quiz_tryon_enabled).not.toBe(true);
    } else {
      expect(r.ok).toBe(false);
    }
  });
});
