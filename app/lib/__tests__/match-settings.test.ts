import { describe, it, expect } from "vitest";
import { validateMatchSettingsPatch } from "../match-settings";

// Studio Matching panel save (moved from the retired Quiz settings page).
// The patch is a partial upsert of store-wide recommendation settings, so
// the important property is that it never writes a key it wasn't sent.

const tuning = (v: unknown) => ({ mapped: true, from: v });

describe("validateMatchSettingsPatch", () => {
  it("accepts a full Matching panel save", () => {
    const v = validateMatchSettingsPatch(
      {
        num_recommendations: 6,
        product_scope: "selected",
        selected_product_ids: ["a", "b", 3],
        recommendation_mode: "hybrid",
        ai_guidance: "Bestsellers first",
        priority_product_ids: ["a"],
        recommendation_tuning: { colorFilter: "loose" },
      },
      tuning,
    );
    expect(v).toEqual({
      ok: true,
      patch: {
        num_recommendations: 6,
        product_scope: "selected",
        selected_product_ids: ["a", "b"],
        recommendation_mode: "hybrid",
        ai_guidance: "Bestsellers first",
        priority_product_ids: ["a"],
        recommendation_tuning: { mapped: true, from: { colorFilter: "loose" } },
      },
    });
  });

  it("a camera hint save touches only the hint", () => {
    const v = validateMatchSettingsPatch({ photo_frame_hint: "  Position your nails in the frame  " }, tuning);
    expect(v).toEqual({ ok: true, patch: { photo_frame_hint: "Position your nails in the frame" } });
  });

  it("never blanks a generated rulebook: non-string guidance is dropped, not written", () => {
    const v = validateMatchSettingsPatch({ recommendation_mode: "ai", ai_guidance: null }, tuning);
    expect(v.ok && "ai_guidance" in v.patch).toBe(false);
  });

  it("rejects out-of-range match counts and unknown values fall back safely", () => {
    expect(validateMatchSettingsPatch({ num_recommendations: 0 }, tuning).ok).toBe(false);
    expect(validateMatchSettingsPatch({ num_recommendations: 9 }, tuning).ok).toBe(false);
    expect(validateMatchSettingsPatch({ num_recommendations: 2.5 }, tuning).ok).toBe(false);
    const v = validateMatchSettingsPatch({ product_scope: "everything", recommendation_mode: "magic" }, tuning);
    expect(v).toEqual({ ok: true, patch: { product_scope: "all_configured", recommendation_mode: "matrix" } });
  });

  it("refuses empty or malformed payloads", () => {
    expect(validateMatchSettingsPatch({}, tuning)).toEqual({ ok: false, error: "Nothing to save" });
    expect(validateMatchSettingsPatch(null, tuning).ok).toBe(false);
    expect(validateMatchSettingsPatch([1, 2], tuning).ok).toBe(false);
  });
});
