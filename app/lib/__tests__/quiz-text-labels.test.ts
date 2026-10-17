import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  UI_TEXT_ENTRIES,
  UI_TEXT_KEYS,
  applyProductWhyPatch,
  applyUiTextPatch,
  quizTextPayload,
  resultsCtaPayload,
  sanitizeProductWhy,
  sanitizeUiText,
  uiTextApplies,
  uiTextDefault,
  uiTextEntry,
} from "../quiz-ui-text";
import {
  applySetProductWhy,
  applyUpdateCopy,
  applyUpdateDesignTokens,
  applyUpdateUiText,
  type DraftShape,
} from "../quiz-copilot-tools.server";
import type { CatalogProduct } from "../quiz-config-schema.server";

// 2026-10-16 merchant requests: editable shopper text (Text & labels),
// body typography, results CTA, per-product "why this fits" lines.

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const catalog: CatalogProduct[] = [
  { id: P1, name: "Bible Digitale", variants: [] },
  { id: P2, name: "Journal", variants: [] },
];

function draft(settings: Record<string, unknown> = {}): DraftShape {
  return { flow: { axes: [], questions: [], rules: [] }, settings } as unknown as DraftShape;
}

describe("UI text registry", () => {
  it("has unique keys, and column entries are not stored in the text map", () => {
    const keys = UI_TEXT_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(UI_TEXT_KEYS.has("back")).toBe(true);
    expect(UI_TEXT_KEYS.has("quiz_view_product_label")).toBe(false);
  });

  it("template defaults win for that template only", () => {
    const start = uiTextEntry("start")!;
    expect(uiTextDefault(start, null)).toBe("Start the quiz");
    expect(uiTextDefault(start, "t1")).toBe("Find my match");
    expect(uiTextDefault(uiTextEntry("next")!, "t4")).toBe("Next");
    expect(uiTextDefault(uiTextEntry("next")!, "t2")).toBe("Continue");
  });

  it("filters entries to the current layout", () => {
    const classic = { template: null, grid: false, boutique: false };
    const grid = { template: null, grid: true, boutique: false };
    const t3 = { template: "t3", grid: false, boutique: false };
    expect(uiTextApplies(uiTextEntry("back")!, t3)).toBe(true);
    expect(uiTextApplies(uiTextEntry("gridAdd")!, grid)).toBe(true);
    expect(uiTextApplies(uiTextEntry("gridAdd")!, classic)).toBe(false);
    expect(uiTextApplies(uiTextEntry("quiz_add_button_template")!, grid)).toBe(false);
    expect(uiTextApplies(uiTextEntry("quiz_add_button_template")!, t3)).toBe(true);
    expect(uiTextApplies(uiTextEntry("nameQuestion")!, t3)).toBe(true);
    expect(uiTextApplies(uiTextEntry("nameQuestion")!, classic)).toBe(false);
    expect(uiTextApplies(uiTextEntry("selectAll")!, classic)).toBe(false);
  });
});

describe("sanitizeUiText / applyUiTextPatch", () => {
  it("keeps known keys with real text only", () => {
    expect(
      sanitizeUiText({ back: "  Retour ", next: "", start: 5, nope: "x", quiz_view_product_label: "Voir" }),
    ).toEqual({ back: "Retour" });
    expect(sanitizeUiText(null)).toEqual({});
    expect(sanitizeUiText(["back"])).toEqual({});
    expect(sanitizeUiText({ back: "x".repeat(500) }).back).toHaveLength(200);
  });

  it("sets, clears with null/blank, and drops text equal to the default", () => {
    const r1 = applyUiTextPatch(null, { back: "Retour", next: "Suivant" }, null);
    expect(r1).toEqual({ ok: true, value: { back: "Retour", next: "Suivant" } });
    const r2 = applyUiTextPatch({ back: "Retour", next: "Suivant" }, { back: null, next: "  " }, null);
    expect(r2).toEqual({ ok: true, value: null });
    // "Continue" is the classic default (cleared) but a real override on t4.
    expect(applyUiTextPatch(null, { next: "Continue" }, null)).toEqual({ ok: true, value: null });
    expect(applyUiTextPatch(null, { next: "Continue" }, "t4")).toEqual({ ok: true, value: { next: "Continue" } });
  });

  it("rejects unknown keys, column keys and non-text", () => {
    expect(applyUiTextPatch(null, { bogus: "x" }, null).ok).toBe(false);
    expect(applyUiTextPatch(null, { quiz_view_product_label: "x" }, null).ok).toBe(false);
    expect(applyUiTextPatch(null, { back: 3 }, null).ok).toBe(false);
  });
});

describe("why this fits lines", () => {
  it("sanitizes keys to product ids and collapses whitespace", () => {
    expect(sanitizeProductWhy({ [P1]: "  Pour  prier\nchaque jour ", "not-a-uuid": "x", [P2]: "" })).toEqual({
      [P1]: "Pour prier chaque jour",
    });
  });

  it("sets and clears one product", () => {
    const set = applyProductWhyPatch(null, P1, "Gentle enough for every day");
    expect(set).toEqual({ ok: true, value: { [P1]: "Gentle enough for every day" } });
    const cleared = applyProductWhyPatch({ [P1]: "x" }, P1, "   ");
    expect(cleared).toEqual({ ok: true, value: null });
    expect(applyProductWhyPatch(null, "p1", "x").ok).toBe(false);
  });
});

