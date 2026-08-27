// Anthropic Claude client for the AI quiz creator (quiz-first overhaul).
//
// Mirrors the house AI patterns: lazy singleton (gemini.server.ts), retry
// with exponential backoff + permanent-error detection (ai.server.ts), and
// per-call usage logging so cost is observable from day one.

import Anthropic from "@anthropic-ai/sdk";

// Generation + copilot both run on Opus (quality matters: this writes the
// merchant's storefront quiz). Haiku is reserved for cheap subtasks like
// large-catalog compression.
export const CLAUDE_MODEL_MAIN = "claude-opus-4-8";
export const CLAUDE_MODEL_LITE = "claude-haiku-4-5";

let _client: Anthropic | null = null;

export function claudeClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  // maxRetries: 0 — retries are owned by callClaudeWithRetry so backoff and
  // logging match the rest of the codebase (see callGeminiWithRetry).
  _client = new Anthropic({ apiKey, maxRetries: 0 });
  return _client;
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Permanent = retrying cannot help (bad request, auth, quota-style 4xx).
 * Uses the SDK's typed exception classes, never message string matching.
 */
export function isPermanentClaudeError(error: unknown): boolean {
  return (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  );
}

/**
 * Retry wrapper: exponential backoff (1s, 2s, 4s), max 2 retries, breaks
 * immediately on permanent errors. Honors retry-after on 429 when present.
 */
export async function callClaudeWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isPermanentClaudeError(error)) {
        console.error(`[Claude] ${label}: permanent error, not retrying:`, (error as Error).message);
        throw error;
      }
      if (attempt === maxRetries) break;
      let delayMs = 1000 * Math.pow(2, attempt);
      if (error instanceof Anthropic.RateLimitError) {
        const retryAfter = Number(error.headers?.get?.("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) delayMs = retryAfter * 1000;
      }
      console.warn(`[Claude] ${label}: attempt ${attempt + 1} failed (${(error as Error).message}), retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Rough cost at claude-opus-4-8 pricing ($5/$25 per MTok, cache reads 0.1x, writes 1.25x). */
export function estimateCostUsd(usage: ClaudeUsage): number {
  const inputCost = (usage.input_tokens / 1e6) * 5;
  const outputCost = (usage.output_tokens / 1e6) * 25;
  const cacheWrite = ((usage.cache_creation_input_tokens ?? 0) / 1e6) * 5 * 1.25;
  const cacheRead = ((usage.cache_read_input_tokens ?? 0) / 1e6) * 5 * 0.1;
  return inputCost + outputCost + cacheWrite + cacheRead;
}

export function logClaudeUsage(shopDomain: string, label: string, usage: ClaudeUsage | undefined | null): void {
  if (!usage) return;
  console.log(
    `[Claude] ${label} shop=${shopDomain} in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cacheWrite=${usage.cache_creation_input_tokens ?? 0} cacheRead=${usage.cache_read_input_tokens ?? 0} ` +
      `~$${estimateCostUsd(usage).toFixed(4)}`,
  );
}
