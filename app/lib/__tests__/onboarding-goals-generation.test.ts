import { describe, it, expect, vi } from "vitest";

// Welcome intro goals (2026-10-18) shape the generated quiz: "returns" asks
// the model for a fit question, "emails" turns on email capture. The other
// goals change nothing, and nothing is added without a goal.
vi.mock("../supabase.server", () => ({
  supabase: {},
  getVariantsForProducts: async () => [],
  saveChatAssistantConfig: async () => {},
  saveOnboardingSurvey: async () => true,
}));

import { applyGoalSettings, briefToPrompt, type BrandBrief } from "../quiz-generator.server";

const brief = (goals?: BrandBrief["goals"]): BrandBrief => ({
  category: "color-cosmetics",
  brandVoice: "warm and confident",
  quizLength: "standard",
  modePreference: "auto",
  goals,
});

describe("welcome intro goals in generation", () => {
  it("'Cut returns' asks for a question that pins down fit", () => {
    expect(briefToPrompt(brief(["returns"]), [4, 6], null)).toContain("FIT FIRST");
  });

  it("no goals, or goals that need nothing, leave the prompt as it was", () => {
    const base = briefToPrompt(brief(), [4, 6], null);
    expect(base).not.toContain("FIT FIRST");
    expect(briefToPrompt(brief(["choose", "insights", "emails"]), [4, 6], null)).toBe(base);
  });

  it("'Grow my email list' turns on email capture, and only that goal does", () => {
    const on: Record<string, unknown> = {};
    applyGoalSettings(on, ["emails"]);
    expect(on).toEqual({ quiz_lead_enabled: true });
    const off: Record<string, unknown> = {};
    applyGoalSettings(off, ["choose", "returns", "insights"]);
    applyGoalSettings(off, undefined);
    expect(off).toEqual({});
  });
});
