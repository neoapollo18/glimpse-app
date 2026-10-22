import { describe, it, expect, vi } from "vitest";

// The columnar spec lives inside recommendation_tuning, which every Studio
// save writes back through mapRecommendationTuning: the mapper must carry
// the spec through (sanitized, idempotent) and never invent one. Also the
// Studio card's patch validation and the analytics allowlist additions.

vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_API_KEY ||= "test-key";
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { mapRecommendationTuning, RECOMMENDATION_TUNING_DEFAULTS } from "../supabase.server";
import {
  applyColumnarPatch,
  COLUMNAR_DEFAULTS,
  sanitizeColumnarSpec,
  validateColumnarPatch,
} from "../columnar/spec";
import { sanitizeQuizEventProperties } from "../quiz-event-properties";
import { glamneticSpec, GLAMNETIC_AXES } from "./fixtures/glamnetic-columnar";

describe("mapRecommendationTuning", () => {
  it("preserves a columnar spec next to the classic knobs", () => {
    const spec = glamneticSpec({ threshold: 4, vibes: { holiday: { enabled: false } } });
    const mapped = mapRecommendationTuning({ rankerModel: "pro", columnar: spec });
    expect(mapped.rankerModel).toBe("pro");
    expect(mapped.columnar).toEqual(spec);
    // Idempotent: a mapped blob written back and read again is unchanged.
    expect(mapRecommendationTuning(JSON.parse(JSON.stringify(mapped)))).toEqual(mapped);
  });

  it("never adds the key for a shop without one", () => {
    expect(mapRecommendationTuning({ colorFilter: "loose" })).not.toHaveProperty("columnar");
    expect(mapRecommendationTuning(null)).toEqual(RECOMMENDATION_TUNING_DEFAULTS);
    expect(mapRecommendationTuning({ columnar: "nope" })).not.toHaveProperty("columnar");
  });

  it("sanitizes the spec key by key", () => {
    const mapped = mapRecommendationTuning({
      columnar: {
        enabled: "yes",
        pool: { handles: ["ok-handle", "Bad Handle!", "ok-handle", 7], syncedAt: "not a date", source: "sheet", collectionHandle: "x y" },
        threshold: 999,
        candidateCount: "40",
        weights: { color: 3, drama: -1 },
        axes: {
          length: { role: "length", values: { short: "short", medium: "giant", __proto__: "short" } },
          bogus: { role: "nope", values: {} },
          constructor: { role: "vibe", values: {} },
        },
        vibes: { holiday: { enabled: false }, made_up: { enabled: false }, vacay: { enabled: "no" } },
        holidayCollections: ["  Holiday ", "", 5],
        llm: { enabled: false, timeoutMs: 1 },
      },
    });
    expect(mapped.columnar).toEqual({
      enabled: false,
      version: 1,
      pool: { collectionHandle: null, handles: ["ok-handle"], syncedAt: null, source: "collection" },
      threshold: 50,
      fullMatchMin: 3,
      candidateCount: COLUMNAR_DEFAULTS.candidateCount,
      resultCount: 6,
      alsoMatchedCount: 6,
      weights: { color: 1, drama: 0, vibe: 0.25 },
      axes: { length: { role: "length", values: { short: "short" } } },
      vibes: { holiday: { enabled: false } },
      holidayCollections: ["Holiday"],
      llm: { enabled: false, timeoutMs: 500 },
      vibeLabels: {},
    });
  });

  it("keeps approved vibe labels (fix spec v4): handles checked, vibe IDs only, French Girl Chic left to the tags", () => {
    const raw = {
      ...glamneticSpec(),
      fullMatchMin: 40,
      vibeLabels: {
        "berry-baby-super-short-press-on-nails": ["holiday", "alt_edgy", "alt_edgy", "spooky", 7],
        "plain-set": [],
        "french-set": ["french_girl", "clean_girl"],
        "Bad Handle!": ["vacay"],
        constructor: ["vacay"],
        "not-a-list": "vacay",
      },
    };
    const spec = sanitizeColumnarSpec(raw)!;
    expect(spec.fullMatchMin).toBe(12);
    expect(spec.vibeLabels).toEqual({
      "berry-baby-super-short-press-on-nails": ["alt_edgy", "holiday"],
      "plain-set": [],
      "french-set": ["clean_girl"],
    });
    // Survives every Studio save: the mapper carries it, idempotently.
    const mapped = mapRecommendationTuning({ columnar: spec });
    expect(mapped.columnar?.vibeLabels).toEqual(spec.vibeLabels);
    expect(sanitizeColumnarSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    expect(sanitizeColumnarSpec({ enabled: true })!.fullMatchMin).toBe(3);
  });

  it("keeps the contract's Glamnetic mapping intact", () => {
    const spec = sanitizeColumnarSpec({ enabled: true, axes: GLAMNETIC_AXES })!;
    expect(spec.axes).toEqual(GLAMNETIC_AXES);
    expect(spec.weights).toEqual({ color: 0.4, drama: 0.35, vibe: 0.25 });
    expect(spec.holidayCollections).toEqual(["Holiday", "Snow", "Sleigh", "Winter", "Polar"]);
    expect(spec.llm).toEqual({ enabled: true, timeoutMs: 4000 });
  });
});

describe("Studio card patch", () => {
  it("validates only the merchant-editable knobs", () => {
    expect(validateColumnarPatch({ enabled: true, threshold: 4, vibes: { holiday: false, nope: false, vacay: "x" } })).toEqual({
      ok: true,
      patch: { enabled: true, threshold: 4, vibes: { holiday: false } },
    });
    expect(validateColumnarPatch({ threshold: 0 })).toEqual({ ok: false, error: "Pick a threshold between 1 and 50" });
    expect(validateColumnarPatch({ pool: { handles: [] } })).toEqual({ ok: false, error: "Nothing to save" });
    expect(validateColumnarPatch([])).toEqual({ ok: false, error: "Malformed settings" });
  });

  it("merges vibe toggles and leaves the pool alone", () => {
    const spec = glamneticSpec({ vibes: { vacay: { enabled: false } } });
    const next = applyColumnarPatch(spec, { threshold: 4, vibes: { holiday: false } });
    expect(next.vibes).toEqual({ vacay: { enabled: false }, holiday: { enabled: false } });
    expect(next.threshold).toBe(4);
    expect(next.pool).toBe(spec.pool);
    expect(next.enabled).toBe(true);
  });
});

describe("analytics allowlist (brief section 8)", () => {
  it("results_view carries the six handles, the rung and the permalink key", () => {
    expect(
      sanitizeQuizEventProperties("quiz_results_shown", {
        n: 6,
        handles: ["tiger-eye-super-short-press-on-nails", "<b>x</b>"],
        rung: 3,
        rk: "c1.4.2.1.1.1.1",
      }),
    ).toEqual({ n: 6, handles: ["tiger-eye-super-short-press-on-nails"], rung: 3, rk: "c1.4.2.1.1.1.1" });
    expect(sanitizeQuizEventProperties("quiz_results_shown", { rung: 9, rk: "C1 <x>" })).toBeNull();
  });

  it("step events carry the answer IDs", () => {
    expect(sanitizeQuizEventProperties("quiz_question_answered", { qi: 1, q: "length", vals: ["short"], ids: ["short", "Not An Id"] })).toEqual({
      qi: 1,
      q: "length",
      vals: ["short"],
      ids: ["short"],
    });
  });
});
