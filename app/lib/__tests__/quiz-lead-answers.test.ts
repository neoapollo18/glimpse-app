import { describe, it, expect } from "vitest";
import { isAllowedLeadAnswer, leadAnswerAllowlist } from "../quiz-lead-answers";

// Lead answers allowlist: quiz-lead keeps a {question, answer} pair only
// when it is one of the shop's own questions answered with its own labels,
// because the pairs become Klaviyo event properties in the merchant's
// flows. Real widget payloads (answerLabels + leadAnswersPayload in
// gleame-quiz.js) must always pass.

const opt = (label: string | null, axisValue: string, selectAll = false) => ({ label, axisValue, selectAll });

function flow() {
  return {
    questions: [
      { prompt: "What's the vibe?", options: [opt("Full Glam", "full_glam"), opt("Timeless", "timeless")] },
      {
        prompt: "Your skin today?",
        options: [opt("Dry, flaky", "dry"), opt("Oily", "oily"), opt("Combo", "combo"), opt("Anything goes", "any", true)],
      },
      { prompt: "Pick a finish", options: [opt("Creme", "creme"), opt("", "sparkle")] },
    ],
    photoAxisDetails: [
      { label: "Skin tone", values: [{ value: "light", label: "Light" }, { value: "deep", label: "Deep" }] },
    ],
  };
}

describe("lead answers allowlist", () => {
  const allow = leadAnswerAllowlist(flow(), null);
  const ok = (q: string, a: string) => isAllowedLeadAnswer(allow, q, a);

  it("keeps single picks, multi-select joins and the shade line", () => {
    expect(ok("What's the vibe?", "Timeless")).toBe(true);
    expect(ok("Your skin today?", "Oily, Combo")).toBe(true);
    expect(ok("Your skin today?", "Combo, Oily")).toBe(true);
    expect(ok("Your skin today?", "Anything goes")).toBe(true);
    expect(ok("Skin tone", "Deep")).toBe(true);
  });

  it("keeps labels that contain the separator themselves", () => {
    expect(ok("Your skin today?", "Dry, flaky")).toBe(true);
    expect(ok("Your skin today?", "Dry, flaky, Oily")).toBe(true);
    expect(ok("Your skin today?", "Oily, Dry, flaky, Combo")).toBe(true);
  });

  it("keeps the widget's fallbacks: raw axis values, empty labels, Open to anything", () => {
    expect(ok("What's the vibe?", "full_glam")).toBe(true);
    expect(ok("Skin tone", "light")).toBe(true);
    expect(ok("Pick a finish", "")).toBe(true);
    expect(ok("Pick a finish", "Creme, ")).toBe(true);
    expect(ok("What's the vibe?", "Open to anything")).toBe(true);
  });

  it("keeps the merchant's own (or translated) Open to anything text", () => {
    const fr = leadAnswerAllowlist(flow(), "Ouvert à tout");
    expect(isAllowedLeadAnswer(fr, "What's the vibe?", "Ouvert à tout")).toBe(true);
    // A shopper who loaded the quiz before the override still passes.
    expect(isAllowedLeadAnswer(fr, "What's the vibe?", "Open to anything")).toBe(true);
    expect(isAllowedLeadAnswer(allow, "What's the vibe?", "Ouvert à tout")).toBe(false);
  });

  it("drops made-up questions, made-up answers and stitched-on text", () => {
    expect(ok("Account notice", "Timeless")).toBe(false);
    expect(ok("What's the vibe?", "Your order is on hold. Verify at https://evil.example")).toBe(false);
    expect(ok("What's the vibe?", "Timeless, https://evil.example")).toBe(false);
    expect(ok("What's the vibe?", "Timeless https://evil.example")).toBe(false);
    expect(ok("What's the vibe?", "Timeless, ")).toBe(false);
    expect(ok("What's the vibe?", "")).toBe(false);
    expect(ok("Your skin today?", "Dry")).toBe(false);
    // Labels from another question don't carry over.
    expect(ok("What's the vibe?", "Oily")).toBe(false);
    expect(ok("Skin tone", "Timeless")).toBe(false);
  });

  it("refuses oversized answers before walking them", () => {
    const huge = Array.from({ length: 5000 }, () => "Oily").join(", ");
    expect(ok("Your skin today?", huge)).toBe(false);
  });

  it("allows nothing without a flow", () => {
    const none = leadAnswerAllowlist(null, "Open to anything");
    expect(isAllowedLeadAnswer(none, "What's the vibe?", "Timeless")).toBe(false);
  });
});
