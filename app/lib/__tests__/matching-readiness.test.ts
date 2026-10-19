import { describe, it, expect } from "vitest";
import { matchingReadiness } from "../matching-readiness";

// The publish checklist and the Show to shoppers gate read this; it must
// count every source quiz-recommend matches on.
describe("matchingReadiness", () => {
  it("a matrix quiz matched only by Check matches sentences is set up (bsdhaus, 2026-10-18)", () => {
    // kpfu0s-11: matrix mode, no matrix rules, no guidance, 16 active
    // lean/only sentences. The old check said "No matching set up yet".
    expect(matchingReadiness({ ruleCount: 0, mode: "matrix", answerRules: 16 })).toEqual({ ready: true, sources: ["answers"] });
  });

  it("matrix rules, ai/hybrid mode and the columnar engine each count", () => {
    expect(matchingReadiness({ ruleCount: 3, mode: "matrix" }).sources).toEqual(["rules"]);
    expect(matchingReadiness({ ruleCount: 0, mode: "ai" }).ready).toBe(true);
    expect(matchingReadiness({ ruleCount: 0, mode: "hybrid" }).ready).toBe(true);
    expect(matchingReadiness({ ruleCount: 0, mode: "matrix", columnar: true }).sources).toEqual(["columnar"]);
  });

  it("a matrix quiz with nothing to match on is not set up", () => {
    expect(matchingReadiness({ ruleCount: 0, mode: "matrix", answerRules: 0, columnar: false })).toEqual({ ready: false, sources: [] });
    expect(matchingReadiness({ ruleCount: 0, mode: null }).ready).toBe(false);
  });
});
