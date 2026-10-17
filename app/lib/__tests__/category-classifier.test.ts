import { describe, it, expect, vi, afterEach } from "vitest";

// The product name reaches the classifier from a request body; the logs
// must only ever carry a bounded slice of it.

vi.mock("../supabase.server", () => ({
  getCategories: async () => [{ id: "c1", name: "Mascara", description: "Lash products" }],
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: async () => ({ candidates: [{ finishReason: "STOP" }] }) };
  },
}));
vi.mock("../gemini.server", () => ({
  extractGeminiText: () => '{"categoryName": null, "confidence": 0}',
}));

import { classifyProduct } from "../category-classifier.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyProduct logging", () => {
  it("logs at most the first 120 chars of the name", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // No category keyword, so this goes all the way to the (stubbed) model.
    const result = await classifyProduct("q".repeat(5000), "Cosmetic");
    expect(result).toBeNull();
    const nameLines = lines.filter((l) => l.includes("q".repeat(100)));
    expect(nameLines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("q".repeat(121));
  });
});