describe("payloads", () => {
  it("an untouched quiz sends nulls and today's CTA", () => {
    expect(quizTextPayload({})).toEqual({ uiText: null, bodyWeight: null, bodyColor: null });
    expect(resultsCtaPayload({})).toEqual({ primaryCta: "add", secondaryLink: true });
    expect(resultsCtaPayload({ quiz_results_secondary_link: null })).toEqual({ primaryCta: "add", secondaryLink: true });
  });

  it("passes valid settings through and drops invalid ones", () => {
    expect(
      quizTextPayload({ quiz_ui_text: { back: "Retour", zzz: "x" }, quiz_body_weight: "600", quiz_body_color: "#333333" }),
    ).toEqual({ uiText: { back: "Retour" }, bodyWeight: "600", bodyColor: "#333333" });
    expect(quizTextPayload({ quiz_body_weight: "900", quiz_body_color: "red" })).toEqual({
      uiText: null,
      bodyWeight: null,
      bodyColor: null,
    });
    expect(resultsCtaPayload({ quiz_results_primary_cta: "view", quiz_results_secondary_link: false })).toEqual({
      primaryCta: "view",
      secondaryLink: false,
    });
  });
});

describe("Studio / copilot appliers", () => {
  it("update_ui_text merges into quiz_ui_text", () => {
    const r = applyUpdateUiText(draft({ quiz_ui_text: { back: "Retour" } }), { fields: { next: "Suivant" } }, catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.draft.settings as any).quiz_ui_text).toEqual({ back: "Retour", next: "Suivant" });
    expect(applyUpdateUiText(draft(), { fields: {} }, catalog).ok).toBe(false);
    expect(applyUpdateUiText(draft(), { fields: { nope: "x" } }, catalog).ok).toBe(false);
  });

  it("set_product_why takes one line or many, catalog ids only", () => {
    const one = applySetProductWhy(draft(), { productId: P1, text: "Pour prier" }, catalog);
    expect(one.ok && (one.draft.settings as any).quiz_product_why).toEqual({ [P1]: "Pour prier" });
    const many = applySetProductWhy(
      draft({ quiz_product_why: { [P1]: "old" } }),
      { lines: [{ productId: P1, text: null }, { productId: P2, text: "Un journal" }] },
      catalog,
    );
    expect(many.ok && (many.draft.settings as any).quiz_product_why).toEqual({ [P2]: "Un journal" });
    const foreign = applySetProductWhy(draft(), { productId: "33333333-3333-4333-8333-333333333333", text: "x" }, catalog);
    expect(foreign.ok).toBe(false);
  });

  it("update_copy validates the results CTA settings", () => {
    const ok = applyUpdateCopy(draft(), { fields: { quiz_results_primary_cta: "view", quiz_results_secondary_link: false } }, catalog);
    expect(ok.ok && ok.draft.settings).toMatchObject({ quiz_results_primary_cta: "view", quiz_results_secondary_link: false });
    expect(applyUpdateCopy(draft(), { fields: { quiz_results_primary_cta: "buy" } }, catalog).ok).toBe(false);
    const cleared = applyUpdateCopy(draft({ quiz_results_primary_cta: "view" }), { fields: { quiz_results_primary_cta: null } }, catalog);
    expect(cleared.ok && (cleared.draft.settings as any).quiz_results_primary_cta).toBeNull();
  });

  it("update_copy takes every column entry, including the restart label", () => {
    const r = applyUpdateCopy(
      draft(),
      { fields: { end_restart_label: "Refaire le quiz", quiz_view_product_label: "Voir" } },
      catalog,
    );
    expect(r.ok && r.draft.settings).toMatchObject({ end_restart_label: "Refaire le quiz", quiz_view_product_label: "Voir" });
    // NOT NULL column: clearing stores "" (the widget falls back), never null.
    const cleared = applyUpdateCopy(draft({ end_restart_label: "Refaire" }), { fields: { end_restart_label: null } }, catalog);
    expect(cleared.ok && (cleared.draft.settings as any).end_restart_label).toBe("");
    for (const e of UI_TEXT_ENTRIES.filter((x) => x.column)) {
      expect(applyUpdateCopy(draft(), { fields: { [e.key]: "Text" } }, catalog).ok, `${e.key} rejected`).toBe(true);
    }
  });

  it("update_design_tokens validates body weight and color", () => {
    const ok = applyUpdateDesignTokens(draft(), { fields: { quiz_body_weight: "500", quiz_body_color: "#2b2b2b" } }, catalog);
    expect(ok.ok && ok.draft.settings).toMatchObject({ quiz_body_weight: "500", quiz_body_color: "#2b2b2b" });
    expect(applyUpdateDesignTokens(draft(), { fields: { quiz_body_weight: "700" } }, catalog).ok).toBe(false);
    expect(applyUpdateDesignTokens(draft(), { fields: { quiz_body_color: "grey" } }, catalog).ok).toBe(false);
  });
});

// The widget can't import the registry, so each stored key must appear in
// it with the registry default as its English fallback: an untouched quiz
// renders exactly what it did before Text & labels existed.
describe("widget fallbacks match the registry", () => {
  const assets = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets");
  const source =
    fs.readFileSync(path.join(assets, "gleame-quiz.js"), "utf8") + "\n" + fs.readFileSync(path.join(assets, "gleame-camera.js"), "utf8");
  // Decode \uXXXX escapes so 'Adding…' equals 'Adding…'.
  const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  for (const entry of UI_TEXT_ENTRIES.filter((e) => !e.column)) {
    it(`${entry.key} is wired with its default`, () => {
      const re = new RegExp(`\\b(?:T|TH|tx)\\('${entry.key}',\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`, "g");
      const fallbacks = [...decoded.matchAll(re)].map((m) => m[2].replace(/\\'/g, "'"));
      expect(fallbacks.length, `no T('${entry.key}', ...) call`).toBeGreaterThan(0);
      const allowed = new Set([entry.default, ...Object.values(entry.templateDefaults ?? {})]);
      for (const f of fallbacks) expect(allowed.has(f), `${entry.key} fallback "${f}"`).toBe(true);
    });
  }
});
