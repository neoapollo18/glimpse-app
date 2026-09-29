import { describe, expect, it } from "vitest";
import { phasesPartitionFlow } from "../quiz-templates";

// v3 Match phases must be a contiguous, exhaustive partition of the saved
// question order; anything stale falls back to the plain header.
describe("phasesPartitionFlow", () => {
  const order = ["skin_type", "undertone", "coverage", "finish"];

  it("accepts a contiguous exhaustive partition", () => {
    expect(
      phasesPartitionFlow(
        [
          { label: "About you", axisKeys: ["skin_type", "undertone"] },
          { label: "Your shade", axisKeys: ["coverage", "finish"] },
        ],
        order,
      ),
    ).toBe(true);
  });

  it("rejects phases that omit a question (question added since generation)", () => {
    expect(phasesPartitionFlow([{ label: "A", axisKeys: ["skin_type", "undertone", "coverage"] }], order)).toBe(false);
  });

  it("rejects phases that reference a removed question", () => {
    expect(
      phasesPartitionFlow(
        [
          { label: "A", axisKeys: ["skin_type", "undertone"] },
          { label: "B", axisKeys: ["coverage", "finish", "gone"] },
        ],
        order,
      ),
    ).toBe(false);
  });

  it("rejects a reordered flow", () => {
    expect(
      phasesPartitionFlow(
        [
          { label: "A", axisKeys: ["undertone", "skin_type"] },
          { label: "B", axisKeys: ["coverage", "finish"] },
        ],
        order,
      ),
    ).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(phasesPartitionFlow(null, order)).toBe(false);
    expect(phasesPartitionFlow([], order)).toBe(false);
    expect(phasesPartitionFlow([{ label: "", axisKeys: order }], order)).toBe(false);
    expect(phasesPartitionFlow([{ label: "A", axisKeys: [] }], order)).toBe(false);
    expect(phasesPartitionFlow("nope", order)).toBe(false);
  });
});
