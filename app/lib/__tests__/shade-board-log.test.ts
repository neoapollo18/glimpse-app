import { describe, it, expect, vi, afterEach } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());

vi.mock("../ai.server", () => ({
  compressImage: vi.fn(async () => ({
    compressedBase64: "c2VsZmll",
    compressedMimeType: "image/jpeg",
    originalSize: 6,
    compressedSize: 6,
  })),
}));
vi.mock("../gemini.server", () => ({
  geminiClient: () => ({ models: { generateContent } }),
  extractGeminiText: (r: { text: string }) => r.text,
  stripJsonFences: (s: string) => s,
}));

import { classifyShadeBoard } from "../photo-axis-classifier.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shade-board verdict log", () => {
  it("records the pick, not the model's description of the shopper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })),
    );
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        match: "Butter Pecan",
        second_match: "Honey",
        confidence: "high",
        darkness_level: 7,
        tone_family: "WARM",
        reason: "Warm golden mid-lengths, darker roots",
        lighting: "warm indoor light, skin slightly overexposed",
        sampling_region_notes: "sampled mid-lengths",
      }),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const out = await classifyShadeBoard(
      "c2VsZmll",
      "image/jpeg",
      { model: "m", prompt: "p", boardImageUrl: "https://cdn.example/board.png", axisKey: "hair_shade" },
      { key: "hair_shade", label: "Hair shade", values: [{ value: "butterpecan", label: "Butter Pecan" }] },
    );

    expect(out).toEqual({ values: { hair_shade: "butterpecan" }, noMatch: false });
    const verdict = log.mock.calls.find((c) => c[0] === "[shade-board] verdict:");
    expect(verdict).toBeDefined();
    expect(JSON.parse(verdict![1])).toEqual({ match: "Butter Pecan", second_match: "Honey", confidence: "high" });
    const logged = log.mock.calls.flat().join(" ");
    for (const leak of ["WARM", "golden", "overexposed", "darkness_level", "mid-lengths"]) {
      expect(logged).not.toContain(leak);
    }
  });
});
