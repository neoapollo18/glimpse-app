import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  storefrontCached,
  invalidateStorefrontCache,
  clearStorefrontCache,
} from "../storefront-cache.server";

describe("storefrontCached", () => {
  beforeEach(() => {
    clearStorefrontCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves repeat requests from memory within the TTL, then reloads", async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    expect(await storefrontCached("shop.myshopify.com", "quiz-config|tpl=3", load)).toEqual({ n: 1 });
    expect(await storefrontCached("shop.myshopify.com", "quiz-config|tpl=3", load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_001);
    expect(await storefrontCached("shop.myshopify.com", "quiz-config|tpl=3", load)).toEqual({ n: 2 });
  });

  it("shares one in-flight load between concurrent requests", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a = storefrontCached("shop.myshopify.com", "k", load);
    const b = storefrontCached("shop.myshopify.com", "k", load);
    resolve("payload");
    expect(await a).toBe("payload");
    expect(await b).toBe("payload");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keys by shop and key", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    await storefrontCached("a.myshopify.com", "k", load);
    await storefrontCached("b.myshopify.com", "k", load);
    await storefrontCached("a.myshopify.com", "other", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("invalidation drops only that shop's entries (case-insensitive)", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    await storefrontCached("a.myshopify.com", "quiz-config|tpl=3", load);
    await storefrontCached("a.myshopify.com", "recommendation-config", load);
    await storefrontCached("b.myshopify.com", "recommendation-config", load);
    invalidateStorefrontCache("A.myshopify.com");
    await storefrontCached("a.myshopify.com", "quiz-config|tpl=3", load);
    await storefrontCached("a.myshopify.com", "recommendation-config", load);
    await storefrontCached("b.myshopify.com", "recommendation-config", load);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("doesn't cache a failed load", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("supabase down"))
      .mockResolvedValueOnce("ok");
    await expect(storefrontCached("shop.myshopify.com", "k", load)).rejects.toThrow("supabase down");
    expect(await storefrontCached("shop.myshopify.com", "k", load)).toBe("ok");
  });
});
