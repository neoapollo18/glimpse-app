import { describe, it, expect, vi, beforeEach } from "vitest";

// quiz-generator.server pulls in Supabase-backed modules at import time;
// none of them are exercised by callGenerator, so they are stubbed out.
vi.mock("../supabase.server", () => ({
  supabase: {},
  getVariantsForProducts: async () => [],
  saveChatAssistantConfig: async () => {},
  saveRecommendationConfig: async () => ({ ok: true }),
  getChatAssistantConfig: async () => ({}),
  getRecommendationAdminConfig: async () => ({ axes: [], questions: [], rules: [] }),
  getShopVariantsFlat: async () => [],
}));

type FakeMessage = {
  stop_reason: string;
  content: Array<{ type: "text"; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
};

const streamCalls: Array<{ params: any; options: any }> = [];
let scripted: Array<(options: any) => Promise<FakeMessage>> = [];

vi.mock("../claude.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../claude.server")>();
  return {
    ...actual,
    logClaudeUsage: () => {},
    claudeClient: () => ({
      messages: {
        stream: (params: any, options: any) => {
          streamCalls.push({ params, options });
          const next = scripted.shift();
          if (!next) throw new Error("unexpected model call");
          return {
            on() {
              return this;
            },
            finalMessage: () => next(options),
          };
        },
      },
    }),
  };
});

import { callGenerator } from "../quiz-generator.server";
import { GenerationDeadlineError } from "../claude.server";

const VALID_JSON = JSON.stringify({
  axes: [{ key: "vibe", label: "Vibe", source: "user_question", values: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }],
  questions: [{ axisKey: "vibe", prompt: "Vibe?", options: [{ label: "A", axisValueValue: "a" }, { label: "B", axisValueValue: "b" }] }],
  rules: [],
  recommendationMode: "ai",
});

const message = (stop_reason: string, text: string): FakeMessage => ({
  stop_reason,
  content: [{ type: "text", text }],
  usage: { input_tokens: 10, output_tokens: 20 },
});

const system = [{ type: "text" as const, text: "sys" }];
const messages = [{ role: "user" as const, content: "go" }];

beforeEach(() => {
  streamCalls.length = 0;
  scripted = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("callGenerator - max_tokens handling (M1)", () => {
  it("retries the same prompt once with thinking disabled and records a warning", async () => {
    scripted = [
      async () => message("max_tokens", VALID_JSON.slice(0, 40)),
      async () => message("end_turn", VALID_JSON),
    ];
    const warnings: string[] = [];
    const call = await callGenerator(system, messages, "shop.myshopify.com", "quiz-generate", { warnings });
    expect(call.parseErrors).toBeNull();
    expect(call.config?.questions).toHaveLength(1);
    expect(call.stopReason).toBe("end_turn");
    expect(call.usage).toHaveLength(2);
    expect(warnings).toEqual(["The first draft was cut off at the token limit; retried without extended thinking"]);
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0].params.thinking).toEqual({ type: "adaptive" });
    expect(streamCalls[1].params.thinking).toEqual({ type: "disabled" });
    expect(streamCalls[1].params.messages).toBe(streamCalls[0].params.messages); // same prompt
    expect(streamCalls[1].params.max_tokens).toBe(streamCalls[0].params.max_tokens);
  });

  it("treats a second truncation as an LLM failure (never a repair from truncated text)", async () => {
    scripted = [
      async () => message("max_tokens", "{\"axes\": ["),
      async () => message("max_tokens", "{\"axes\": ["),
    ];
    await expect(callGenerator(system, messages, "shop.myshopify.com", "quiz-generate")).rejects.toThrow(/cut off .* twice/);
    expect(streamCalls).toHaveLength(2);
  });

  it("returns parse errors (not a throw) for a complete but malformed response", async () => {
    scripted = [async () => message("end_turn", "not json")];
    const call = await callGenerator(system, messages, "shop.myshopify.com", "quiz-generate");
    expect(call.config).toBeNull();
    expect(call.parseErrors).toEqual(["response was not valid JSON"]);
    expect(call.stopReason).toBe("end_turn");
  });
});

describe("callGenerator - per-call deadline (H3)", () => {
  it("passes an AbortSignal, aborts at the deadline and does not retry", async () => {
    scripted = [
      (options) =>
        new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("stream aborted")));
        }),
    ];
    const started = Date.now();
    await expect(
      callGenerator(system, messages, "shop.myshopify.com", "quiz-generate", { callTimeoutMs: 30 }),
    ).rejects.toBeInstanceOf(GenerationDeadlineError);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(streamCalls).toHaveLength(1); // permanent: callClaudeWithRetry did not retry
    expect(streamCalls[0].options.signal).toBeInstanceOf(AbortSignal);
  });
});
